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

  async run({ clip, audio, caption, outPath, ekGorseller = [] }): Promise<string> {
    await mkdir(dirname(outPath), { recursive: true });
    const assPath = outPath.replace(/\.mp4$/, '.ass');
    await writeFile(assPath, buildAss(caption, audio.seconds), 'utf8');

    const fps = 30;
    const frames = Math.ceil(audio.seconds * fps);
    // ffmpeg filtre dizesinde ':' ayirac; yollar goreli tutuluyor.
    const assRef = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    /**
     * COK KARELI VIDEO
     *
     * Onceden video tek durgun gorsele Ken Burns uygulayip 40-50 saniye
     * boyunca ayni kareyi gosteriyordu: izleyici ilk saniyede her seyi
     * gormus oluyor, devaminda bakacak bir sey kalmiyordu.
     *
     * Birden fazla gorsel varsa video onlari sirayla gosterir, her birine
     * ayri Ken Burns uygular; sure esit bolunur.
     *
     * Hazir hareketli klip (odemeli AI kaynagi) geldiginde devreye girmez:
     * o zaten hareketli, ustune kesme koymak goruntuyu bozar.
     */
    const kareler = clip.motion ? [] : [clip.path, ...ekGorseller.filter((g) => g !== clip.path)];
    const cokKare = kareler.length > 1;

    const kenBurns = (sure: number) =>
      [
        `scale=${VERTICAL.w * 2}:${VERTICAL.h * 2}:force_original_aspect_ratio=increase`,
        `crop=${VERTICAL.w * 2}:${VERTICAL.h * 2}`,
        `zoompan=z='min(zoom+0.0012,1.20)':d=${Math.ceil(sure * fps)}:s=${VERTICAL.w}x${VERTICAL.h}:fps=${fps}`,
        'setsar=1',
      ].join(',');

    let ffmpegArgs: string[];

    if (cokKare) {
      const kareSure = audio.seconds / kareler.length;

      /**
       * DIKKAT: burada `-loop 1 -t <sure>` KULLANILMAZ.
       *
       * zoompan'in `d` parametresi "her GIRDI karesi icin kac cikti karesi
       * uret" demek. `-loop 1 -t 12.7` girdiyi 381 kareye cikardigi icin
       * zoompan 381 x 381 kare uretiyordu; ilk gorsel tum sesi doldurup
       * bitiyor, ikinci ve ucuncu gorsele hic sira gelmiyordu.
       *
       * Ilk denemede bunu suresine ve boyutuna bakarak "calisiyor" sandim -
       * video 41 saniye ve 1080x1920'di, ama basindan sonuna ayni kare.
       * Kareleri tek tek disari alip karsilastirinca ortaya cikti.
       *
       * Cozum: gorseli TEK kare olarak vermek. zoompan `d` kadar kare
       * uretir ve sure oradan gelir.
       */
      const girdiler = kareler.flatMap((g) => ['-i', g]);
      const zincir = kareler.map((_, i) => `[${i}:v]${kenBurns(kareSure)}[v${i}]`).join(';');
      const birlestir = `${kareler.map((_, i) => `[v${i}]`).join('')}concat=n=${kareler.length}:v=1:a=0[vc]`;
      const filtre = `${zincir};${birlestir};[vc]subtitles='${assRef}',format=yuv420p[vout]`;

      ffmpegArgs = [
        ...girdiler,
        '-i', audio.path,
        '-filter_complex', filtre,
        '-map', '[vout]', '-map', `${kareler.length}:a:0`,
      ];
      log.info(`montaj: ${kareler.length} kare, her biri ${kareSure.toFixed(1)}s`);
    } else {
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

      ffmpegArgs = [...inputArgs, '-i', audio.path, '-map', '0:v:0', '-map', '1:a:0', '-vf', filter];
    }

    await run(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        ...ffmpegArgs,
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
