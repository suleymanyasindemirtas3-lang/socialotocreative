import { arastirmaEkibi } from './arastirma.ts';
import { icerikEkibi } from './icerik.ts';
import { produksiyonEkibi } from './produksiyon.ts';
import { stratejiEkibi } from './strateji.ts';
import { yayinEkibi } from './yayin.ts';
import type { Ekip, GorevTuru } from '../types.ts';

/**
 * Ekip kaydi. Yeni ekip eklemek: bir dosya yaz, bu diziye ekle.
 * Lider bu listeye bakarak dagitim yapar; ekip adlarini bilmez.
 */
export const ekipler: Ekip[] = [arastirmaEkibi, icerikEkibi, produksiyonEkibi, stratejiEkibi, yayinEkibi];

/** Gorevi ustlenebilecek ilk ekip. */
export function ekipBul(tur: GorevTuru): Ekip | undefined {
  return ekipler.find((e) => e.handles.includes(tur));
}

export { arastirmaEkibi, icerikEkibi, produksiyonEkibi, stratejiEkibi, yayinEkibi };
export { puanla } from './strateji.ts';
export { iste as gundemIste, isteKonulu } from './arastirma.ts';
