import { readFile, rm } from 'node:fs/promises';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { getTts, duration } from '../providers/tts/index.ts';
import type { Agent, Kelime, SesIstegi, SesSonucu } from './types.ts';

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

    /**
     * Sure siniri. Uretilen seslendirme 85 saniyeye kadar cikti; Shorts,
     * Reels ve TikTok'ta 60 saniyeyi asan dikey video izlenme oranini
     * dusuruyor. Metin cumle sinirindan kirpilir - kelime ortasindan
     * kesmek sesi bozar.
     */
    const saniyeBasinaHarf = 14;
    const sinir = cfg.video.maxSaniye * saniyeBasinaHarf;
    let konusulacak = text.trim();

    if (konusulacak.length > sinir) {
      const cumleler = konusulacak.split(/(?<=[.!?])\s+/);
      let biriken = '';
      for (const c of cumleler) {
        if ((biriken + ' ' + c).trim().length > sinir) break;
        biriken = (biriken + ' ' + c).trim();
      }
      konusulacak = biriken || konusulacak.slice(0, sinir);
      log.warn(`seslendirme ${text.length} -> ${konusulacak.length} harfe kirpildi (${cfg.video.maxSaniye}s siniri)`);
    }

    await tts.speak(konusulacak, outPath, voice ?? cfg.tts.voice);

    /**
     * Kelime zamanlamalari varsa okunur. Saglayici uretmiyorsa (elevenlabs)
     * sessizce atlanir; montaj o zaman harf sayisina gore dagitim yapar.
     */
    let kelimeler: Kelime[] | undefined;
    const zamanDosyasi = `${outPath}.kelime.json`;
    try {
      kelimeler = JSON.parse(await readFile(zamanDosyasi, 'utf8')) as Kelime[];
      if (!kelimeler.length) kelimeler = undefined;
      else log.info(`seslendirme: ${kelimeler.length} kelime zamanlamasi alindi`);
    } catch {
      kelimeler = undefined;
    }
    await rm(zamanDosyasi, { force: true });

    return {
      path: outPath,
      seconds: await duration(outPath),
      provider: tts.id,
      ...(kelimeler ? { kelimeler } : {}),
    };
  },
};
