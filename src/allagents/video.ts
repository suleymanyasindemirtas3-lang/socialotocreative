import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from '../core/logger.ts';
import type { Agent, MontajIstegi } from './types.ts';

const run = promisify(execFile);

/** 9:16 dikey. Shorts, Reels ve TikTok'un ortak formati. */
export const VERTICAL = { w: 1080, h: 1920 };

function secToAss(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Altyazi .ass olarak uretilir; drawtext'in aksine libass satir kaydirmayi ve
 * Turkce karakterleri kendi halleder.
 * Zamanlama sesin toplam suresine karakter sayisi oraninda dagitilir - kaba ama
 * konusma hizi sabit oldugu icin pratikte tutuyor.
 */
function buildAss(text: string, total: number): string {
  const chunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chars = chunks.reduce((a, c) => a + c.length, 0) || 1;
  let t = 0;
  const lines = chunks.map((c) => {
    const dur = (c.length / chars) * total;
    const line = `Dialogue: 0,${secToAss(t)},${secToAss(t + dur)},Ana,,0,0,0,,${c.replace(/\n/g, ' ')}`;
    t += dur;
    return line;
  });

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${VERTICAL.w}
PlayResY: ${VERTICAL.h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Ana,Arial,72,&H00FFFFFF,&H00000000,&H99000000,1,3,4,2,2,90,90,320

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

/**
 * 4. VIDEO (montaj)
 *
 * Goruntu + ses + altyaziyi tek dikey mp4'te birlestirir.
 * Her zaman yerel ve bedelsiz calisir; hangi goruntu kaynagi kullanildigindan
 * bagimsizdir. Ucretli saglayiciya gecmek bu ajani etkilemez.
 */
export const video: Agent<MontajIstegi, string> = {
  id: 'video',
  role: 'Goruntu, ses ve altyaziyi dikey mp4 olarak kurgular',
  uses: ['ffmpeg'],

  async run({ clip, audio, caption, outPath }): Promise<string> {
    await mkdir(dirname(outPath), { recursive: true });
    const assPath = outPath.replace(/\.mp4$/, '.ass');
    await writeFile(assPath, buildAss(caption, audio.seconds), 'utf8');

    const fps = 30;
    const frames = Math.ceil(audio.seconds * fps);
    // ffmpeg filtre dizesinde ':' ayirac; yollar goreli tutuluyor.
    const assRef = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    // Hazir hareketli klibe zoompan eklemek titretir.
    const motionStage = clip.motion
      ? `scale=${VERTICAL.w}:${VERTICAL.h}:force_original_aspect_ratio=increase,crop=${VERTICAL.w}:${VERTICAL.h},fps=${fps}`
      : [
          `scale=${VERTICAL.w * 2}:${VERTICAL.h * 2}:force_original_aspect_ratio=increase`,
          `crop=${VERTICAL.w * 2}:${VERTICAL.h * 2}`,
          `zoompan=z='min(zoom+0.0006,1.18)':d=${frames}:s=${VERTICAL.w}x${VERTICAL.h}:fps=${fps}`,
        ].join(',');

    const filter = [motionStage, `subtitles='${assRef}'`, 'format=yuv420p'].join(',');

    // Durgun gorsel loop'lanir; kisa klip ses bitene kadar tekrarlanir.
    const inputArgs = clip.motion
      ? ['-stream_loop', '-1', '-i', clip.path]
      : ['-loop', '1', '-i', clip.path];

    await run(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        ...inputArgs,
        '-i', audio.path,
        '-map', '0:v:0', '-map', '1:a:0',
        '-vf', filter,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
        '-c:a', 'aac', '-b:a', '128k',
        '-r', String(fps),
        '-shortest', '-movflags', '+faststart',
        outPath,
      ],
      { maxBuffer: 1 << 26 },
    );

    await rm(assPath, { force: true });
    // Yalnizca bu tur icin uretilen ara klip silinir; disaridan gelen gorsel kalir.
    if (clip.motion) await rm(clip.path, { force: true });

    log.ok(`montaj: ${outPath} (${audio.seconds.toFixed(1)}s, ses=${audio.provider}, goruntu=${clip.provider})`);
    return outPath;
  },
};
