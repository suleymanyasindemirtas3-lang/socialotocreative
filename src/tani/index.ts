import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { enabledAccounts } from '../core/accounts.ts';
import { resolveChain } from '../providers/llm/index.ts';
import { gundemTopla } from '../kaynaklar/index.ts';

/**
 * SAGLIK IZLEME
 *
 * Otonom sistemin en buyuk riski gurultusuzce durmasidir: cron calisir,
 * hata yoktur, ama haftalardir hicbir sey yayinlanmamistir. Bu katman
 * "calisiyor mu" degil "IS URETIYOR mu" sorusunu sorar.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE: `npm run saglik` ciktisinda KIRMIZI bir satir gorursen bakman
 * gereken yer odur. Her bulgu ne yapman gerektigini de yaziyor.
 * ---------------------------------------------------------------------------
 */

export type Seviye = 'iyi' | 'uyari' | 'kritik';

export interface Bulgu {
  konu: string;
  seviye: Seviye;
  detay: string;
  /** Kullanicinin ne yapmasi gerektigi. Bos ise mudahale gerekmiyor. */
  yapilacak?: string;
}

const MB = 1024 * 1024;

async function klasorBoyutu(dir: string): Promise<{ bytes: number; files: string[] }> {
  try {
    const names = await readdir(dir);
    let bytes = 0;
    const files: string[] = [];
    for (const n of names) {
      const p = join(dir, n);
      const s = await stat(p).catch(() => null);
      if (s?.isFile()) {
        bytes += s.size;
        files.push(p);
      }
    }
    return { bytes, files };
  } catch {
    return { bytes: 0, files: [] };
  }
}

export async function kontrol(): Promise<Bulgu[]> {
  const bulgular: Bulgu[] = [];
  const posts = await store.all();

  // 1. Hesap var mi? Yoksa uretilen her sey copе gider.
  const hesaplar = await enabledAccounts();
  bulgular.push(
    hesaplar.length
      ? { konu: 'hesaplar', seviye: 'iyi', detay: `${hesaplar.length} acik hesap` }
      : {
          konu: 'hesaplar',
          seviye: 'kritik',
          detay: 'hic acik hesap yok',
          yapilacak: 'npm run panel -> Hesaplar sekmesi -> hesap ekle',
        },
  );

  // 2. LLM zinciri gercekten calisiyor mu?
  try {
    const chain = resolveChain();
    const t0 = Date.now();
    const out = await chain[0]!.complete('Sadece su kelimeyi yaz: tamam', { maxTokens: 12 });
    const ms = Date.now() - t0;
    bulgular.push(
      out.trim()
        ? { konu: 'llm', seviye: ms > 20000 ? 'uyari' : 'iyi', detay: `${chain[0]!.id} ${ms}ms` }
        : { konu: 'llm', seviye: 'uyari', detay: `${chain[0]!.id} bos yanit dondurdu` },
    );
  } catch (e) {
    bulgular.push({
      konu: 'llm',
      seviye: 'kritik',
      detay: String(e).slice(0, 120),
      yapilacak: '.env icindeki LLM_PROVIDER zincirini ve anahtarlari kontrol et',
    });
  }

  // 3. Gundem kaynaklari erisilebilir mi? Kesilirse icerik jeneriklesir.
  const gundem = await gundemTopla(6).catch(() => []);
  bulgular.push(
    gundem.length >= 3
      ? { konu: 'gundem', seviye: 'iyi', detay: `${gundem.length} madde alindi` }
      : {
          konu: 'gundem',
          seviye: 'uyari',
          detay: `yalnizca ${gundem.length} madde`,
          yapilacak: 'TREND_SOURCES ayarina bak; kaynaklar kesilirse icerik jeneriklesir',
        },
  );

  // 4. Hat tikanmis mi? Onay bekleyen birikiyorsa insan mudahalesi gerekiyor.
  const bekleyen = posts.filter((p) => p.status === 'pending_approval').length;
  if (bekleyen >= 10) {
    bulgular.push({
      konu: 'onay kuyrugu',
      seviye: 'uyari',
      detay: `${bekleyen} post onay bekliyor`,
      yapilacak: 'npm run panel ile onayla, ya da AUTO_APPROVE=true yap',
    });
  }

  // 5. Basarisizlar birikiyor mu?
  const hatali = posts.filter((p) => p.status === 'failed');
  if (hatali.length >= 5) {
    const sonHata = hatali.at(-1)?.results.at(-1)?.error ?? '';
    bulgular.push({
      konu: 'hatalar',
      seviye: 'uyari',
      detay: `${hatali.length} basarisiz post. Son: ${sonHata.slice(0, 90)}`,
      yapilacak: 'npm run retry ile geri al; ayni hata tekrarliyorsa sebebini duzelt',
    });
  }

  // 6. SESSIZ DURUS: en tehlikeli hal. Hata yok ama uretim de yok.
  const sonYayin = posts
    .flatMap((p) => p.results.filter((r) => r.ok))
    .map((r) => Date.parse(r.at))
    .sort((a, b) => b - a)[0];

  if (posts.length && sonYayin) {
    const saat = (Date.now() - sonYayin) / 36e5;
    if (saat > cfg.saglik.sessizlikSaat) {
      bulgular.push({
        konu: 'sessiz durus',
        seviye: 'kritik',
        detay: `${saat.toFixed(0)} saattir yayin yok`,
        yapilacak: 'npm run plan ile liderin ne yapmak istedigine bak; kuyruk bos olabilir',
      });
    }
  }

  // 7. Medya birikimi. Sinirsiz buyur ve sessizce diski doldurur.
  const medya = await klasorBoyutu('data/media');
  const mb = medya.bytes / MB;
  bulgular.push(
    mb < cfg.saglik.medyaLimitMb
      ? { konu: 'medya', seviye: 'iyi', detay: `${mb.toFixed(0)} MB / ${cfg.saglik.medyaLimitMb} MB` }
      : {
          konu: 'medya',
          seviye: 'uyari',
          detay: `${mb.toFixed(0)} MB, limit asildi`,
          yapilacak: 'npm run temizle ile yayinlanmis postlarin medyasini sil',
        },
  );

  return bulgular;
}

/**
 * Yayinlanmis ya da reddedilmis postlarin medyasini siler.
 * Yalnizca isi bitmis olanlara dokunur; kuyrukta bekleyenin medyasi durur.
 */
export async function temizle(gunOnce = cfg.saglik.temizlikGun): Promise<number> {
  const posts = await store.all();
  const esik = Date.now() - gunOnce * 864e5;

  const silinebilir = new Set<string>();
  for (const p of posts) {
    const bitti = p.status === 'published' || p.status === 'rejected';
    if (bitti && Date.parse(p.createdAt) < esik) {
      for (const m of p.media) silinebilir.add(m.path);
      silinebilir.add(`data/media/${p.id}.mp3`);
    }
  }

  let n = 0;
  for (const path of silinebilir) {
    const ok = await rm(path, { force: true }).then(
      () => true,
      () => false,
    );
    if (ok) n++;
  }
  if (n) log.ok(`${n} medya dosyasi silindi`);
  return n;
}

export function ozet(bulgular: Bulgu[]): Seviye {
  if (bulgular.some((b) => b.seviye === 'kritik')) return 'kritik';
  if (bulgular.some((b) => b.seviye === 'uyari')) return 'uyari';
  return 'iyi';
}
