import { cfg } from '../core/config.ts';
import { getTts, duration } from '../providers/tts/index.ts';
import type { Agent, SesIstegi, SesSonucu } from './types.ts';

/**
 * 3. SES
 *
 * Seslendirme metnini sese cevirir ve suresini olcer.
 * Sure kritik: montaj ajani video uzunlugunu buradan aliyor, altyazi
 * zamanlamasi da buna gore dagitiliyor.
 *
 * Hangi TTS saglayicisinin kullanildigi bu ajani ilgilendirmez;
 * ucretsizden ucretliye gecis zincirin isi (bkz. docs/PROVIDERS.md).
 */
export const ses: Agent<SesIstegi, SesSonucu> = {
  id: 'ses',
  role: 'Seslendirme uretir ve suresini olcer',
  uses: ['tts'],

  async run({ text, outPath, voice }): Promise<SesSonucu> {
    const tts = getTts();
    await tts.speak(text, outPath, voice ?? cfg.tts.voice);
    return { path: outPath, seconds: await duration(outPath), provider: tts.id };
  },
};
