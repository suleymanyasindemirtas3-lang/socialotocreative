import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../../core/logger.ts';

const run = promisify(execFile);

/**
 * PARLAKLIK TABANI
 *
 * Uretilen gorsellerin bir kismi cok karanlik cikiyor. Sebep zincirleme:
 * "taninabilir gercek kisi olmasin" kurali modeli siluete, arkadan isiga
 * ve loş ic mekanlara itiyor. Ustune altyazi icin konan alt perde de
 * binince kare telefon ekraninda camur gibi gorunuyor.
 *
 * Isteme "aydinlik olsun" yazmak yardimci oluyor ama garanti degil -
 * model bazen yine karanlik uretiyor. Model davranisina guvenmek yerine
 * SONUC OLCULUYOR: kare fazla koyuysa duzeltiliyor.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Gorseller solgun/yikanmis geliyorsa TABAN degerini
 * dusur; hala karanliksa yukselt. 0-255 arasi ortalama parlaklik.
 * ---------------------------------------------------------------------------
 */

/** Bunun altindaki kareler duzeltilir. */
const TABAN = 88;
/** Duzeltme sonrasi hedeflenen ortalama. */
const HEDEF = 105;
/** Asiri duzeltme goruntuyu yikiyor; gamma bu degeri gecmez. */
const MAX_GAMMA = 2.4;

/**
 * Karenin ortalama parlakligi (0-255).
 *
 * Tek pikselе olceklendirip o pikselin gri degerini okuyoruz: ffmpeg'in
 * signalstats ciktisini ayristirmaktan hem hizli hem daha az kirilgan.
 */
export async function parlaklikOlc(yol: string): Promise<number> {
  const { stdout } = await run(
    'ffmpeg',
    ['-v', 'error', '-i', yol, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 20 },
  );
  const bayt = stdout as unknown as Buffer;
  if (!bayt.length) throw new Error('parlaklik olculemedi');
  return bayt[0]!;
}

/**
 * Kare fazla koyuysa gamma ile acar. Degistirdiyse true doner.
 *
 * Gamma hesabi: ortalama m'yi h'ye tasimak icin
 *   gamma = log(m/255) / log(h/255)
 * ffmpeg'in eq=gamma degeri 1'in ustunde goruntuyu acar.
 */
export async function karanligiDuzelt(yol: string): Promise<boolean> {
  let ortalama: number;
  try {
    ortalama = await parlaklikOlc(yol);
  } catch {
    return false;
  }

  if (ortalama >= TABAN) return false;
  // Tamamen siyah kare kurtarilamaz; gamma sonsuza gider.
  if (ortalama < 8) {
    log.warn(`${yol}: kare neredeyse tamamen siyah (${ortalama}), duzeltilmedi`);
    return false;
  }

  const gamma = Math.min(MAX_GAMMA, Math.log(ortalama / 255) / Math.log(HEDEF / 255));
  const gecici = `${yol}.acik.jpg`;

  try {
    await run(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', yol, '-vf', `eq=gamma=${gamma.toFixed(2)}:saturation=1.12`, '-q:v', '3', gecici],
      { maxBuffer: 1 << 22 },
    );
    const { rename } = await import('node:fs/promises');
    await rename(gecici, yol);
    const yeni = await parlaklikOlc(yol).catch(() => 0);
    log.info(`${yol.split(/[\\/]/).pop()}: karanlik duzeltildi ${ortalama} -> ${yeni}`);
    return true;
  } catch (e) {
    log.warn(`karanlik duzeltilemedi: ${String(e).slice(0, 80)}`);
    return false;
  }
}
