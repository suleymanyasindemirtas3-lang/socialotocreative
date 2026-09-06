import { uret, tekrarDene } from '../yonetmen.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';

/**
 * PRODUKSIYON EKIBI
 *
 * Yazilmis metni medyaya cevirir. Lideri `yonetmen`; ekip icindeki sira ve
 * kosullar orada kurulur, bu dosya yalnizca gorev arayuzunu saglar.
 *
 * Girdi 'scripted' durumdaki post, cikti gorsel ve/veya video.
 */
export const produksiyonEkibi: Ekip = {
  id: 'produksiyon',
  role: 'Metni gorsele, sese ve videoya cevirir',
  members: ['ses', 'video-uretim', 'video'],
  lead: 'yonetmen',
  handles: ['medya-uret', 'tekrar-dene'],

  async run(gorev: Gorev): Promise<GorevSonucu> {
    const head = { gorev, ekip: 'produksiyon' };
    try {
      if (gorev.tur === 'tekrar-dene') {
        return { ...head, ok: true, ozet: `${await tekrarDene(gorev.adet)} post geri alindi` };
      }
      // Kategori verildiyse yalniz o kategorinin postlari islenir; yoksa
      // kullanicinin az once istedigi postlar yerine kuyruktaki eskiler
      // isleniyordu.
      return { ...head, ok: true, ozet: `${await uret(gorev.adet, gorev.kategori)} medya uretildi` };
    } catch (e) {
      return { ...head, ok: false, ozet: 'basarisiz', error: String(e) };
    }
  },
};
