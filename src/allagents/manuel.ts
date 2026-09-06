import { basename } from 'node:path';
import { store } from '../core/store.ts';
import { accounts } from '../core/accounts.ts';
import { platform } from '../platforms/index.ts';
import type { Post } from '../core/types.ts';

/**
 * MANUEL YAYIN
 *
 * Uretim hattinin son adimini API'den alip kullaniciya veren katman.
 *
 * ---------------------------------------------------------------------------
 * NEDEN VAR
 *
 * X ucretsiz katmani 6 Subat 2026'da kapandi; yayin artik on odemeli krediye
 * bagli. Ayni sey her platformda tekrarlanabilir. Sistemin kendini
 * kanitlamadan para harcamasi kabul edilemez.
 *
 * Bu yuzden yayin, uretimden ayri bir yetenek olarak ele alindi:
 *
 *   uretim (metin, gorsel, video, puanlama)  -> her zaman 0 maliyet
 *   yayin  (postu platforma gonderme)        -> API varsa otomatik,
 *                                               yoksa manuel
 *
 * Manuel modda hicbir ajan devre disi kalmaz. Degisen tek sey, son adimda
 * HTTP istegi yerine kullaniciya hazir paket verilmesi. Odeme yapildigi gun
 * hesabin `manuel` bayragi kapatilir; kodun geri kalani ayni kalir.
 * ---------------------------------------------------------------------------
 */

export interface ManuelMedya {
  kind: 'image' | 'video';
  /** Panelde onizleme ve indirme icin. */
  url: string;
  dosya: string;
  alt: string;
}

export interface ManuelPaket {
  postId: string;
  accountId: string;
  hesapAdi: string;
  platformId: string;
  platformAdi: string;
  /** Paylasilacak metnin son hali. */
  metin: string;
  karakter: number;
  limit: number;
  medya: ManuelMedya[];
  /**
   * Platformun kendi "paylas" ekranini metin dolu acan baglanti.
   * Ucretsizdir, API degildir: tarayicida normal paylasim penceresi acilir.
   * Desteklemeyen platformlarda bos kalir.
   */
  paylasLinki?: string;
  /** Kullanicinin sirayla yapacaklari. */
  adimlar: string[];
  /** Zaten manuel isaretlenmis mi. */
  paylasildi: boolean;
}

/**
 * Platformun web paylasim ekranini metin dolu acan adres.
 *
 * Bunlar resmi "intent" uclari: API anahtari istemez, ucret islemez, sadece
 * kullanicinin oturumunu kullanip paylasim kutusunu on doldurur. Gorsel
 * eklenemez - onu kullanici elle yukler, adimlarda yaziyor.
 */
function paylasLinki(platformId: string, metin: string): string | undefined {
  const t = encodeURIComponent(metin);
  if (platformId === 'x') return `https://x.com/intent/post?text=${t}`;
  if (platformId === 'bluesky') return `https://bsky.app/intent/compose?text=${t}`;
  if (platformId === 'mastodon') return `https://mastodon.social/share?text=${t}`;
  return undefined;
}

function adimlar(platformId: string, medyaVar: boolean, linkVar: boolean): string[] {
  const a: string[] = [];
  a.push(linkVar ? 'Metni kopyala (ya da "paylaşım ekranını aç"a bas, metin hazır gelir)' : 'Metni kopyala');
  if (medyaVar) {
    a.push('Görseli indir');
    a.push('Paylaşım ekranında görseli ekle');
  }
  if (platformId === 'x') {
    a.push('Kaynak linkini gönderiye DEĞİL, altına yanıt olarak koy');
  }
  a.push('Paylaş');
  a.push('Buraya dön ve "Paylaştım" düğmesine bas — post kuyruktan çıksın');
  return a;
}

/** Bir post + hesap icin paylasima hazir paketi kurar. */
export async function manuelPaket(postId: string, accountId?: string): Promise<ManuelPaket> {
  const post = await store.get(postId);
  if (!post) throw new Error('post yok');

  const hedef = accountId ?? post.targets[0];
  if (!hedef) throw new Error('bu postun hedef hesabi yok');

  const account = await accounts.get(hedef);
  if (!account) throw new Error(`hesap bulunamadi: ${hedef}`);

  const def = platform(account.platform);
  if (!def) throw new Error(`bilinmeyen platform: ${account.platform}`);

  /**
   * Yayinci ile ayni kural: metin yoksa konu basligi metin yerine gecmez.
   * Manuel yolda da sessiz yanlis paylasima izin verilmez.
   */
  const metin = (post.variants[account.platform] ?? post.variants['console'] ?? '').trim();
  if (!metin) throw new Error(`${account.platform} icin metin yok; once "Metin" calistir`);

  const medya: ManuelMedya[] = post.media.map((m) => {
    const dosya = basename(m.path);
    return { kind: m.kind, url: `/media/${encodeURIComponent(dosya)}`, dosya, alt: m.alt };
  });

  const link = paylasLinki(def.id, metin);

  return {
    postId: post.id,
    accountId: hedef,
    hesapAdi: account.label,
    platformId: def.id,
    platformAdi: def.label,
    metin,
    karakter: metin.length,
    limit: def.limits.text,
    medya,
    ...(link ? { paylasLinki: link } : {}),
    adimlar: adimlar(def.id, medya.length > 0, Boolean(link)),
    paylasildi: post.results.some((r) => r.accountId === hedef && r.ok),
  };
}

/**
 * Kullanici elle paylastiktan sonra postu kapatir.
 *
 * API yayini ile ayni sonuc kaydini yazar, yalniz `manuel: true` isaretiyle.
 * Boylece idempotenslik, kuyruktan cikma ve panel sayimlari tek bir kod
 * yolundan gecer; manuel post ikinci kez onerilmez.
 */
export async function manuelIsaretle(
  postId: string,
  accountId: string,
  url?: string,
): Promise<Post> {
  const post = await store.get(postId);
  if (!post) throw new Error('post yok');

  const account = await accounts.get(accountId);
  if (!account) throw new Error(`hesap bulunamadi: ${accountId}`);

  if (post.results.some((r) => r.accountId === accountId && r.ok)) {
    return post; // zaten isaretli; ikinci kez yazma
  }

  post.results.push({
    accountId,
    platform: account.platform,
    ok: true,
    manuel: true,
    at: new Date().toISOString(),
    ...(url?.trim() ? { url: url.trim() } : {}),
  });

  /**
   * Post ancak TUM hedeflerine gittiginde yayinlanmis sayilir. Iki hesaba
   * gidecek bir post tek hesapta elle paylasildi diye kuyruktan dusmemeli.
   */
  const tamamlandi = post.targets.every((t) => post.results.some((r) => r.accountId === t && r.ok));
  if (tamamlandi) post.status = 'published';

  await store.upsert(post);
  return post;
}
