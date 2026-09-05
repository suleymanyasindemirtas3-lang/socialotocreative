import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const run = promisify(execFile);

/**
 * Seslendirme: edge-tts (Microsoft Edge'in TTS ucu).
 * Anahtar istemez, ucretsiz, Turkce sesleri var. Ucretli gecis ElevenLabs;
 * ayni imza korunur, yalnizca bu dosya degisir.
 */
export const VOICES = {
  tr_male: 'tr-TR-AhmetNeural',
  tr_female: 'tr-TR-EmelNeural',
} as const;

export async function speak(text: string, outPath: string, voice: string = VOICES.tr_male): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const rate = process.env['TTS_RATE'] ?? '+8%';
  await run('python', ['-m', 'edge_tts', '--voice', voice, '--rate', rate, '--text', text, '--write-media', outPath], {
    maxBuffer: 1 << 24,
  });
  return outPath;
}

/** ffprobe ile sure; video suresini sese gore kurmak icin gerekli. */
export async function duration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const d = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`sure okunamadi: ${file}`);
  return d;
}
