import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { cfg } from '../core/config.ts';
import { accounts } from '../core/accounts.ts';
import { platform } from '../platforms/index.ts';
import { getImage, imageEnabled } from '../providers/image/index.ts';
import { ses } from './ses.ts';
import { videoUretim } from './video-uretim.ts';
import { video } from './video.ts';
import { isteKonulu } from './ekipler/arastirma.ts';
import type { MediaAsset } from '../core/types.ts';

/**
 * 6. YONETMEN - produksiyon ekibinin lideri
 *
 * Ses, video-uretim ve video ajanlari birbirini cagirmaz; sirayi ve kosullari
 * bu dosya kurar. Hedef platformlarin ne istedigine (PlatformDef.needs) bakip
 * yalnizca gerekeni uretir - video istemeyen bir hedef icin video uretmez.
 *
 * Lider'den farki: lider EKIPLER arasinda dagitim yapar, yonetmen kendi
 * ekibinin ICINDE sira kurar. Iki ayri olcek, ayni desen.
 *
 * ARASTIRMA EKIBIYLE ILISKI
 * Yonetmen uretim sirasinda "bu konuda disarida ne var" diye sorabilir
 * (`isteKonulu`). Tur beklemesi anlamsiz olurdu; onbellekli oldugu icin
 * ayni turda tekrar dis istek atilmaz.
 * Bu ayricalik yalnizca EKIP LIDERLERINE ait: ses, video-uretim ve video
 * ajanlari disariya uzanamaz.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Gorsel istemi konuyla alakasiz cikiyorsa buraya bak.
 * Asagida gundem baglami gorsel istemine ekleniyor; istemin nasil
 * zenginlestigini gormek icin `npm run status` ciktisindaki gorsele bak.
 * ---------------------------------------------------------------------------
 */

export async function uret(adet: number): Promise<number> {
  const hazir = (await store.byStatus('scripted')).slice(0, adet);
  let ok = 0;

  for (const post of hazir) {
    try {
      const script = post.script;
      if (!script) throw new Error('senaryo yok; once icerik ekibi yazmali');

      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await accounts.get(accId);
        if (acc) platformIds.add(acc.platform);
      }

      const needs = [...platformIds].map((id) => platform(id)?.needs ?? 'none');
      const wantsVideo = needs.includes('video');
      const wantsImage = wantsVideo || needs.includes('image') || imageEnabled();

      const media: MediaAsset[] = [];

      if (wantsImage) {
        if (!imageEnabled()) throw new Error('hedef gorsel istiyor ama IMAGE_PROVIDER=none');

        // Gorsel istemi konudan kopuk kalabiliyordu (bir postta AI konusu icin
        // alakasiz karakter cizimi cikti). Arastirma ekibinden konuyla ilgili
        // baglam alinip isteme ekleniyor.
        const ilgili = await isteKonulu(post.topic, 2).catch(() => []);
        const zenginIstem = ilgili.length
          ? `${script.visualPrompt}. Context: ${ilgili.map((i) => i.title).join('; ').slice(0, 160)}`
          : script.visualPrompt;

        media.push(await getImage().generate(zenginIstem, `data/media/${post.id}.jpg`));
      }

      if (wantsVideo) {
        if (!script.narration) throw new Error('video icin seslendirme metni yok');
        const stem = `data/media/${post.id}`;

        const audio = await ses.run({ text: script.narration, outPath: `${stem}.mp3` });
        const clip = await videoUretim.run({
          visualPrompt: script.visualPrompt,
          seconds: audio.seconds,
          outStem: stem,
          // Ucretsiz kaynak bunu aynen kullanir; AI kaynagi yok sayar.
          ...(media[0] ? { existingStill: media[0].path } : {}),
        });
        const mp4 = await video.run({ clip, audio, caption: script.narration, outPath: `${stem}.mp4` });
        media.push({ kind: 'video', path: mp4, alt: post.topic, mime: 'video/mp4' });
      }

      post.media = media;
      post.status = cfg.approval.auto ? 'approved' : 'pending_approval';
      await store.upsert(post);
      ok++;
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
  return ok;
}

/**
 * Basarisiz postlari geri alir. Senaryo duruyorsa 'scripted'e doner: metin
 * kaybolmaz, yalnizca medya uretimi tekrarlanir (Motto 5).
 */
export async function tekrarDene(adet: number): Promise<number> {
  const failed = (await store.byStatus('failed')).slice(0, adet);
  for (const post of failed) {
    const hasScript = Boolean(post.script && Object.keys(post.variants).length);
    post.status = hasScript ? 'scripted' : 'draft';
    if (!hasScript) {
      post.variants = {};
      delete post.script;
    }
    post.media = [];
    post.results = [];
    delete post.approvalRef;
    await store.upsert(post);
    log.info(`geri alindi ${post.id} -> ${post.status}`);
  }
  return failed.length;
}
