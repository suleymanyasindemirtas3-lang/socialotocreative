import { icerikBulma } from './icerik-bulma.ts';
import { videoUretim } from './video-uretim.ts';
import { ses } from './ses.ts';
import { video } from './video.ts';
import { senaryo } from './senaryo.ts';
import type { Agent } from './types.ts';

export { icerikBulma, videoUretim, ses, video, senaryo };
export { ekipler, ekipBul } from './ekipler/index.ts';
export { planla, calistir, gorevYolla, kadro } from './lider.ts';
export * from './types.ts';

/**
 * Ajanlar. Yonetmen bu listede yok cunku o bir is degil, produksiyon ekibinin
 * sirasini kuran merci; lider de ekipler arasinda dagitim yapan ust merci.
 */
export const agents: Agent<never, unknown>[] = [
  icerikBulma,
  senaryo,
  ses,
  videoUretim,
  video,
] as unknown as Agent<never, unknown>[];
