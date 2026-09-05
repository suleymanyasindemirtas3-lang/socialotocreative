import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { accounts } from '../core/accounts.ts';
import { getLlm } from '../providers/llm/index.ts';
import { getImage, imageEnabled } from '../providers/image/index.ts';
import { platform } from '../platforms/index.ts';
import { compose } from '../media/video.ts';
import { brandVoice } from './ideate.ts';
import { inspect, tidy } from './quality.ts';
import type { Post } from '../core/types.ts';

/** Adim 2: her hedef platform icin metin + gorsel uret. */
export async function generate(limit = cfg.safety.maxPerRun): Promise<Post[]> {
  const llm = getLlm();
  const voice = await brandVoice();
  const drafts = (await store.byStatus('draft')).slice(0, limit);
  if (!drafts.length) { log.warn('uretilecek taslak yok'); return []; }

  const done: Post[] = [];
  for (const post of drafts) {
    try {
      // Metin platform basina uretilir: ayni platformdaki iki hesap ayni metni paylasir.
      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await accounts.get(accId);
        if (acc) platformIds.add(acc.platform);
      }
      if (!platformIds.size) throw new Error('acik hedef hesap yok');

      for (const id of platformIds) {
        const limitChars = platform(id)?.limits.text ?? 500;
        const text = await llm.complete(
          [
            `Konu: ${post.topic}`,
            post.angle ? `Bakis acisi: ${post.angle}` : '',
            `Platform: ${id}. Kesin ust sinir: ${limitChars} karakter.`,
            'Tek bir post metni yaz. Aciklama, baslik, tirnak ya da secenek sunma.',
          ].filter(Boolean).join('\n'),
          { system: voice, maxTokens: 700 },
        );
        const clean = tidy(text);
        const issues = inspect(clean, limitChars);
        if (issues.length) {
          throw new Error(
            `kalite kapisi (${id}): ` + issues.map((i) => `${i.code}=${i.detail}`).join(', '),
          );
        }
        post.variants[id] = clean;
      }

      // Hedeflerin en agir medya ihtiyaci neyse ona gore uret: video > image > none.
      const needs = [...platformIds].map((id) => platform(id)?.needs ?? 'none');
      const wantsVideo = needs.includes('video');
      const wantsImage = wantsVideo || needs.includes('image') || imageEnabled();

      // Gorsel istemi bir kez uretilir; hem durgun gorsel hem video onu kullanir.
      const visualPrompt = (
        await llm.complete(
          `Su post icin ingilizce, tek cumlelik bir gorsel uretim promptu yaz. Metin/yazi icermesin.\n\n${post.topic}`,
          { maxTokens: 120 },
        )
      ).trim();

      if (wantsImage) {
        if (!imageEnabled()) throw new Error('hedef gorsel istiyor ama IMAGE_PROVIDER=none');
        post.media = [await getImage().generate(visualPrompt, `data/media/${post.id}.jpg`)];
      }

      if (wantsVideo) {
        // Seslendirme metni post metninden ayri uretilir: konusma dili yazi
        // dilinden farkli, ve caption'i okumak izleyiciyi kaybettiriyor.
        const narration = tidy(
          await llm.complete(
            [
              `Konu: ${post.topic}`,
              post.angle ? `Bakis acisi: ${post.angle}` : '',
              'Bu konuyu 30-40 saniyede anlatan bir seslendirme metni yaz.',
              'Konusma dili kullan. Tek fikri ac ve somut bitir.',
              'Sadece seslendirilecek metni yaz; sahne yonergesi, baslik ya da etiket yazma.',
            ].filter(Boolean).join('\n'),
            { system: voice, maxTokens: 500 },
          ),
        );

        const still = post.media.find((m) => m.kind === 'image');
        const video = await compose({
          visualPrompt,
          narration,
          outPath: `data/media/${post.id}.mp4`,
          // Ucretsiz kaynak bunu aynen kullanir; AI kaynagi yok sayip kendi klibini uretir.
          ...(still ? { existingStill: still.path } : {}),
        });
        post.media.push({ kind: 'video', path: video, alt: post.topic, mime: 'video/mp4' });
      }

      post.status = cfg.approval.auto ? 'approved' : 'pending_approval';
      await store.upsert(post);
      done.push(post);
      log.ok(`uretildi ${post.id} -> ${post.status}`);
    } catch (e) {
      post.status = 'failed';
      post.results.push({ accountId: '', platform: 'generate', ok: false, error: String(e), at: new Date().toISOString() });
      await store.upsert(post);
      log.err(`uretim hatasi ${post.id}: ${e}`);
    }
  }
  return done;
}

/**
 * Basarisiz taslaklari yeniden uretime alir.
 * Kalite kapisi ya da saglayici cokmesi kalici olmamali; model degisince
 * ayni fikir tekrar denenebilmeli (Motto 5: tekrar calistirmak zararsiz).
 */
export async function retryFailed(limit = 10): Promise<number> {
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
