import { icerikBulma } from './icerik-bulma.ts';
import { videoUretim } from './video-uretim.ts';
import { ses } from './ses.ts';
import { video } from './video.ts';
import { senaryo } from './senaryo.ts';
import { gundemToplayici } from './gundem.ts';
import { sosyalMedyaUzmani } from './sosyal-medya-uzmani.ts';
import { yayinci } from './yayinci.ts';
import type { Agent } from './types.ts';

export { icerikBulma, videoUretim, ses, video, senaryo, gundemToplayici, sosyalMedyaUzmani, yayinci };
export { ekipler, ekipBul, gundemIste, isteKonulu } from './ekipler/index.ts';
export { planla, calistir, gorevYolla, kadro, kategoridenUret } from './lider.ts';
export * from './types.ts';

/**
 * Ajanlar. Yonetmen bu listede yok cunku o bir is degil, produksiyon ekibinin
 * sirasini kuran merci; lider de ekipler arasinda dagitim yapan ust merci.
 */
export const agents: Agent<never, unknown>[] = [
  gundemToplayici,
  icerikBulma,
  senaryo,
  ses,
  videoUretim,
  video,
  sosyalMedyaUzmani,
  yayinci,
] as unknown as Agent<never, unknown>[];
