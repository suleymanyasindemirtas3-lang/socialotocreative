import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { brandVoice } from '../core/brand.ts';
import { extractObjects, str } from '../core/json.ts';
import { fingerprint } from '../core/fingerprint.ts';
import { getLlm } from '../providers/llm/index.ts';
import type { Agent, Fikir, FikirIstegi } from './types.ts';

/**
 * 1. ICERIK BULMA
 *
 * Ne uretilecegine karar veren ajan. Konu havuzu cikarir ve daha once
 * uretilmis olanlari eler. Metin YAZMAZ - o senaryo ajaninin isi.
 *
 * Ayrilma sebebi: "ne anlatalim" ile "nasil anlatalim" farkli problemler.
 * Ilkinde tekrar, ikincisinde uslup onemli.
 *
 * Fikirler GERCEK GUNDEME dayanir. Onceden modele "konu uydur" deniyordu ve
 * cikan sey hep jenerikti; model gundemi bilmedigi icin genel gecer laf
 * uretiyordu. Artik somut bir maddeyi yorumluyor.
 *
 * Gundem alinamazsa hat durmaz, model yine uretir - yalnizca kalitesi duser.
 *
 * Gundemi KENDISI TOPLAMAZ: arastirma ekibinden gelir. Dis dunyaya uzanan
 * tek yer o ekip; boylece kaynak coktugunde nerede oldugu belli oluyor.
 */
/**
 * Iki metnin kelime ortusmesi (0-1).
 * Modelin verdigi kaynak indeksi guvenilir degil: zayif modeller yanlis
 * numara veriyor ve haberin ozeti bambaska bir habere ait oluyor.
 * Bu yuzden indeks dogrulaniyor, tutmuyorsa en cok ortusen haber secilir.
 */
function ortusme(a: string, b: string): number {
  const kelime = (t: string) =>
    new Set(
      t.toLocaleLowerCase('tr')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const A = kelime(a);
  const B = kelime(b);
  if (!A.size || !B.size) return 0;
  let kesisim = 0;
  for (const w of A) if (B.has(w)) kesisim++;
  return kesisim / Math.min(A.size, B.size);
}

export const icerikBulma: Agent<FikirIstegi, Fikir[]> = {
  id: 'icerik-bulma',
  role: 'Konu havuzu cikarir, tekrar edenleri eler',
  uses: ['llm'],

  async run({ count, recent, seen, gundem = [], kategori }): Promise<Fikir[]> {
    const llm = getLlm();

    const prompt = [
      `Nis: ${cfg.brand.niche}. Dil: ${cfg.brand.language}.`,
      kategori
        ? `ICERIK KATEGORISI: ${kategori.ad}
${kategori.yonerge}
` +
          'Uretecegin fikirler bu bicime uygun olmali.'
        : '',
      gundem.length
        ? 'Asagidaki GERCEK gundem maddelerinden yola cikarak fikir uret. ' +
          'Her fikir bir maddeye dayansin; genel gecer konu uydurma.\n' +
          gundem.map((g) => `- [${g.source}] ${g.title}`).join('\n')
        : '',
      `${count * 2} adet ozgun sosyal medya post fikri uret.`,
      recent.length ? `Bunlara benzeme:\n${recent.map((t) => '- ' + t).join('\n')}` : '',
      'Yalnizca su semada JSON dizisi dondur, baska hicbir metin yazma:',
      '[{"topic":"tek cumlelik konu","angle":"bakis acisi","kaynak":0}]',
      '"kaynak" alani, fikrin dayandigi haberin kose parantez icindeki numarasi olsun.',
    ].filter(Boolean).join('\n\n');

    const raw = await llm.complete(prompt, { system: await brandVoice(), maxTokens: 1200, json: true });

    const ideas = extractObjects(raw)
      .map((o) => {
        const topic = str(o, 'topic', 'konu', 'title', 'baslik');
        const idx = Number(o['kaynak'] ?? o['source'] ?? -1);

        // Once modelin verdigi indeks; ortusme dusukse benzerlikle duzelt.
        let g = Number.isInteger(idx) && idx >= 0 ? gundem[idx] : undefined;
        if (!g || ortusme(topic, g.title) < 0.3) {
          const enIyi = gundem
            .map((h) => ({ h, p: ortusme(topic, h.title) }))
            .sort((x, y) => y.p - x.p)[0];
          if (enIyi && enIyi.p >= 0.3) g = enIyi.h;
          else g = undefined;
        }
        return {
          topic,
          angle: str(o, 'angle', 'aci', 'bakis', 'bakis_acisi'),
          ...(g
            ? {
                kaynak: {
                  ...(g.ozet ? { ozet: g.ozet } : {}),
                  ...(g.url ? { url: g.url } : {}),
                  ...(g.gorsel ? { gorsel: g.gorsel } : {}),
                  site: g.source,
                },
              }
            : {}),
        };
      })
      .filter((i) => i.topic.length > 8);

    if (!ideas.length) {
      log.err('kullanilabilir fikir donmedi:\n' + raw.slice(0, 300));
      return [];
    }

    const fresh: Fikir[] = [];
    for (const idea of ideas) {
      if (fresh.length >= count) break;
      const fp = fingerprint(idea.topic);
      if (seen.has(fp)) {
        log.warn(`tekrar elendi: ${idea.topic}`);
        continue;
      }
      seen.add(fp);
      fresh.push(idea);
    }
    return fresh;
  },
};
