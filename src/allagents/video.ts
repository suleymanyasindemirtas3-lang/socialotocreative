import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from '../core/logger.ts';
import type { Agent, Kelime, MontajIstegi } from './types.ts';

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
 * ALTYAZI BICIMI
 *
 * Yazi 72 puntoydu ve cumlenin tamami tek blokta cikiyordu: uzun bir
 * cumle karenin yarisini kapatiyor, arkadaki goruntu gorunmez oluyordu.
 * Simdi 44 punto ve ekranda ayni anda en fazla birkac kelime var.
 *
 * MarginV alt kenardan mesafe: yazi alt ucte durur, gorselin yuzu ve
 * merkezi acik kalir.
 */
const YAZI_PUNTO = 44;
/** Ayni anda ekranda duracak en fazla kelime. Az kelime = buyuk okunur akis. */
const SATIR_KELIME = 4;

function assBasligi(): string {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${VERTICAL.w}
PlayResY: ${VERTICAL.h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Ana,Arial,${YAZI_PUNTO},&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,1,1,3,1,2,120,120,260

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/** ASS metninde ozel anlami olan karakterler. */
function assKacis(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');
}

/**
 * KELIME KELIME ALTYAZI
 *
 * Konusmacinin soyledigi kelime tam o anda ekrana geliyor. Zamanlamalar
 * tahmin degil: edge-tts'in WordBoundary olaylarindan geliyor, yani sesin
 * kendisiyle birebir.
 *
 * Bicim: kelimeler `SATIR_KELIME`'lik gruplara boluyor. Grup icinde
 * soylenmis kelimeler beyaz, o an soylenen kelime SARI, henuz
 * soylenmemisler hic yok. Boylece yazi konusmayla birlikte "yazilmis"
 * gibi ilerliyor.
 *
 * Neden gruplama var: tek kelime gostermek okunmuyor, tum cumleyi
 * gostermek kareyi kapatiyor. Dort kelime ikisinin arasi.
 */
function kelimeAltyazisi(kelimeler: Kelime[], toplam: number): string {
  const olaylar: string[] = [];

  for (let bas = 0; bas < kelimeler.length; bas += SATIR_KELIME) {
    const grup = kelimeler.slice(bas, bas + SATIR_KELIME);

    for (let i = 0; i < grup.length; i++) {
      const baslangic = grup[i]!.t;
      /**
       * Bitis: siradaki kelimenin baslangici. Sondaki kelime grubun
       * bitisine kadar durur; sonraki grup baslayana dek ekranda kalir ki
       * cumlenin sonu okunabilsin.
       */
      const sonraki = grup[i + 1] ?? kelimeler[bas + SATIR_KELIME];
      const bitis = sonraki ? sonraki.t : Math.min(toplam, grup[i]!.t + grup[i]!.d + 0.6);
      if (bitis <= baslangic) continue;

      const parcalar = grup.slice(0, i + 1).map((w, j) => {
        const kelime = assKacis(w.k);
        // Son kelime = o an soylenen; vurgulanir.
        // ASS rengi &HAABBGGRR duzeninde; bu altin sarisi.
        return j === i ? `{\\c&H0000D7FF&\\b1}${kelime}{\\c&H00FFFFFF&\\b1}` : kelime;
      });

      olaylar.push(
        `Dialogue: 0,${secToAss(baslangic)},${secToAss(bitis)},Ana,,0,0,0,,${parcalar.join(' ')}`,
      );
    }
  }

  return assBasligi() + olaylar.join('\n') + '\n';
}

/**
 * Kelime zamanlamasi yoksa yedek: cumleleri harf sayisina gore dagitir.
 * Kabaca dogru ama konusmayla birebir degil - edge disindaki
 * saglayicilarda bu calisir.
 */
function cumleAltyazisi(text: string, total: number): string {
  const chunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chars = chunks.reduce((a, c) => a + c.length, 0) || 1;
  let t = 0;
  const lines = chunks.map((c) => {
    const dur = (c.length / chars) * total;
    const line = `Dialogue: 0,${secToAss(t)},${secToAss(t + dur)},Ana,,0,0,0,,${assKacis(c)}`;
    t += dur;
    return line;
  });

  return assBasligi() + lines.join('\n') + '\n';
}

function buildAss(text: string, total: number, kelimeler?: Kelime[]): string {
  return kelimeler?.length ? kelimeAltyazisi(kelimeler, total) : cumleAltyazisi(text, total);
}

/**
 * KARE SURELERI
 *
 * Gorseller esit bolunmek yerine CUMLE sinirlarinda degisiyor: anlatim
 * yeni bir cumleye gecince arka plan da degisiyor, yani goruntu
 * soylenenle birlikte ilerliyor.
 *
 * Cumle siniri, kelimeler arasindaki uzun sessizlikten bulunuyor
 * (konusmaci nokta sonrasi duraklar). Kelime zamanlamasi yoksa esit
 * bolunur.
 */
function kareSureleri(
  kareAdet: number,
  toplam: number,
  kelimeler?: Kelime[],
  bolumler?: string[],
): number[] {
  const esit = () => Array.from({ length: kareAdet }, () => toplam / kareAdet);
  if (kareAdet < 2) return [toplam];
  if (!kelimeler?.length) return esit();

  /**
   * BOLUM METNINE GORE KESIM - tercih edilen yol.
   *
   * Her karenin hangi anlatim bolumune ait oldugu biliniyorsa kesim
   * tahmin edilmez: bolumdeki kelime sayisi kadar ilerlenip tam o
   * noktada kesilir. Kare, kendi bolumunun metni okunurken ekranda olur.
   *
   * Duraklardan tahmin etmek buna gore korlemeydi: duraklar cumle
   * sinirini veriyordu ama HANGI cumlenin hangi kareye ait oldugunu
   * bilmiyordu.
   */
  if (bolumler?.length === kareAdet) {
    const kelimeSay = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
    const sureler: number[] = [];
    let indeks = 0;
    let onceki = 0;
    let saglam = true;

    for (let i = 0; i < kareAdet - 1; i++) {
      indeks += kelimeSay(bolumler[i]!);
      const sinir = kelimeler[indeks];
      if (!sinir) { saglam = false; break; }
      sureler.push(sinir.t - onceki);
      onceki = sinir.t;
    }

    if (saglam) {
      sureler.push(toplam - onceki);
      // Cok kisa kare goz yorar; boyle bir sey cikarsa duraklara don.
      if (sureler.every((x) => x >= 1.5)) return sureler;
    }
  }

  // Kelime aralarindaki bosluklar; en uzun bosluklar cumle sinirlaridir.
  const bosluklar: { yer: number; uzunluk: number }[] = [];
  for (let i = 1; i < kelimeler.length; i++) {
    const onceki = kelimeler[i - 1]!;
    bosluklar.push({ yer: kelimeler[i]!.t, uzunluk: kelimeler[i]!.t - (onceki.t + onceki.d) });
  }

  const kesimAdet = kareAdet - 1;
  const adaylar = bosluklar
    .filter((b) => b.uzunluk > 0.12)
    .sort((a, b) => b.uzunluk - a.uzunluk)
    .slice(0, kesimAdet * 3)
    .sort((a, b) => a.yer - b.yer);

  if (adaylar.length < kesimAdet) return esit();

  /**
   * Adaylardan esit araliga en yakin olanlari sec: yalnizca en uzun
   * duraklari alsaydik hepsi bir yerde toplanip bir kare 30 saniye,
   * digeri 2 saniye surebilirdi.
   */
  const kesimler: number[] = [];
  for (let i = 1; i <= kesimAdet; i++) {
    const ideal = (toplam / kareAdet) * i;
    const en = adaylar
      .filter((a) => !kesimler.includes(a.yer))
      .sort((x, y) => Math.abs(x.yer - ideal) - Math.abs(y.yer - ideal))[0];
    if (en) kesimler.push(en.yer);
  }
  kesimler.sort((a, b) => a - b);
  if (kesimler.length < kesimAdet) return esit();

  const sureler: number[] = [];
  let onceki = 0;
  for (const k of kesimler) {
    sureler.push(k - onceki);
    onceki = k;
  }
  sureler.push(toplam - onceki);

  // Cok kisa kare goz yorar; boyle bir sey cikarsa esit bolume don.
  return sureler.every((s) => s >= 1.5) ? sureler : esit();
}

/**
 * ALT PERDE
 *
 * Yazi acik renkli bir gorselin uzerine dustugunde okunmuyordu: anime
 * karesi neredeyse beyazdi ve beyaz yazi kayboluyordu. Alt bolgeye
 * asagi dogru koyulasan yumusak bir karartma koyuluyor - gorseli
 * bozmuyor, yaziyi her zeminde okunur yapiyor.
 *
 * Ilk denemede ust uste yari saydam drawbox bantlariyla yapmistim;
 * bantlarin sinirlari videoda yatay CIZGILER olarak gorunuyordu.
 * Simdi gercek gradyan: tek karelik bir PNG uretilip uzerine bindiriliyor.
 * PNG bir kez uretiliyor, kare basina yalnizca bindirme maliyeti var.
 */
const PERDE_ORAN = 0.34;

async function perdeUret(yol: string): Promise<string> {
  const yukseklik = Math.round(VERTICAL.h * PERDE_ORAN);
  await run(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=black:s=${VERTICAL.w}x${yukseklik}`,
      // pow(Y/H,1.5): ust kenarda neredeyse seffaf, alta dogru hizlanarak koyulasir.
      '-vf', "format=rgba,geq=r=0:g=0:b=0:a='255*pow(Y/H,1.5)*0.78'",
      '-frames:v', '1',
      yol,
    ],
    { maxBuffer: 1 << 22 },
  );
  return yol;
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

  async run({ clip, audio, caption, outPath, ekGorseller = [], bolumler }): Promise<string> {
    await mkdir(dirname(outPath), { recursive: true });
    const assPath = outPath.replace(/\.mp4$/, '.ass');
    await writeFile(assPath, buildAss(caption, audio.seconds, audio.kelimeler), 'utf8');

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

    /**
     * CANLI ARKA PLAN
     *
     * Haber fotograflari akista sonuk kaliyordu: dogru kare ama olu
     * goruntu. Renk doygunlugu ve kontrast hafifce yukseltiliyor -
     * abartisiz, fotograf hala gercek gorunuyor.
     */
    const canlandir = 'eq=saturation=1.28:contrast=1.08:brightness=0.02';


    /**
     * Her karede FARKLI hareket: tek yonlu yavas zoom uc kare boyunca
     * tekrarlaninca monoton oluyordu.
     *   cift sirali kare  -> yakinlasarak icine girer
     *   tek sirali kare   -> uzaklasarak acilir
     * Ayrica hafif yatay kaydirma var; sabit merkez donuk duruyordu.
     */
    const kenBurns = (sure: number, sira: number) => {
      const kare = Math.ceil(sure * fps);
      const yakinlas = sira % 2 === 0;
      const z = yakinlas
        ? `'min(1.0+on*0.0009,1.22)'`
        : `'max(1.22-on*0.0009,1.0)'`;
      // Kaydirma yonu de degisiyor; iki kare ust uste ayni hissi vermesin.
      const x = sira % 4 < 2 ? `'iw/2-(iw/zoom/2)+(on/${kare})*60-30'` : `'iw/2-(iw/zoom/2)-(on/${kare})*60+30'`;
      return [
        `scale=${VERTICAL.w * 2}:${VERTICAL.h * 2}:force_original_aspect_ratio=increase`,
        `crop=${VERTICAL.w * 2}:${VERTICAL.h * 2}`,
        canlandir,
        `zoompan=z=${z}:x=${x}:y='ih/2-(ih/zoom/2)':d=${kare}:s=${VERTICAL.w}x${VERTICAL.h}:fps=${fps}`,
        'setsar=1',
      ].join(',');
    };

    // Gradyan perde tek karelik bir PNG; montajdan sonra siliniyor.
    const perdeYolu = outPath.replace(/\.mp4$/, '.perde.png');
    await perdeUret(perdeYolu);

    let ffmpegArgs: string[];

    if (cokKare) {
      /**
       * Kareler esit degil, CUMLE sinirlarinda degisiyor: anlatim yeni
       * cumleye gecince arka plan da degisiyor.
       */
      const sureler = kareSureleri(kareler.length, audio.seconds, audio.kelimeler, bolumler);

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
      const zincir = kareler.map((_, i) => `[${i}:v]${kenBurns(sureler[i]!, i)}[v${i}]`).join(';');
      const birlestir = `${kareler.map((_, i) => `[v${i}]`).join('')}concat=n=${kareler.length}:v=1:a=0[vc]`;
      const perdeGirdi = kareler.length + 1;
      const filtre =
        `${zincir};${birlestir};` +
        `[vc][${perdeGirdi}:v]overlay=0:H-h[vp];` +
        `[vp]subtitles='${assRef}',format=yuv420p[vout]`;

      ffmpegArgs = [
        ...girdiler,
        '-i', audio.path,
        '-i', perdeYolu,
        '-filter_complex', filtre,
        '-map', '[vout]', '-map', `${kareler.length}:a:0`,
      ];
      log.info(
        `montaj: ${kareler.length} kare (${sureler.map((x) => x.toFixed(1)).join('s / ')}s)` +
          `${bolumler?.length === kareler.length ? ', kesimler anlatim bolumlerinde' : audio.kelimeler?.length ? ', kesimler cumle sinirinda' : ''}`,
      );
    } else {
      // Hazir hareketli klibe zoompan eklemek titretir.
      const motionStage = clip.motion
        ? `scale=${VERTICAL.w}:${VERTICAL.h}:force_original_aspect_ratio=increase,crop=${VERTICAL.w}:${VERTICAL.h},fps=${fps}`
        : [
            `scale=${VERTICAL.w * 2}:${VERTICAL.h * 2}:force_original_aspect_ratio=increase`,
            `crop=${VERTICAL.w * 2}:${VERTICAL.h * 2}`,
            canlandir,
            `zoompan=z='min(zoom+0.0006,1.18)':d=${frames}:s=${VERTICAL.w}x${VERTICAL.h}:fps=${fps}`,
          ].join(',');

      // Perde bindirmesi girdi gerektirdigi icin burada da filter_complex.
      const filtre =
        `[0:v]${motionStage}[b];[b][2:v]overlay=0:H-h[vp];` +
        `[vp]subtitles='${assRef}',format=yuv420p[vout]`;

      // Durgun gorsel loop'lanir; kisa klip ses bitene kadar tekrarlanir.
      const inputArgs = clip.motion
        ? ['-stream_loop', '-1', '-i', clip.path]
        : ['-loop', '1', '-i', clip.path];

      ffmpegArgs = [
        ...inputArgs,
        '-i', audio.path,
        '-i', perdeYolu,
        '-filter_complex', filtre,
        '-map', '[vout]', '-map', '1:a:0',
      ];
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
    await rm(perdeYolu, { force: true });
    // Yalnizca bu tur icin uretilen ara klip silinir; disaridan gelen gorsel kalir.
    if (clip.motion) await rm(clip.path, { force: true });

    log.ok(`montaj: ${outPath} (${audio.seconds.toFixed(1)}s, ses=${audio.provider}, goruntu=${clip.provider})`);
    return outPath;
  },
};
