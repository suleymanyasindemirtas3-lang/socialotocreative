import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cfg } from '../../core/config.ts';
import { log } from '../../core/logger.ts';
import type { ImageProvider, MediaAsset } from '../../core/types.ts';

/** Anahtar gerektirmez, tamamen ucretsiz. Ucretli gecis icin fal/replicate ayni arayuze yazilir. */
const pollinations: ImageProvider = {
  id: 'pollinations',
  isConfigured: () => true,
  async generate(prompt, outPath) {
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${cfg.image.width}&height=${cfg.image.height}&nologo=true&model=flux`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`pollinations ${res.status}`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return { kind: 'image', path: outPath, alt: prompt.slice(0, 280), mime: 'image/jpeg' };
  },
};

/**
 * Gemini gorsel modeli. Ayni GEMINI_API_KEY'i kullanir, ek anahtar istemez.
 * Pollinations bedava ama ciktisi jenerik "AI sanati"na kaciyor; teknik
 * icerikte konuyla ilgisiz gorseller uretiyordu. Gemini istemi daha iyi takip
 * ediyor. Ucretsiz kotaya tabi, bu yuzden zincirde once o, sonra pollinations.
 */
const geminiImage: ImageProvider = {
  id: 'gemini',
  isConfigured: () => Boolean(cfg.llm.gemini.key),
  async generate(prompt, outPath): Promise<MediaAsset> {
    const model = cfg.image.geminiModel;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.llm.gemini.key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini-image ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
    };
    const veri = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!veri) throw new Error('gemini-image gorsel dondurmedi');

    const mime = veri.mimeType || 'image/png';
    const path = mime.includes('png') ? outPath.replace(/\.jpe?g$/, '.png') : outPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(veri.data, 'base64'));
    return { kind: 'image', path, alt: prompt.slice(0, 280), mime };
  },
};

const none: ImageProvider = {
  id: 'none',
  isConfigured: () => true,
  async generate(): Promise<MediaAsset> {
    throw new Error('IMAGE_PROVIDER=none iken gorsel uretilemez');
  },
};

const registry: Record<string, ImageProvider> = { gemini: geminiImage, pollinations, none };

/** LLM'deki gibi zincir: kota biterse ucretsiz saglayiciya duser. */
export function getImage(): ImageProvider {
  const chain = cfg.image.chain
    .map((id) => registry[id])
    .filter((p): p is ImageProvider => Boolean(p?.isConfigured()));

  if (!chain.length) return none;
  if (chain.length === 1) return chain[0]!;

  return {
    id: chain.map((p) => p.id).join('>'),
    isConfigured: () => true,
    async generate(prompt, outPath) {
      let last: unknown;
      for (const p of chain) {
        try {
          return await p.generate(prompt, outPath);
        } catch (e) {
          last = e;
          log.warn(`gorsel ${p.id} basarisiz, siradakine geciliyor: ${String(e).slice(0, 120)}`);
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}

export const imageRegistry = registry;
export const imageEnabled = () => !cfg.image.chain.every((id) => id === 'none');
