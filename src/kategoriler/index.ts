import { readFile, writeFile } from 'node:fs/promises';
import { log } from '../core/logger.ts';
import type { MedyaTercihi } from '../core/types.ts';

/**
 * ICERIK KATEGORILERI
 *
 * Kategorisiz bir hesap her gun ayni sesle ayni bicimde yazar; okuyucu bir
 * sure sonra ayirt edemez olur ve algoritma da tekrari odullendirmez.
 *
 * Kategori bir KONU degil, bir BICIM sozlesmesidir: "Bugun Ne Kirildi"
 * her zaman ayni uc adimla yazilir. Bunun uc etkisi var:
 *   - taninirlik : okuyucu bicimi tanir, beklenti olusur
 *   - cesitlilik : rotasyon ayni kalibin ust uste gelmesini onler
 *   - olculebilirlik: hangi bicimin tuttugu kategori bazinda gorulebilir
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Kategoriler content/kategoriler.json icinde.
 * Kod degistirmeden yeni kategori ekleyebilir, `agirlik` ile siklik
 * ayarlayabilir, `aktif: false` ile gecici olarak kapatabilirsin.
 * `yonerge` alani dogrudan LLM'e gider; en degerli alan odur.
 * ---------------------------------------------------------------------------
 */

export interface Kategori {
  id: string;
  ad: string;
  aciklama: string;
  /** LLM'e verilen bicim talimati. Kategorinin asil degeri burada. */
  yonerge: string;
  medya: MedyaTercihi;
  /** Rotasyonda gorulme sikligi. Yuksek olan daha sik secilir. */
  agirlik: number;
  aktif: boolean;
  /** En son ne zaman kullanildi; ust uste ayni kategoriyi onlemek icin. */
  sonKullanim?: string;
}

const DOSYA = 'content/kategoriler.json';

export async function tumKategoriler(): Promise<Kategori[]> {
  try {
    return JSON.parse(await readFile(DOSYA, 'utf8')) as Kategori[];
  } catch {
    log.warn('kategori dosyasi okunamadi; kategorisiz devam ediliyor');
    return [];
  }
}

export async function kategoriBul(id: string): Promise<Kategori | undefined> {
  return (await tumKategoriler()).find((k) => k.id === id);
}

async function kaydet(liste: Kategori[]): Promise<void> {
  await writeFile(DOSYA, JSON.stringify(liste, null, 2) + '\n', 'utf8');
}

/**
 * Siradaki kategoriyi secer.
 *
 * Agirlikli kura degil, "en uzun suredir kullanilmayan" onceligi: saf kura
 * ayni kategoriyi ust uste secebiliyor, bu da cesitlilik amacini bozuyor.
 * Agirlik burada bir bekleme suresi carpanina donusuyor - agirligi dusuk
 * kategori daha uzun bekler.
 */
export async function siradakiKategori(): Promise<Kategori | undefined> {
  const liste = (await tumKategoriler()).filter((k) => k.aktif);
  if (!liste.length) return undefined;

  const simdi = Date.now();
  const puanla = (k: Kategori) => {
    const gecen = k.sonKullanim ? simdi - Date.parse(k.sonKullanim) : Number.MAX_SAFE_INTEGER / 2;
    // Agirlik ne kadar yuksekse bekleme suresi o kadar hizli "olgunlasir".
    return gecen * Math.max(1, k.agirlik);
  };

  return liste.slice().sort((a, b) => puanla(b) - puanla(a))[0];
}

/** Kullanildi olarak isaretler; rotasyon buna gore ilerler. */
export async function kullanildiIsaretle(id: string): Promise<void> {
  const liste = await tumKategoriler();
  const k = liste.find((x) => x.id === id);
  if (!k) return;
  k.sonKullanim = new Date().toISOString();
  await kaydet(liste);
}

/** Panelden kategori guncelleme. */
export async function kategoriYaz(k: Kategori): Promise<void> {
  const liste = await tumKategoriler();
  const i = liste.findIndex((x) => x.id === k.id);
  if (i >= 0) liste[i] = { ...liste[i], ...k };
  else liste.push(k);
  await kaydet(liste);
}

export async function kategoriSil(id: string): Promise<void> {
  await kaydet((await tumKategoriler()).filter((k) => k.id !== id));
}
