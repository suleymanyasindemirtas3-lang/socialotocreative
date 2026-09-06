import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { accounts } from '../core/accounts.ts';
import { platform } from '../platforms/index.ts';
import type { Post } from '../core/types.ts';

/**
 * 7. YAYINCI - yayin ekibinin ajani
 *
 * Onaylanmislari hesaplara dagitir. Hedef platform degil HESAP: ayni
 * platformda birden fazla hesap olabilir ve bir post hepsine ayni anda gider.
 *
 * Uzun sure pipeline/publish.ts olarak ajan disinda duruyordu; diger her sey
 * ajanlasmisken burasi istisna kalmisti.
 */
export async function publish(limit = cfg.safety.maxPerRun): Promise<Post[]> {
  const ready = (await store.byStatus('approved')).slice(0, limit);
  if (!ready.length) {
    log.warn('yayinlanacak onayli post yok');
    return [];
  }

  const out: Post[] = [];
  let manuelBekleyen = 0;

  for (const post of ready) {
    /** Bu postta API'ye kac hedef icin gercekten gidildi. */
    let denendi = 0;

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

      /**
       * MANUEL MOD - hesap ucretli API'ye baglanmadan calisiyor.
       *
       * Burada hata kaydi YAZILMAZ, cunku bu bir hata degil bilincli bir
       * secim. Hata yazilsaydi post 'failed' olur ve kuyruktan duserdi;
       * oysa post hazir ve paylasilmayi bekliyor. Onayli halde birakilir,
       * kullanici panelden paketi alip paylasinca kapanir.
       */
      if (account.manuel) {
        manuelBekleyen++;
        log.info(`${account.label}: manuel mod — panelden "Manuel yayınla" ile paylas`);
        continue;
      }

      const def = platform(account.platform);
      if (!def) {
        log.warn(`bilinmeyen platform: ${account.platform}`);
        continue;
      }

      /**
       * Onceden burada `?? post.topic` vardi: metin uretilmemisse konu
       * basligi sessizce tweet olarak gidiyordu. Sessiz yanlis yayin,
       * gurultulu hatadan cok daha kotu (Motto 2).
       */
      const text = post.variants[account.platform] ?? post.variants['console'];
      const at = new Date().toISOString();

      if (!text?.trim()) {
        const hata = `${account.platform} icin metin yok; once icerik ekibi yazmali`;
        log.err(`${post.id}: ${hata}`);
        post.results.push({ accountId, platform: def.id, ok: false, error: hata, at });
        denendi++;
        continue;
      }

      if (cfg.safety.dryRun) {
        log.info(`[DRY_RUN] ${account.label} (${def.id}) <- ${post.id}\n${text}`);
        post.results.push({ accountId, platform: def.id, ok: true, url: 'dry-run', at });
        denendi++;
        continue;
      }

      const r = await def.publish(post, text, account.credentials);
      r.accountId = accountId;
      denendi++;
      post.results.push(r);
      if (r.ok) log.ok(`${account.label} yayinlandi: ${r.url}`);
      else log.err(`${account.label} hata: ${r.error}`);
    }

    /**
     * Hicbir hedefe API ile dokunulmadiysa (hepsi manuel modda) postun
     * durumu DEGISMEZ. 'failed' yazmak yaniltici olurdu: post saglam,
     * yalnizca paylasim adimi kullaniciyi bekliyor.
     */
    if (!denendi) continue;

    const anyOk = post.results.some((r) => r.ok && post.targets.includes(r.accountId));
    post.status = anyOk ? 'published' : 'failed';
    await store.upsert(post);
    out.push(post);
  }

  if (manuelBekleyen) {
    log.warn(`${manuelBekleyen} paylasim manuel modda bekliyor — panelden "Manuel yayınla"`);
  }

  return out;
}

/** Ajan kimligi; doctor ve panel listesinde gorunur. */
export const yayinci = {
  id: 'yayinci',
  role: 'Onaylanmis postlari hesaplara dagitir',
  uses: ['platformlar'],
  run: (girdi: { adet: number }) => publish(girdi.adet),
};
