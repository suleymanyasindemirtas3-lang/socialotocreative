import { publish } from '../../pipeline/publish.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';

/**
 * YAYIN EKIBI
 *
 * Henuz ajanlastirilmadi: mevcut publish() mantigini sariyor.
 * Ekip olarak kayda girmesinin sebebi liderin yayini da dagitabilmesi;
 * icerideki yapisi degistiginde liderde hicbir sey degismeyecek.
 */
export const yayinEkibi: Ekip = {
  id: 'yayin',
  role: 'Onaylanmis postlari hesaplara dagitir',
  members: ['publish'],
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
