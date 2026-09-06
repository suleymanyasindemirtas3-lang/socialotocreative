import { log } from '../../core/logger.ts';
import { cfg } from '../../core/config.ts';
import { gundemToplayici } from '../gundem.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';
import type { TrendItem } from '../../kaynaklar/index.ts';

/**
 * ARASTIRMA EKIBI
 *
 * Dis kaynaklarla iliskiyi tek elde toplar. Baska hicbir ekip disariya
 * istek atmaz; gundeme ihtiyaci olan bu ekipten ister.
 *
 * Iki kullanim yolu var:
 *   1. Lider `gundem-topla` gorevi acar, sonucu bir sonraki ekibe girdi verir.
 *   2. Bir ekip lideri (ornegin yonetmen) dogrudan `iste()` cagirir.
 *
 * Ikincisi bilincli bir istisna: uretim sirasinda "bu konuda ne var" diye
 * sormak icin tur beklemek anlamsiz olurdu. Ama yalnizca EKIP LIDERLERI
 * cagirabilir, tek tek ajanlar degil.
 */

let onbellek: { at: number; items: TrendItem[] } | null = null;

/**
 * Gundemi dondurur. Kisa sureli onbellek var: ayni turda uc ajan gundem
 * isterse uc kez dis istek atilmasin.
 */
export async function iste(adet = cfg.sources.limit): Promise<TrendItem[]> {
  const taze = onbellek && Date.now() - onbellek.at < cfg.sources.cacheMs;
  if (taze && onbellek!.items.length >= adet) {
    log.info(`gundem onbellekten (${onbellek!.items.length} madde)`);
    return onbellek!.items.slice(0, adet);
  }

  const items = await gundemToplayici.run({ adet });
  onbellek = { at: Date.now(), items };
  return items;
}

/** Konuya gore suzulmus gundem. Yonetmen "bu konuda ne var" diye sorabilsin. */
export async function isteKonulu(konu: string, adet = 5, zorunluEslesme = false): Promise<TrendItem[]> {
  const hepsi = await iste();
  const kelimeler = konu
    .toLocaleLowerCase('tr')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const puanli = hepsi.map((it) => {
    const t = it.title.toLocaleLowerCase('tr');
    return { it, hit: kelimeler.filter((k) => t.includes(k)).length };
  });

  const eslesen = puanli.filter((p) => p.hit > 0).sort((a, b) => b.hit - a.hit);

  /**
   * `zorunluEslesme` metin baglami icin gerekmez ama GORSEL icin sarttir:
   * eslesme yokken "en populerler"e dusmek, habere alakasiz bir fotograf
   * takmak demek. Yanlis fotograf, fotografsizliktan kotu.
   */
  if (zorunluEslesme) return eslesen.map((p) => p.it).slice(0, adet);

  // Hicbiri eslesmezse bos donmek yerine en populerleri ver: bos baglamdan iyidir.
  return (eslesen.length ? eslesen.map((p) => p.it) : hepsi).slice(0, adet);
}

export const arastirmaEkibi: Ekip = {
  id: 'arastirma',
  role: 'Dis kaynaklardan gundem toplar, diger ekiplere servis eder',
  members: ['gundem-toplayici'],
  handles: ['gundem-topla'],

  async run(gorev: Gorev): Promise<GorevSonucu> {
    const head = { gorev, ekip: 'arastirma' };
    try {
      const items = await iste(gorev.adet);
      return {
        ...head,
        ok: true,
        ozet: `${items.length} gundem maddesi`,
        veri: items,
      };
    } catch (e) {
      // Gundem alinamamasi hatti durdurmaz; fikir yine uretilir, kalitesi duser.
      return { ...head, ok: false, ozet: 'gundem alinamadi', error: String(e) };
    }
  },
};
