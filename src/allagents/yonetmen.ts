import { randomUUID } from 'node:crypto';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { accounts, enabledAccounts } from '../core/accounts.ts';
import { fingerprint } from '../core/fingerprint.ts';
import { platform } from '../platforms/index.ts';
import { icerikBulma } from './icerik-bulma.ts';
import { senaryo } from './senaryo.ts';
import { ses } from './ses.ts';
import { videoUretim } from './video-uretim.ts';
import { video } from './video.ts';
import { getImage, imageEnabled } from '../providers/image/index.ts';
import type { MediaAsset, Post } from '../core/types.ts';

/**
 * 6. YONETMEN
 *
 * Tek karar mercii. Diger bes ajan birbirini cagirmaz; sira, kosul ve hata
 * yonetimi burada durur. Bir ajanin sorumlulugu degistiginde yalnizca bu
 * dosya ile o ajan degisir, aradaki hicbir sey degismez.
 *
 * Verdigi kararlar:
 *   - hangi platformlara metin yazilacak (acik hesaplardan turer)
 *   - gorsel gerekli mi, video gerekli mi (PlatformDef.needs)
 *   - post onaya mi gidecek yoksa dogrudan yayina mi (AUTO_APPROVE)
 */

/** Adim 1: fikir bul ve taslak olarak kuyruga koy. */
export async function bulFikir(count = cfg.safety.maxPerRun): Promise<Post[]> {
  const targets = (await enabledAccounts()).map((a) => a.id);
  const fikirler = await icerikBulma.run({
    count,
    recent: (await store.all()).slice(-40).map((p) => p.topic),
    seen: await store.fingerprints(),
  });

  const out: Post[] = [];
  for (const f of fikirler) {
    const post: Post = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      topic: f.topic,
      angle: f.angle,
      status: 'draft',
      variants: {},
      media: [],
      targets,
      results: [],
      fingerprint: fingerprint(f.topic),
    };
    await store.upsert(post);
    out.push(post);
    log.ok(`fikir ${post.id}: ${post.topic}`);
  }
  return out;
}

/** Adim 2: taslaklari metne, sese ve videoya cevir. */
export async function uret(limit = cfg.safety.maxPerRun): Promise<Post[]> {
  const drafts = (await store.byStatus('draft')).slice(0, limit);
  if (!drafts.length) {
    log.warn('uretilecek taslak yok');
    return [];
  }

  const done: Post[] = [];
  for (const post of drafts) {
    try {
      // Hedef hesaplardan platform kumesi cikar: ayni platformdaki iki hesap
      // ayni metni paylasir, metin hesap basina degil platform basina uretilir.
      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await accounts.get(accId);
        if (acc) platformIds.add(acc.platform);
      }
      if (!platformIds.size) throw new Error('acik hedef hesap yok');

      const needs = [...platformIds].map((id) => platform(id)?.needs ?? 'none');
      const wantsVideo = needs.includes('video');
      const wantsImage = wantsVideo || needs.includes('image') || imageEnabled();

      const script = await senaryo.run({
        fikir: { topic: post.topic, angle: post.angle },
        platforms: [...platformIds].map((id) => ({ id, limit: platform(id)?.limits.text ?? 500 })),
        narrationNeeded: wantsVideo,
      });
      post.variants = script.variants;

      const media: MediaAsset[] = [];

      if (wantsImage) {
        if (!imageEnabled()) throw new Error('hedef gorsel istiyor ama IMAGE_PROVIDER=none');
        media.push(await getImage().generate(script.visualPrompt, `data/media/${post.id}.jpg`));
      }

      if (wantsVideo) {
        if (!script.narration) throw new Error('video icin seslendirme metni uretilemedi');
        const stem = `data/media/${post.id}`;

        const audio = await ses.run({ text: script.narration, outPath: `${stem}.mp3` });
        const clip = await videoUretim.run({
          visualPrompt: script.visualPrompt,
          seconds: audio.seconds,
          outStem: stem,
          // Ucretsiz kaynak bunu aynen kullanir; AI kaynagi yok sayar.
          ...(media[0] ? { existingStill: media[0].path } : {}),
        });
        const mp4 = await video.run({
          clip,
          audio,
          caption: script.narration,
          outPath: `${stem}.mp4`,
        });
        media.push({ kind: 'video', path: mp4, alt: post.topic, mime: 'video/mp4' });
      }

      post.media = media;
      post.status = cfg.approval.auto ? 'approved' : 'pending_approval';
      await store.upsert(post);
      done.push(post);
      log.ok(`uretildi ${post.id} -> ${post.status}`);
    } catch (e) {
      post.status = 'failed';
      post.results.push({
        accountId: '',
        platform: 'yonetmen',
        ok: false,
        error: String(e),
        at: new Date().toISOString(),
      });
      await store.upsert(post);
      log.err(`uretim hatasi ${post.id}: ${e}`);
    }
  }
  return done;
}

/**
 * Basarisiz taslaklari yeniden uretime alir.
 * Kalite kapisina takilmak ya da saglayici cokmesi kalici olmamali; model
 * degisince ayni fikir tekrar denenebilmeli (Motto 5).
 */
export async function tekrarDene(limit = 10): Promise<number> {
  const failed = (await store.byStatus('failed')).slice(0, limit);
  for (const post of failed) {
    post.status = 'draft';
    post.variants = {};
    post.media = [];
    post.results = [];
    delete post.approvalRef;
    await store.upsert(post);
    log.info(`yeniden kuyruga alindi ${post.id}: ${post.topic}`);
  }
  return failed.length;
}
