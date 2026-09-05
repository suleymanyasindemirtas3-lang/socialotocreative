import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { platform, activePlatforms } from '../platforms/index.ts';
import type { Post } from '../core/types.ts';

/** Adim 4: onaylanmislari yayina al. DRY_RUN acikken hicbir gercek cagri yapilmaz. */
export async function publish(limit = cfg.safety.maxPerRun): Promise<Post[]> {
  const ready = (await store.byStatus('approved')).slice(0, limit);
  if (!ready.length) {
    log.warn('yayinlanacak onayli post yok');
    return [];
  }

  const active = new Set(activePlatforms().map((p) => p.id));
  const out: Post[] = [];

  for (const post of ready) {
    for (const id of post.targets) {
      const adapter = platform(id);
      if (!adapter) {
        log.warn(`bilinmeyen platform: ${id}`);
        continue;
      }
      if (!active.has(id)) {
        log.warn(`${id} yapilandirilmamis, atlandi`);
        continue;
      }
      // Idempotent: ayni posta ayni platformda ikinci kez yayin yapma.
      if (post.results.some((r) => r.platform === id && r.ok)) continue;

      const text = post.variants[id] ?? post.variants['console'] ?? post.topic;

      if (cfg.safety.dryRun) {
        log.info(`[DRY_RUN] ${id} <- ${post.id}\n${text}`);
        post.results.push({ platform: id, ok: true, url: 'dry-run', at: new Date().toISOString() });
        continue;
      }

      const r = await adapter.publish(post, text);
      post.results.push(r);
      if (r.ok) log.ok(`${id} yayinlandi: ${r.url}`);
      else log.err(`${id} hata: ${r.error}`);
    }

    const anyOk = post.results.some((r) => r.ok && post.targets.includes(r.platform));
    post.status = anyOk ? 'published' : 'failed';
    await store.upsert(post);
    out.push(post);
  }

  return out;
}
