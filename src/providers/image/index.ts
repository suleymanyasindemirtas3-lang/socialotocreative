import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cfg } from '../../core/config.ts';
import { log } from '../../core/logger.ts';
import { kullanilabilir, hataBildir, basariBildir, kotaHatasiMi, kalanBekleme } from '../saglik.ts';
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

/**
 * CLOUDFLARE WORKERS AI - FLUX.1 schnell
 *
 * Neden burada: gunluk YENILENEN ucretsiz kota veriyor (10.000 neuron),
 * kart istemiyor. Kredi veren servislerin cogu bir kez tukenince biter;
 * bu her gun sifirlaniyor, yani uretim kalici olarak durmuyor.
 *
 * Cikti base64 JPEG olarak JSON icinde geliyor - digerleri gibi ham
 * ikili degil.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Anahtar icin: dash.cloudflare.com > AI > Workers AI,
 * sonra My Profile > API Tokens > "Workers AI" sablonu. Hesap kimligi
 * panonun sag sutununda "Account ID" olarak yaziyor.
 * .env: CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN
 * ---------------------------------------------------------------------------
 */
const cloudflare: ImageProvider = {
  id: 'cloudflare',
  isConfigured: () => Boolean(cfg.image.cloudflareAccount && cfg.image.cloudflareToken),
  async generate(prompt, outPath): Promise<MediaAsset> {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${cfg.image.cloudflareAccount}` +
      `/ai/run/${cfg.image.cloudflareModel}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.image.cloudflareToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 6 }),
    });

    if (!res.ok) {
      const govde = await res.text();
      hataBildir('cloudflare', govde, kotaHatasiMi(res.status, govde));
      throw new Error(`cloudflare ${res.status}: ${govde.slice(0, 200)}`);
    }

    const j = (await res.json()) as { result?: { image?: string }; errors?: unknown };
    const b64 = j.result?.image;
    if (!b64) throw new Error(`cloudflare gorsel dondurmedi: ${JSON.stringify(j).slice(0, 160)}`);

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(b64, 'base64'));
    basariBildir('cloudflare');
    return { kind: 'image', path: outPath, alt: prompt.slice(0, 280), mime: 'image/jpeg' };
  },
};

const none: ImageProvider = {
  id: 'none',
  isConfigured: () => true,
  async generate(): Promise<MediaAsset> {
    throw new Error('IMAGE_PROVIDER=none iken gorsel uretilemez');
  },
};

const registry: Record<string, ImageProvider> = { gemini: geminiImage, cloudflare, pollinations, none };

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
      /**
       * SAGLIK TAKIBI - LLM zincirindeki ile ayni.
       *
       * Onceden bu zincirin hafizasi yoktu: kotasi dolmus saglayici HER
       * gorselde yeniden deneniyordu. Video basina uc gorsel oldugu icin
       * her videoda uc kez bosa istek ve bekleme demekti.
       *
       * Artik kotasi dolan saglayici bir sure kenara ayriliyor, sira
       * dogrudan calisana geciyor; ilk basarida bekleme sifirlaniyor.
       */
      const hazir = chain.filter((p) => kullanilabilir(p.id));
      const bekleyen = chain.filter((p) => !kullanilabilir(p.id));

      // Bekleyenler tamamen atilmiyor: hepsi kotadaysa yine de denenir.
      let last: unknown;
      for (const p of [...hazir, ...bekleyen]) {
        try {
          const sonuc = await p.generate(prompt, outPath);
          basariBildir(p.id);
          return sonuc;
        } catch (e) {
          last = e;
          const mesaj = String(e);
          // Saglayici kendi icinde bildirmediyse burada bildir.
          hataBildir(p.id, mesaj, /429|402|quota|rate.?limit|credit|insufficient/i.test(mesaj));
          const kalan = kalanBekleme(p.id);
          log.warn(
            `gorsel ${p.id} basarisiz, siradakine geciliyor` +
              `${kalan ? ` (${Math.ceil(kalan / 60000)} dk kenarda)` : ''}: ${mesaj.slice(0, 110)}`,
          );
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}

export const imageRegistry = registry;
export const imageEnabled = () => !cfg.image.chain.every((id) => id === 'none');
