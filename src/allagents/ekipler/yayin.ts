import { publish } from '../yayinci.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';

/**
 * YAYIN EKIBI
 *
 * Uyesi `yayinci` ajani. Onaylanmis postlari hesaplara dagitir.
 * Uzun sure pipeline/publish.ts olarak ajan disinda duruyordu; diger
 * her sey ajanlasmisken burasi istisna kalmisti, duzeltildi.
 */
export const yayinEkibi: Ekip = {
  id: 'yayin',
  role: 'Onaylanmis postlari hesaplara dagitir',
  members: ['yayinci'],
  handles: ['yayinla'],

  async run(gorev: Gorev): Promise<GorevSonucu> {
    const head = { gorev, ekip: 'yayin' };
    try {
      const n = (await publish(gorev.adet)).length;
      return { ...head, ok: true, ozet: `${n} post islendi` };
    } catch (e) {
      return { ...head, ok: false, ozet: 'basarisiz', error: String(e) };
    }
  },
};
