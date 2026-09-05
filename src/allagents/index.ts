import { icerikBulma } from './icerik-bulma.ts';
import { videoUretim } from './video-uretim.ts';
import { ses } from './ses.ts';
import { video } from './video.ts';
import { senaryo } from './senaryo.ts';
import type { Agent } from './types.ts';

export { icerikBulma, videoUretim, ses, video, senaryo };
export { bulFikir, uret, tekrarDene } from './yonetmen.ts';
export * from './types.ts';

/**
 * Yonetmen disindaki ajanlar. Yonetmen bu listede yok cunku o bir is degil,
 * bu islerin sirasini kuran merci.
 */
export const agents: Agent<never, unknown>[] = [
  icerikBulma,
  videoUretim,
  ses,
  video,
  senaryo,
] as unknown as Agent<never, unknown>[];
