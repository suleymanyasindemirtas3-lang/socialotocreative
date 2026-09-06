import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from '../../core/logger.ts';
import type { MediaAsset } from '../../core/types.ts';

/**
 * WEB GORSEL ARAMA
 *
 * AI gorsel uretimi teknik konularda jenerik "AI sanati" uretiyor: Python GIL
 * konulu bir posta alakasiz soyut bir kure cizdi. Bazen gercek bir fotograf ya
 * da mizahi bir sablon daha iyi is goruyor.
 *
 * Iki kaynak, ikisi de anahtarsiz:
 *   openverse - ticari kullanima acik CC lisansli gorseller (hukuken guvenli)
 *   imgflip   - mizah sablonlari ("espirili gorsel" icin)
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE: Baska bir kaynak eklemek istersen KAYNAKLAR dizisine ekle.
 * Tek kural: anahtarsiz calissin ve lisansi paylasima uygun olsun.
 * ---------------------------------------------------------------------------
 */

export interface GorselAday {
  kaynak: string;
  /** Tam boy gorsel adresi (indirilecek olan). */
  url: string;
  /** Onizleme adresi; panel bunu gosterir. */
  thumb: string;
  baslik: string;
  lisans?: string;
  /** Atif icin kaynak sayfa. */
  sayfa?: string;
}

const UA = { 'user-agent': 'socialotocreative/0.1' };

/**
 * Arama motorlari cumle degil anahtar kelime bekliyor.
 * Senaryo ajaninin urettigi gorsel istemi tam bir ingilizce cumle oldugu icin
 * ("Editorial illustration of a global lock blocking...") hicbir sonuc
 * getirmiyordu. En anlamli kelimeler ayiklaniyor.
 */
const DOLGU = new Set([
  'the', 'and', 'with', 'for', 'from', 'that', 'this', 'into', 'over', 'under',
  'illustration', 'image', 'photo', 'picture', 'background', 'style', 'minimal',
  'clean', 'modern', 'abstract', 'editorial', 'text', 'showing', 'depicting',
]);

function anahtarKelimeler(sorgu: string, adet: number): string {
  const kelimeler = sorgu
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !DOLGU.has(w));
  return (kelimeler.length ? kelimeler : sorgu.split(/\s+/)).slice(0, adet).join(' ');
}

async function openverseIste(q: string, adet: number): Promise<GorselAday[]> {
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}` +
    `&page_size=${adet}&license_type=commercial&mature=false`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`openverse ${res.status}`);

  const j = (await res.json()) as {
    results?: {
      title?: string;
      url: string;
      thumbnail?: string;
      license?: string;
      creator?: string;
      foreign_landing_url?: string;
    }[];
  };

  return (j.results ?? []).map((r) => ({
    kaynak: 'openverse',
    url: r.url,
    thumb: r.thumbnail || r.url,
    baslik: r.title || q,
    lisans: [r.license?.toUpperCase(), r.creator].filter(Boolean).join(' · '),
    sayfa: r.foreign_landing_url,
  }));
}

/**
 * Ticari kullanima acik CC gorselleri.
 * Uc kelimeyle baslar, sonuc bos gelirse kademeli daraltir: dar sorgu az ama
 * ilgili sonuc verir, genis sorgu hic sonuc vermez.
 */
async function openverse(sorgu: string, adet: number): Promise<GorselAday[]> {
  for (const n of [3, 2, 1]) {
    const q = anahtarKelimeler(sorgu, n);
    if (!q) continue;
    try {
      const sonuc = await openverseIste(q, adet);
      if (sonuc.length) return sonuc;
      log.info(`openverse "${q}" bos, daraltiliyor`);
    } catch (e) {
      log.warn(`openverse "${q}": ${String(e).slice(0, 60)}`);
    }
  }
  return [];
}

/**
 * Mizah sablonlari. Arama ucu yok; tum sablonlar cekilip isimde eslesme
 * araniyor, eslesme yoksa populer olanlar donuyor.
 */
async function imgflip(sorgu: string, adet: number): Promise<GorselAday[]> {
  const res = await fetch('https://api.imgflip.com/get_memes', { headers: UA });
  if (!res.ok) throw new Error(`imgflip ${res.status}`);

  const j = (await res.json()) as { data?: { memes?: { name: string; url: string }[] } };
  const hepsi = j.data?.memes ?? [];

  const kelimeler = sorgu.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const eslesen = hepsi.filter((m) => kelimeler.some((k) => m.name.toLowerCase().includes(k)));
  const secilen = (eslesen.length ? eslesen : hepsi).slice(0, adet);

  return secilen.map((m) => ({
    kaynak: 'imgflip',
    url: m.url,
    thumb: m.url,
    baslik: m.name,
    lisans: 'mizah sablonu',
  }));
}

const KAYNAKLAR: Record<string, (s: string, n: number) => Promise<GorselAday[]>> = {
  openverse,
  imgflip,
};

/** Bir kaynak cokerse digerleri devam eder. */
export async function gorselAra(sorgu: string, adet = 6, kaynaklar = ['openverse']): Promise<GorselAday[]> {
  const secili = kaynaklar.filter((k) => k in KAYNAKLAR);
  if (!secili.length) return [];

  const perSource = Math.max(2, Math.ceil(adet / secili.length));
  const sonuclar = await Promise.allSettled(secili.map((k) => KAYNAKLAR[k]!(sorgu, perSource)));

  const out: GorselAday[] = [];
  for (const [i, r] of sonuclar.entries()) {
    if (r.status === 'fulfilled') out.push(...r.value);
    else log.warn(`gorsel arama ${secili[i]}: ${String(r.reason).slice(0, 80)}`);
  }
  return out.slice(0, adet);
}

/** Secilen adayi indirip posta ait medya dosyasina cevirir. */
export async function adayiIndir(aday: GorselAday, outPath: string): Promise<MediaAsset> {
  const res = await fetch(aday.url, { headers: UA });
  if (!res.ok) throw new Error(`gorsel indirilemedi: ${res.status}`);

  const tip = res.headers.get('content-type') ?? 'image/jpeg';
  if (!tip.startsWith('image/')) throw new Error(`gorsel degil: ${tip}`);

  const uzanti = tip.includes('png') ? '.png' : tip.includes('webp') ? '.webp' : '.jpg';
  const path = outPath.replace(/\.[a-z0-9]+$/i, uzanti);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));

  // Atif alt metinde tasiniyor: CC lisansi kaynak belirtmeyi gerektiriyor.
  const alt = [aday.baslik, aday.lisans].filter(Boolean).join(' — ').slice(0, 280);
  return { kind: 'image', path, alt, mime: tip };
}
