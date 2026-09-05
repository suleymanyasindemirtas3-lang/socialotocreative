import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from '../core/logger.ts';
import { speak, duration, VOICES } from './tts.ts';

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

export interface VideoSpec {
  imagePath: string;
  narration: string;
  /** Ekranda yanan altyazi. Verilmezse narration kullanilir. */
  caption?: string;
  outPath: string;
  voice?: string;
}

/**
 * Gorsel + seslendirme -> dikey mp4.
 * Yavas zoom (Ken Burns) hareketsiz kareyi izlenebilir kiliyor; platformlar
 * tamamen statik videoyu dusuk kaliteli sayip erisimi kisiyor.
 */
export async function compose(spec: VideoSpec): Promise<string> {
  await mkdir(dirname(spec.outPath), { recursive: true });
  const stem = spec.outPath.replace(/\.mp4$/, '');
  const audioPath = `${stem}.mp3`;
  const assPath = `${stem}.ass`;

  await speak(spec.narration, audioPath, spec.voice ?? VOICES.tr_male);
  const secs = await duration(audioPath);
  await writeFile(assPath, buildAss(spec.caption ?? spec.narration, secs), 'utf8');

  const fps = 30;
  const frames = Math.ceil(secs * fps);
  // ffmpeg filtre dizesinde ':' ayirac; Windows yolunu kacirmak yerine dosya
  // adini goreli tutuyoruz (calisma dizini proje koku).
  const assRef = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const filter = [
    `scale=${VERTICAL.w * 2}:${VERTICAL.h * 2}:force_original_aspect_ratio=increase`,
    `crop=${VERTICAL.w * 2}:${VERTICAL.h * 2}`,
    `zoompan=z='min(zoom+0.0006,1.18)':d=${frames}:s=${VERTICAL.w}x${VERTICAL.h}:fps=${fps}`,
    `subtitles='${assRef}'`,
    'format=yuv420p',
  ].join(',');

  await run(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-loop', '1', '-i', spec.imagePath,
      '-i', audioPath,
      '-vf', filter,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', String(fps),
      '-shortest', '-movflags', '+faststart',
      spec.outPath,
    ],
    { maxBuffer: 1 << 26 },
  );

  await rm(assPath, { force: true });
  log.ok(`video hazir: ${spec.outPath} (${secs.toFixed(1)}s)`);
  return spec.outPath;
}
