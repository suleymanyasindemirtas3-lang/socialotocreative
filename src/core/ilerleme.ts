/**
 * ILERLEME TAKIBI
 *
 * Uzun suren islerin nerede oldugunu panele bildirir.
 *
 * NEDEN VAR
 * Bir kategoriden icerik getirmek 40-120 saniye suruyor: haber kaynaklari
 * taraniyor, model konu seciyor, metin yaziliyor, gorsel indiriliyor,
 * video montajlaniyor. Bu sure boyunca panelde yalnizca "calisiyor..."
 * yaziyordu. Kullanici sistemin gercekten calisip calismadigini, ne kadar
 * bekledigini ve daha ne kadar bekleyecegini goremiyordu.
 *
 * Sahte bir yukleme cubugu yerine GERCEK adimlar bildiriliyor: hangi adim
 * bitti, hangisi suruyor, her biri kac saniye surdu. Bir adim uzun surerse
 * kullanici nerede takildigini gorur - "donmus mu" sorusu ortadan kalkar.
 *
 * Tek is aninda tek ilerleme: panel zaten `busy` ile ikinci isi engelliyor.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Yeni bir uzun is eklersen basla()/adimBasladi()/bitir()
 * cagirmayi unutma; yoksa panelde ilerleme gorunmez, is yine calisir.
 * ---------------------------------------------------------------------------
 */

export type AdimDurumu = 'bekliyor' | 'suruyor' | 'bitti' | 'hata';

export interface Adim {
  id: string;
  ad: string;
  durum: AdimDurumu;
  /** Adim bittiginde ekibin dondurdugu ozet. */
  ozet?: string;
  /** Milisaniye. Bitmis adimlarda gercek sure, surenlerde su ana kadar. */
  sure?: number;
}

export interface Ilerleme {
  calisiyor: boolean;
  baslik: string;
  /** Baslangic damgasi; panel gecen sureyi buradan hesaplar. */
  baslangic: number;
  adimlar: Adim[];
}

let simdiki: Ilerleme = { calisiyor: false, baslik: '', baslangic: 0, adimlar: [] };
let adimBaslangici = 0;

/** Yeni bir is baslat. `adimlar` sirayla islenecek adimlarin adlari. */
export function basla(baslik: string, adimlar: { id: string; ad: string }[]): void {
  simdiki = {
    calisiyor: true,
    baslik,
    baslangic: Date.now(),
    adimlar: adimlar.map((a) => ({ ...a, durum: 'bekliyor' })),
  };
}

export function adimBasladi(id: string): void {
  const a = simdiki.adimlar.find((x) => x.id === id);
  if (!a) return;
  a.durum = 'suruyor';
  adimBaslangici = Date.now();
}

export function adimBitti(id: string, ozet?: string): void {
  const a = simdiki.adimlar.find((x) => x.id === id);
  if (!a) return;
  a.durum = 'bitti';
  a.sure = Date.now() - adimBaslangici;
  if (ozet) a.ozet = ozet;
}

export function adimHata(id: string, hata: string): void {
  const a = simdiki.adimlar.find((x) => x.id === id);
  if (!a) return;
  a.durum = 'hata';
  a.sure = Date.now() - adimBaslangici;
  a.ozet = hata.slice(0, 160);
}

/**
 * Isi kapat. Adimlar SILINMEZ: panel son turun ozetini gostermeye devam
 * eder, kullanici ne olup bittigini is bitince de okuyabilsin.
 */
export function bitir(): void {
  simdiki.calisiyor = false;
  // Yarim kalan adim varsa asili birakma; yoksa panelde sonsuza dek doner.
  for (const a of simdiki.adimlar) {
    if (a.durum === 'suruyor') a.durum = 'bitti';
  }
}

export function durum(): Ilerleme {
  // Suren adimin suresi anlik hesaplanir; panel saniye sayacini buradan alir.
  return {
    ...simdiki,
    adimlar: simdiki.adimlar.map((a) =>
      a.durum === 'suruyor' ? { ...a, sure: Date.now() - adimBaslangici } : a,
    ),
  };
}
