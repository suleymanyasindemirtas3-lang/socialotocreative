import { log } from '../core/logger.ts';

/**
 * SAGLAYICI SAGLIK TAKIBI (tum zincirler icin ortak)
 *
 * Zincir onceden yalnizca hata aninda dusuyordu ve hatirlamiyordu: kotasi
 * dolmus bir saglayici her istekte yeniden deneniyor, uc kez tekrar edip
 * 45 saniye bekliyor, sonra yedege geciliyordu. Yani her post icin bir
 * dakika bosa gidiyordu.
 *
 * Artik kota hatasi alan saglayici bir sure kenara ayriliyor. Bekleme
 * suresi ard arda hatada katlaniyor, ilk basarida sifirlaniyor.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Bir saglayici gereksiz uzun beklemede kaliyorsa
 * ILK_BEKLEME ve MAX_BEKLEME degerlerine bak.
 * ---------------------------------------------------------------------------
 */

const ILK_BEKLEME = 90_000;
const MAX_BEKLEME = 60 * 60_000;

interface Durum {
  bekleyisSonu: number;
  ardArdaHata: number;
  sonHata?: string;
}

const durumlar = new Map<string, Durum>();

function durum(id: string): Durum {
  let d = durumlar.get(id);
  if (!d) {
    d = { bekleyisSonu: 0, ardArdaHata: 0 };
    durumlar.set(id, d);
  }
  return d;
}

export function kullanilabilir(id: string): boolean {
  return durum(id).bekleyisSonu <= Date.now();
}

export function kalanBekleme(id: string): number {
  return Math.max(0, durum(id).bekleyisSonu - Date.now());
}

/**
 * Kota ya da sunucu hatasi bildir.
 * `kotaHatasi` true ise saglayici kenara ayrilir; gecici ag hatasi
 * saglayiciyi cezalandirmamali.
 */
export function hataBildir(id: string, mesaj: string, kotaHatasi: boolean): void {
  const d = durum(id);
  d.sonHata = mesaj.slice(0, 120);

  if (!kotaHatasi) return;

  d.ardArdaHata++;
  const bekleme = Math.min(ILK_BEKLEME * 2 ** (d.ardArdaHata - 1), MAX_BEKLEME);
  d.bekleyisSonu = Date.now() + bekleme;
  log.warn(`${id} kotasi doldu, ${Math.round(bekleme / 60000)} dk kenara ayrildi`);
}

export function basariBildir(id: string): void {
  const d = durum(id);
  if (d.ardArdaHata) log.info(`${id} tekrar calisiyor`);
  d.ardArdaHata = 0;
  d.bekleyisSonu = 0;
  delete d.sonHata;
}

/** Panel ve doctor icin: hangi saglayici hazir, hangisi beklemede. */
export function saglikOzeti(): { id: string; hazir: boolean; kalanDk: number; sonHata?: string }[] {
  return [...durumlar.entries()].map(([id, d]) => ({
    id,
    hazir: d.bekleyisSonu <= Date.now(),
    kalanDk: Math.ceil(Math.max(0, d.bekleyisSonu - Date.now()) / 60000),
    ...(d.sonHata ? { sonHata: d.sonHata } : {}),
  }));
}

/** HTTP durum kodu kota/yuk hatasi mi. */
export function kotaHatasiMi(status: number, govde = ''): boolean {
  if (status === 429 || status === 402) return true;
  if (status >= 500) return true;
  // Bazi saglayicilar kotayi 400 icinde bildiriyor.
  return /quota|rate.?limit|credits?.(depleted|exhausted)|insufficient/i.test(govde);
}
