import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cfg } from '../../core/config.ts';
import { log } from '../../core/logger.ts';
import { getImage } from '../image/index.ts';
import type { ClipRequest, ClipResult, ClipSource } from '../../core/types.ts';

const ensureDir = async (p: string) => mkdir(dirname(p), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ucretsiz varsayilan: durgun gorsel uret, hareketi compose() icindeki
 * Ken Burns zoom saglar. Maliyet sifir, kalite kabul edilebilir.
 */
const still: ClipSource = {
  id: 'still',
  tier: 'free',
  isConfigured: () => cfg.image.provider !== 'none',
  async produce({ prompt, outStem, existingStill }: ClipRequest): Promise<ClipResult> {
    // Ayni gorseli iki kez uretmek bedava ama yavas; varsa mevcut olani kullan.
    if (existingStill) return { path: existingStill, motion: false };
    const path = `${outStem}.jpg`;
    await getImage().generate(prompt, path);
    return { path, motion: false };
  },
};

/**
 * Ucretli AI video uretimi (fal.ai). Referans uygulama: arayuzun gercekten
 * takilabilir oldugunu kanitlar. Yalnizca GORUNTU uretir; seslendirme,
 * altyazi ve 9:16 formatlama bedelsiz yerel islemede kalir.
 */
const fal: ClipSource = {
  id: 'fal',
  tier: 'paid',
  isConfigured: () => Boolean(cfg.clip.falKey),
  async produce({ prompt, seconds, outStem }: ClipRequest): Promise<ClipResult> {
    const submit = await fetch(`https://queue.fal.run/${cfg.clip.falModel}`, {
      method: 'POST',
      headers: { authorization: `Key ${cfg.clip.falKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, duration: Math.min(Math.round(seconds), 10), aspect_ratio: '9:16' }),
    });
    if (!submit.ok) throw new Error(`fal ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
    const { status_url, response_url } = (await submit.json()) as {
      status_url: string;
      response_url: string;
    };

    // Kuyruk tabanli: hazir olana kadar yoklanir.
    for (let i = 0; i < 90; i++) {
      await sleep(4000);
      const st = await fetch(status_url, { headers: { authorization: `Key ${cfg.clip.falKey}` } });
      const sj = (await st.json()) as { status: string };
      if (sj.status === 'COMPLETED') break;
      if (sj.status === 'FAILED') throw new Error('fal uretim basarisiz');
      if (i === 89) throw new Error('fal 6 dakikada bitmedi');
    }

    const done = await fetch(response_url, { headers: { authorization: `Key ${cfg.clip.falKey}` } });
    const dj = (await done.json()) as { video?: { url: string } };
    if (!dj.video?.url) throw new Error('fal video url donmedi');

    const bytes = await fetch(dj.video.url);
    const path = `${outStem}.src.mp4`;
    await ensureDir(path);
    await writeFile(path, Buffer.from(await bytes.arrayBuffer()));
    return { path, motion: true };
  },
};

const registry: Record<string, ClipSource> = { still, fal };

export function getClipSource(): ClipSource {
  const chain = cfg.clip.chain
    .map((id) => registry[id])
    .filter((p): p is ClipSource => Boolean(p?.isConfigured()));

  if (!chain.length) throw new Error(`Calisir gorsel kaynagi yok. CLIP_SOURCE=${cfg.clip.chain.join(',')}`);
  if (chain.length === 1) return chain[0]!;

  return {
    id: chain.map((p) => p.id).join('>'),
    tier: chain[0]!.tier,
    isConfigured: () => true,
    async produce(req) {
      let last: unknown;
      for (const p of chain) {
        try {
          return await p.produce(req);
        } catch (e) {
          last = e;
          log.warn(`klip ${p.id} basarisiz, siradakine geciliyor: ${String(e).slice(0, 120)}`);
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}

export const clipRegistry = registry;
