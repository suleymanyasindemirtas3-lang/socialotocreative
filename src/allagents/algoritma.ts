import { readFile, writeFile } from 'node:fs/promises';
import { log } from '../core/logger.ts';

/**
 * PLATFORM ALGORITMA BILGI TABANI
 *
 * Sosyal medya uzmani ajani postlari buna gore puanliyor. Bilgi kodda degil
 * veride: platformlar siralama sinyallerini degistiriyor ve degistiginde
 * kod yayinlamak gerekmemeli.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - content/algoritma.json
 * Yeni bir kural eklemek: kurallar dizisine {id, aciklama, etki, tip} ekle.
 * `etki` puana dogrudan girer (odul artir, ceza azaltir).
 * ---------------------------------------------------------------------------
 */

export interface AlgoKural {
  id: string;
  aciklama: string;
  /** Puana katkisi. Pozitif odul, negatif ceza. */
  etki: number;
  tip: 'odul' | 'ceza' | 'notr';
}

export interface PlatformAlgo {
  ad: string;
  kaynak: string;
  etkilesimAgirliklari?: Record<string, number>;
  kurallar: AlgoKural[];
}

export interface AlgoritmaTabani {
  guncelleme: string;
  not: string;
  platformlar: Record<string, PlatformAlgo>;
}

const DOSYA = 'content/algoritma.json';

export async function algoritmaTabani(): Promise<AlgoritmaTabani> {
  try {
    return JSON.parse(await readFile(DOSYA, 'utf8')) as AlgoritmaTabani;
  } catch {
    log.warn('algoritma tabani okunamadi; puanlama yalniz LLM yargisina dayanacak');
    return { guncelleme: '', not: '', platformlar: {} };
  }
}

export async function platformAlgo(id: string): Promise<PlatformAlgo | undefined> {
  return (await algoritmaTabani()).platformlar[id];
}

export async function algoYaz(taban: AlgoritmaTabani): Promise<void> {
  taban.guncelleme = new Date().toISOString().slice(0, 10);
  await writeFile(DOSYA, JSON.stringify(taban, null, 2) + '\n', 'utf8');
}

/**
 * Kurallari LLM'e verilecek metne cevirir.
 * Ajanin kendi bilgisine guvenmek yerine bu tabani okumasi bilincli:
 * model egitim verisi eskiyebilir, bu dosya guncellenebilir.
 */
export function kurallariAnlat(algo: PlatformAlgo): string {
  const satirlar = algo.kurallar.map((k) => {
    const isaret = k.tip === 'ceza' ? 'CEZA' : k.tip === 'odul' ? 'ODUL' : 'NOTR';
    return `- [${isaret} ${k.etki > 0 ? '+' : ''}${k.etki}] ${k.aciklama}`;
  });

  const agirlik = algo.etkilesimAgirliklari
    ? '\nEtkilesim agirliklari (yuksek olan daha degerli): ' +
      Object.entries(algo.etkilesimAgirliklari)
        .map(([k, v]) => `${k}=${v}x`)
        .join(', ')
    : '';

  return `${algo.ad} siralama kurallari:\n${satirlar.join('\n')}${agirlik}`;
}
