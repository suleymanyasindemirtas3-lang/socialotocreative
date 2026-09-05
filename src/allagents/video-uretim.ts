import { getClipSource } from '../providers/clip/index.ts';
import type { Agent, KlipIstegi, KlipSonucu } from './types.ts';

/**
 * 2. VIDEO URETIM
 *
 * Videonun GORUNTUSUNU uretir - montajini degil.
 * Ucretsiz kaynak durgun gorsel dondurur (hareketi montaj ajani verir),
 * ucretli kaynak hazir hareketli klip dondurur.
 *
 * Bu ajanin montajdan ayri durmasinin sebebi maliyet: pahali olan yalniz
 * goruntu uretimi. Ses, altyazi ve formatlama montajda ve bedelsiz kaliyor
 * (Motto 9: pahali olan katman en dar tutulur).
 */
export const videoUretim: Agent<KlipIstegi, KlipSonucu> = {
  id: 'video-uretim',
  role: 'Videonun goruntu kaynagini uretir (gorsel ya da AI klip)',
  uses: ['clip', 'image'],

  async run({ visualPrompt, seconds, outStem, existingStill }): Promise<KlipSonucu> {
    const source = getClipSource();
    const r = await source.produce({
      prompt: visualPrompt,
      seconds,
      outStem,
      ...(existingStill ? { existingStill } : {}),
    });
    return { ...r, provider: source.id };
  },
};
