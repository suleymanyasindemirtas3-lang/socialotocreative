import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { accounts } from '../core/accounts.ts';
import { platform } from '../platforms/index.ts';
import type { Post } from '../core/types.ts';

/**
 * Adim 4: onaylanmislari yayina al.
 * Hedef artik platform degil hesap; ayni platformda birden fazla hesap olabilir
 * ve bir post hepsine ayni anda gider.
 */
export async function publish(limit = cfg.safety.maxPerRun): Promise<Post[]> {
  const ready = (await store.byStatus('approved')).slice(0, limit);
  if (!ready.length) {
    log.warn('yayinlanacak onayli post yok');
    return [];
  }

  const out: Post[] = [];

  for (const post of ready) {
    for (const accountId of post.targets) {
      // Idempotent: ayni posta ayni hesapta ikinci kez yayin yapma.
      if (post.results.some((r) => r.accountId === accountId && r.ok)) continue;

      const account = await accounts.get(accountId);
      if (!account) {
        log.warn(`hesap bulunamadi: ${accountId}`);
        continue;
      }
      if (!account.enabled) {
        log.warn(`hesap kapali, atlandi: ${account.label}`);
        continue;
      }

      const def = platform(account.platform);
      if (!def) {
        log.warn(`bilinmeyen platform: ${account.platform}`);
        continue;
      }

      const text = post.variants[account.platform] ?? post.variants['console'] ?? post.topic;
      const at = new Date().toISOString();

      if (cfg.safety.dryRun) {
        log.info(`[DRY_RUN] ${account.label} (${def.id}) <- ${post.id}\n${text}`);
        post.results.push({ accountId, platform: def.id, ok: true, url: 'dry-run', at });
        continue;
      }

      const r = await def.publish(post, text, account.credentials);
      r.accountId = accountId;
      post.results.push(r);
      if (r.ok) log.ok(`${account.label} yayinlandi: ${r.url}`);
      else log.err(`${account.label} hata: ${r.error}`);
    }

    const anyOk = post.results.some((r) => r.ok && post.targets.includes(r.accountId));
    post.status = anyOk ? 'published' : 'failed';
    await store.upsert(post);
    out.push(post);
  }

  return out;
}
