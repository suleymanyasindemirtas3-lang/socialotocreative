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

/**
 * Genel RSS. Kendi nisinin kaynaklarini eklemenin en kolay yolu.
 * Tam bir XML ayristiricisi yerine desen eslesmesi kullaniliyor: bagimlilik
 * eklememek icin bilincli tercih, RSS ve Atom'un ikisinde de calisiyor.
 */
async function rssOku(feedler: string[], limit: number): Promise<TrendItem[]> {
  {
    const out: TrendItem[] = [];
    const perFeed = Math.max(1, Math.ceil(limit / feedler.length));

    for (const feed of feedler) {
      try {
        const res = await fetch(feed, { headers: UA });
        if (!res.ok) throw new Error(`${res.status}`);
        const xml = await res.text();

        const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1, perFeed + 1);
        for (const b of blocks) {
          const title = /<title[^>]*>([\s\S]*?)<\/title>/i
            .exec(b)?.[1]
            ?.replace(/<!\[CDATA\[|\]\]>/g, '')
            .replace(/<[^>]+>/g, '')
            .trim();
          const link =
            /<link[^>]*href=["']([^"']+)/i.exec(b)?.[1] ??
            /<link[^>]*>([\s\S]*?)<\/link>/i.exec(b)?.[1]?.trim();
          if (title) out.push({ title, url: link, source: new URL(feed).hostname });
        }
      } catch (e) {
        log.warn(`rss ${feed}: ${String(e).slice(0, 80)}`);
      }
    }
    return out;
  }
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
