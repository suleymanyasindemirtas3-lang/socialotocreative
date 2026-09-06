import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import type { Tier } from '../core/types.ts';

/**
 * TREND KAYNAKLARI
 *
 * Neden var: icerik-bulma ajani onceden LLM'e "konu uydur" diyordu. Model
 * gercek gundemi bilmedigi icin cikan sey hep jenerikti ("yapay zekanin
 * gelecegi", "yazilimda verimlilik"). Kok sebep buydu.
 *
 * Artik fikirler gercek gundem maddelerine dayaniyor. Model konu UYDURMUYOR,
 * gercek bir maddeyi yorumluyor.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE: Kendi nisine gore kaynak eklemek istersen buraya bak.
 * En kolay yol RSS: .env icindeki RSS_FEEDS satirina virgulle URL ekle.
 * Kod yazman gerekmez.
 * ---------------------------------------------------------------------------
 */

export interface TrendItem {
  title: string;
  url?: string;
  /** Populerlik gostergesi (oy, yildiz, reaksiyon). Siralamada kullanilir. */
  score?: number;
  source: string;
  /**
   * Haberin ozeti. Modelin yazacak GERCEK bilgisi budur; yoksa elinde
   * yalnizca baslik kalir ve basligi yeniden yazmaktan oteye gidemez.
   */
  ozet?: string;
  /** Haberin kendi fotografi. Soyut AI gorseli uretmekten cok daha iyi. */
  gorsel?: string;
  tarih?: string;
  /** Kaynagin kendi kategori etiketi; kategori eslesmesini dogrulamaya yarar. */
  kaynakKategori?: string;
}

export interface TrendSource {
  id: string;
  tier: Tier;
  isConfigured(): boolean;
  fetch(limit: number): Promise<TrendItem[]>;
}

const UA = { 'user-agent': 'socialmediai/0.1 (+https://github.com)' };

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

/** Hacker News. Anahtarsiz, kotasiz, teknoloji gundeminin en iyi tek kaynagi. */
const hackernews: TrendSource = {
  id: 'hackernews',
  tier: 'free',
  isConfigured: () => true,
  async fetch(limit) {
    const j = await json<{ hits: { title: string; url?: string; points?: number }[] }>(
      `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}`,
    );
    return j.hits
      .filter((h) => h.title)
      .map((h) => ({ title: h.title, url: h.url, score: h.points, source: 'hackernews' }));
  },
};

/** Dev.to. Yazilim yazarlarinin gundemi; HN'den daha uygulama odakli. */
const devto: TrendSource = {
  id: 'devto',
  tier: 'free',
  isConfigured: () => true,
  async fetch(limit) {
    const j = await json<
      { title: string; url: string; positive_reactions_count: number }[]
    >(`https://dev.to/api/articles?top=7&per_page=${limit}`);
    return j.map((a) => ({
      title: a.title,
      url: a.url,
      score: a.positive_reactions_count,
      source: 'devto',
    }));
  },
};

/**
 * GitHub'da YENI acilip hizla yildiz toplayan projeler.
 *
 * Ilk denemede `pushed:>tarih` + `sort=stars` kullanildi; sonuc awesome,
 * freeCodeCamp gibi yillik devlerdi - bunlar trend degil, yalnizca buyuk.
 * `created:>tarih` gercekten yeni cikani gosteriyor.
 *
 * Resmi trending API'si yok; arama ucu anahtarsiz calisiyor,
 * kota saatte 60 istek (gunde birkac tur icin fazlasiyla yeter).
 */
const github: TrendSource = {
  id: 'github',
  tier: 'free',
  isConfigured: () => true,
  async fetch(limit) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const j = await json<{
      items: { full_name: string; description?: string; stargazers_count: number; html_url: string }[];
    }>(
      `https://api.github.com/search/repositories?q=created:%3E${since}+stars:%3E100&sort=stars&order=desc&per_page=${limit}`,
    );
    return j.items.map((r) => ({
      title: `${r.full_name}: ${r.description ?? ''}`.trim(),
      url: r.html_url,
      score: r.stargazers_count,
      source: 'github',
    }));
  },
};

/** CDATA, HTML etiketi ve varlik kodlarini temizler. */
function temizle(ham: string | undefined): string {
  if (!ham) return '';
  return ham
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function etiket(blok: string, ad: string): string {
  const m = new RegExp(`<${ad}[^>]*>([\\s\\S]*?)</${ad}>`, 'i').exec(blok);
  return temizle(m?.[1]);
}

/**
 * Genel RSS okuyucu.
 *
 * Onceden yalnizca BASLIK aliniyordu. Model basliktan baska veri gormedigi
 * icin yapabildigi tek sey basligi yeniden yazmakti - icerigin zayif
 * olmasinin kok sebebi buydu.
 *
 * Simdi RSS'in verdigi her seyi aliyoruz:
 *   description - haberin ozeti; modelin yazacak gercek bilgisi olur
 *   enclosure   - haberin GERCEK fotografi; soyut AI gorseli uretmekten iyi
 *   pubDate     - tazelik; eski haber one cikmasin
 *   category    - kaynagin kendi kategorisi; kategori eslesmesini dogrular
 *
 * Tam XML ayristiricisi yerine desen eslesmesi: bagimlilik eklememek icin
 * bilincli tercih, RSS ve Atom'un ikisinde de calisiyor.
 */
async function rssOku(feedler: string[], limit: number): Promise<TrendItem[]> {
  const out: TrendItem[] = [];
  const perFeed = Math.max(1, Math.ceil(limit / feedler.length));

  for (const feed of feedler) {
    try {
      const res = await fetch(feed, { headers: UA });
      if (!res.ok) throw new Error(`${res.status}`);
      const xml = await res.text();

      const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1, perFeed + 1);
      for (const b of blocks) {
        const title = etiket(b, 'title');
        if (!title) continue;

        const link =
          /<link[^>]*href=["']([^"']+)/i.exec(b)?.[1] ??
          temizle(/<link[^>]*>([\s\S]*?)<\/link>/i.exec(b)?.[1]);

        // Ozet birkac yerde olabilir; en dolgun olani secilir.
        const ozet = [
          etiket(b, 'content:encoded'),
          etiket(b, 'description'),
          etiket(b, 'summary'),
          etiket(b, 'content'),
        ].sort((x, y) => y.length - x.length)[0];

        /**
         * Haberin kendi fotografi, ucuzdan pahaliya:
         *   1. enclosure / media:content - standart yer
         *   2. ozetin icine gomulmus <img> - Billboard gibi siteler boyle
         * Ikisi de yoksa gorsel burada birakilir; yonetmen gerektiginde
         * haber sayfasindan og:image ile alir (bkz. haberFotografi).
         */
        const gomulu = () => {
          const govde = [
            /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i.exec(b)?.[1],
            /<description[^>]*>([\s\S]*?)<\/description>/i.exec(b)?.[1],
            /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(b)?.[1],
          ]
            .filter(Boolean)
            .join(' ')
            // RSS govdesi cogu zaman kacisli HTML tasir; once cozulmeli.
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&');
          return /<img[^>]+src=["']([^"']+)/i.exec(govde)?.[1];
        };

        const gorsel =
          /<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)/i.exec(b)?.[1] ??
          /<media:(?:content|thumbnail)[^>]*url=["']([^"']+)/i.exec(b)?.[1] ??
          gomulu();

        const tarih = etiket(b, 'pubDate') || etiket(b, 'published') || etiket(b, 'updated');

        out.push({
          title,
          url: link,
          source: new URL(feed).hostname,
          ...(ozet && ozet !== title ? { ozet: ozet.slice(0, 600) } : {}),
          ...(gorsel ? { gorsel } : {}),
          ...(tarih ? { tarih } : {}),
          ...(etiket(b, 'category') ? { kaynakKategori: etiket(b, 'category') } : {}),
        });
      }
    } catch (e) {
      log.warn(`rss ${feed}: ${String(e).slice(0, 80)}`);
    }
  }
  return out;
}

const rss: TrendSource = {
  id: 'rss',
  tier: 'free',
  isConfigured: () => cfg.sources.feeds.length > 0,
  fetch: (limit) => rssOku(cfg.sources.feeds, limit),
};

/** Verilen RSS listesinden okuyan gecici kaynak; kategori kaynaklari icin. */
function rssFeedKaynagi(feedler: string[]): TrendSource {
  return {
    id: 'kategori-rss',
    tier: 'free',
    isConfigured: () => true,
    fetch: (adet) => rssOku(feedler, adet),
  };
}

const registry: Record<string, TrendSource> = { hackernews, devto, github, rss };

export const sourceRegistry = registry;

/**
 * Secili kaynaklardan gundem toplar.
 * Bir kaynak cokerse digerleri devam eder: gundem verisi olmadan da fikir
 * uretilebilmeli, yalnizca kalitesi duser (Motto 8).
 */
export async function gundemTopla(
  limit = cfg.sources.limit,
  feedler?: string[],
): Promise<TrendItem[]> {
  /**
   * Kategori kendi kaynaklarini verdiyse yalniz onlar kullanilir.
   * Global chain (hackernews/github/devto) yalniz kategori kaynagi yokken
   * devreye girer - o kaynaklar gelistirici odakli, magazin ya da spor
   * icerigi icin anlamsiz.
   */
  const active: TrendSource[] = feedler?.length
    ? [rssFeedKaynagi(feedler)]
    : cfg.sources.chain
        .map((id) => registry[id])
        .filter((s): s is TrendSource => Boolean(s?.isConfigured()));

  if (!active.length) return [];

  const perSource = Math.max(2, Math.ceil(limit / active.length));
  const results = await Promise.allSettled(active.map((s) => s.fetch(perSource)));

  const items: TrendItem[] = [];
  for (const [i, r] of results.entries()) {
    const src = active[i]!;
    if (r.status === 'fulfilled') items.push(...r.value);
    else log.warn(`kaynak ${src.id} cokti: ${String(r.reason).slice(0, 100)}`);
  }

  // Kaynaklar arasi skorlar KIYASLANAMAZ: GitHub yildizi bes haneli, dev.to
  // reaksiyonu iki haneli. Global siralama tek kaynagin listeyi ele
  // gecirmesine yol acar. Her kaynak kendi icinde siralanip donusumlu
  // (round-robin) harmanlaniyor.
  const bySource = new Map<string, TrendItem[]>();
  for (const it of items) {
    const arr = bySource.get(it.source) ?? [];
    arr.push(it);
    bySource.set(it.source, arr);
  }
  for (const arr of bySource.values()) arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const mixed: TrendItem[] = [];
  const lists = [...bySource.values()];
  for (let i = 0; mixed.length < limit; i++) {
    let eklendi = false;
    for (const arr of lists) {
      const item = arr[i];
      if (item) {
        mixed.push(item);
        eklendi = true;
        if (mixed.length >= limit) break;
      }
    }
    if (!eklendi) break;
  }

  log.info(`gundem: ${mixed.length} madde (${active.map((s) => s.id).join(', ')})`);
  return mixed;
}

/* ==================================================== HABER FOTOGRAFI ==== */

/**
 * HABERIN SAYFASINDAN FOTOGRAF CIKARMA
 *
 * Olcum (15 kaynak, 75 haber):
 *   %60 RSS'te enclosure/media:content ile fotograf veriyor
 *   %4  fotografi description icindeki <img> etiketinde saklıyor
 *   %36 RSS'te HIC fotograf vermiyor
 *
 * O %36'lik dilim (Anime News Network, Merlin'in Kazani, ShiftDelete,
 * The Verge, TechCrunch) AI uretimine dusuyordu ve cikan gorsel konudan
 * kopuk oluyordu: "Sabrina Carpenter Muppet Show" haberine model jenerik
 * bir sahne cizdi, oysa Billboard'un haber sayfasinda gercek fotograf
 * duruyordu.
 *
 * Bu 27 habere sayfalarindan bakildiginda 27'sinde de og:image bulundu -
 * yani kayip veri degil, ALINMAYAN veri. Sosyal medyada paylasilmak icin
 * konan etiket zaten bu; her haber sitesi koyuyor.
 *
 * Neden RSS toplarken degil de burada: gundem toplarken 20 haberin 20
 * sayfasini indirmek gereksiz, cunku sonunda 1-3 tanesi kullaniliyor.
 * Yonetmen gorseli gercekten isteyince tek sayfa indiriliyor.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Bir kaynak fotograf vermiyorsa once RSS'ine bak
 * (enclosure var mi), sonra haber sayfasinda og:image var mi diye bak.
 * Ikisi de yoksa o kaynak gorsel icin uygun degil.
 * ---------------------------------------------------------------------------
 */

/** Tarayici gibi gorunmek gerekiyor: bazi siteler bot UA'ya sayfa vermiyor. */
const TARAYICI_UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml',
};

/** og:image, twitter:image ya da link rel=image_src. Ilk bulunan kazanir. */
function metaGorsel(html: string): string | undefined {
  const desenler = [
    /<meta[^>]+property=["']og:image(?::url|:secure_url)?["'][^>]*content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::url|:secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)/i,
  ];
  for (const d of desenler) {
    const m = d.exec(html)?.[1];
    if (m) return m.replace(/&amp;/g, '&').trim();
  }
  return undefined;
}

/**
 * Haber sayfasini acip paylasim fotografini dondurur.
 *
 * Sayfanin tamami indirilmez; </head> gorulunce durulur, cunku og:image
 * orada. Boyut siniri yalnizca emniyet freni.
 *
 * Sinir neden 1 MB: ilk denemede 300 KB koymustum ve Billboard'da
 * calismadi - o sitenin <head>'i 567 KB (satir ici script ve stil yigini),
 * og:image 558. kilobayttaydi. Olcmeden konan sinir, duzelttigi sorunun
 * aynisini uretiyordu.
 */
export async function haberFotografi(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: TARAYICI_UA, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !res.body) return undefined;

    let html = '';
    const cozucu = new TextDecoder();
    for await (const parca of res.body as unknown as AsyncIterable<Uint8Array>) {
      html += cozucu.decode(parca, { stream: true });
      if (html.length > 1_000_000 || /<\/head>/i.test(html)) break;
    }
    await res.body.cancel().catch(() => {});

    const bulunan = metaGorsel(html);
    if (!bulunan) return undefined;

    // Goreli adres olabilir; haberin kendi adresine gore cozulur.
    return new URL(bulunan, url).toString();
  } catch (e) {
    log.warn(`haber fotografi alinamadi: ${String(e).slice(0, 80)}`);
    return undefined;
  }
}
