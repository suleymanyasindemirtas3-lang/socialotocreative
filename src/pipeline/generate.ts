import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { getLlm } from '../providers/llm/index.ts';
import { getImage, imageEnabled } from '../providers/image/index.ts';
import { platform } from '../platforms/index.ts';
import { brandVoice } from './ideate.ts';
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
      for (const id of post.targets) {
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
        post.variants[id] = text.trim().replace(/^["']|["']$/g, '').slice(0, limitChars);
      }

      if (imageEnabled()) {
        const img = getImage();
        const promptText = await llm.complete(
          `Su post icin ingilizce, tek cumlelik bir gorsel uretim promptu yaz. Metin/yazi icermesin.\n\n${post.topic}`,
          { maxTokens: 120 },
        );
        post.media = [await img.generate(promptText.trim(), `data/media/${post.id}.jpg`)];
      }

      post.status = cfg.approval.auto ? 'approved' : 'pending_approval';
      await store.upsert(post);
      done.push(post);
      log.ok(`uretildi ${post.id} -> ${post.status}`);
    } catch (e) {
      post.status = 'failed';
      post.results.push({ platform: 'generate', ok: false, error: String(e), at: new Date().toISOString() });
      await store.upsert(post);
      log.err(`uretim hatasi ${post.id}: ${e}`);
    }
  }
  return done;
}
