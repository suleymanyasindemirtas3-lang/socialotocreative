import { cfg } from '../core/config.ts';
import * as ilerleme from '../core/ilerleme.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { enabledAccounts } from '../core/accounts.ts';
import { ekipler, ekipBul } from './ekipler/index.ts';
import { kategoriBul } from '../kategoriler/index.ts';
import type { Gorev, GorevSonucu } from './types.ts';
import type { PostStatus as Durum } from '../core/types.ts';

/**
 * LIDER
 *
 * Ekiplerin ustundeki tek karar mercii. Iki isi var:
 *   1. Durumu okuyup NE GEREKTIGINE karar vermek  (planla)
 *   2. Gorevleri uygun ekiplere dagitmak           (calistir)
 *
 * Ekiplerin icine bakmaz. Bir gorevi kimin ustlenecegini `handles` listesinden
 * bulur; yeni ekip eklendiginde bu dosya degismez.
 *
 * Onceki surumde sira sabitti: ideate -> generate -> publish. Sorun suydu ki
 * kuyrukta 40 taslak birikmisken bile yeni fikir uretiyordu. Artik sira degil,
 * ihtiyac belirliyor.
 */

/** Kuyrugun durum dagilimi. */
async function sayim(): Promise<Record<Durum, number>> {
  const posts = await store.all();
  const base = {
    draft: 0,
    scripted: 0,
    pending_approval: 0,
    approved: 0,
    rejected: 0,
    published: 0,
    failed: 0,
  } as Record<Durum, number>;
  for (const p of posts) base[p.status] = (base[p.status] ?? 0) + 1;
  return base;
}

/**
 * Ihtiyac analizi. Kurallar bilincli olarak basit ve okunabilir tutuldu:
 * gorunmeyen bir zeka degil, denetlenebilir bir politika olmali.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Sistemin ne zaman ne yapacagi buradaki kurallarla belli.
 *
 * "Cok fazla/az uretiyor" dersen bakilacak yer burasi:
 *   - uretim hizi        -> MAX_POSTS_PER_RUN (.env), asagida `birim`
 *   - ne zaman yeni fikir-> `bekleyen < birim` kosulu
 *   - hata toleransi     -> `n.failed >= 3` esigi
 *
 * Her `plan.push` bir kural. Yenisini eklemek icin ayni bicimde bir kosul
 * yaz; `sebep` alanina NEDEN actigini yaz, panelde o gorunuyor.
 * ---------------------------------------------------------------------------
 */
export async function planla(): Promise<Gorev[]> {
  const n = await sayim();
  const hesap = (await enabledAccounts()).length;
  const birim = cfg.safety.maxPerRun;
  const plan: Gorev[] = [];

  if (!hesap) {
    log.warn('acik hesap yok; uretilen hicbir sey yayinlanamaz. Panelden hesap ekle.');
    return plan;
  }

  // Once biriken isi bitir, sonra yeni is ac. Ters sira kuyrugu sisirir.
  if (n.approved > 0) {
    plan.push({ tur: 'yayinla', adet: birim, sebep: `${n.approved} onayli post bekliyor` });
  }
  // Puanlama uretimden sonra, yayindan once. Yayilma potansiyeli dusuk
  // bir postu kullanicinin onaydan once gormesi gerekiyor.
  const puansiz = (await store.all()).filter(
    (p) => Object.keys(p.variants).length && !p.puan && p.status !== 'published',
  ).length;
  if (puansiz > 0) {
    plan.push({ tur: 'puanla', adet: birim, sebep: `${puansiz} post puanlanmamis` });
  }

  if (n.scripted > 0) {
    plan.push({ tur: 'medya-uret', adet: birim, sebep: `${n.scripted} metin medya bekliyor` });
  }
  if (n.draft > 0) {
    plan.push({ tur: 'icerik-yaz', adet: birim, sebep: `${n.draft} taslak metin bekliyor` });
  }

  // Basarisizlar birikmeye baslarsa geri al; sessizce olu kalmasinlar.
  if (n.failed >= 3) {
    plan.push({ tur: 'tekrar-dene', adet: n.failed, sebep: `${n.failed} basarisiz post birikti` });
  }

  // Yeni fikir yalnizca hat bosalmaya baslayinca. Doluyken uretmek israf.
  const bekleyen = n.draft + n.scripted + n.pending_approval + n.approved;
  if (bekleyen < birim) {
    // Gundem once toplanir; sonucu fikir-bul'a girdi olarak gecer.
    // Dis istek yalniz gercekten fikir uretilecekse atilir.
    plan.push({ tur: 'gundem-topla', adet: cfg.sources.limit, sebep: 'fikir uretimi icin gundem gerekli' });
    plan.push({
      tur: 'fikir-bul',
      adet: birim,
      sebep: `hatta ${bekleyen} is var, esik ${birim}`,
    });
  }

  return plan;
}

/** Plani uygular. Bir gorev cokerse digerleri devam eder. */
export async function calistir(): Promise<GorevSonucu[]> {
  const plan = await planla();

  if (!plan.length) {
    log.info('yapilacak is yok');
    return [];
  }

  log.step(`LIDER: ${plan.length} gorev`);
  for (const g of plan) log.info(`  ${g.tur.padEnd(13)} <- ${g.sebep}`);

  const sonuclar: GorevSonucu[] = [];
  // Bir onceki gorevin ciktisi bir sonrakine girdi olur. Ekipler birbirini
  // cagirmaz; veriyi tasiyan tek yer burasi.
  let tasinan: unknown;

  for (const gorev of plan) {
    if (tasinan !== undefined) gorev.girdi = tasinan;
    tasinan = undefined;

    const ekip = ekipBul(gorev.tur);
    if (!ekip) {
      log.warn(`${gorev.tur} icin ekip yok, atlandi`);
      sonuclar.push({ gorev, ekip: '-', ok: false, ozet: 'ekip yok' });
      continue;
    }

    log.step(`${ekip.id} <- ${gorev.tur}`);
    const r = await ekip.run(gorev);
    sonuclar.push(r);
    if (r.veri !== undefined) tasinan = r.veri;
    if (r.ok) log.ok(`${ekip.id}: ${r.ozet}`);
    else log.err(`${ekip.id}: ${r.error}`);
  }
  return sonuclar;
}

/** Tek bir gorevi elle yollamak icin; panel dugmeleri bunu kullanir. */
export async function gorevYolla(
  tur: Gorev['tur'],
  adet = cfg.safety.maxPerRun,
  secenek?: { kategori?: string },
): Promise<GorevSonucu> {
  const gorev: Gorev = {
    tur,
    adet,
    sebep: secenek?.kategori ? `elle: ${secenek.kategori}` : 'elle tetiklendi',
    ...(secenek?.kategori ? { kategori: secenek.kategori } : {}),
  };
  const ekip = ekipBul(tur);
  if (!ekip) return { gorev, ekip: '-', ok: false, ozet: 'ekip yok' };
  return ekip.run(gorev);
}

/**
 * Tek kategori icin bastan sona uretim.
 *
 * Panelde "bu kategoriden icerik getir" bunu cagirir. Tam turdan farki:
 * yalnizca istenen kategorinin kaynaklari cekilir, digerlerine hic
 * dokunulmaz. Hem kullanicinin secimi uygulanir hem gereksiz is olmaz.
 */
export async function kategoridenUret(
  kategoriId: string,
  adet = cfg.safety.maxPerRun,
): Promise<GorevSonucu[]> {
  const kat = await kategoriBul(kategoriId);
  if (!kat) return [];

  const sonuclar: GorevSonucu[] = [];
  log.step(`KATEGORI URETIMI: ${kat.ad}`);

  /**
   * Adimlar panele bildiriliyor. Bu is 40-120 saniye suruyor; kullanici
   * hangi asamada oldugunu goremezse sistemin donup donmadigini bilemiyor.
   */
  ilerleme.basla(`${kat.ad} içeriği hazırlanıyor`, [
    { id: 'gundem-topla', ad: 'Haber kaynakları taranıyor' },
    { id: 'fikir-bul', ad: 'Konular seçiliyor' },
    { id: 'icerik-yaz', ad: 'Metinler yazılıyor' },
    { id: 'medya-uret', ad: 'Görsel ve video üretiliyor' },
    { id: 'puanla', ad: 'Yayılma puanı hesaplanıyor' },
  ]);

  try {
    // 1) Yalnizca bu kategorinin kaynaklarindan gundem.
    const arastirma = ekipBul('gundem-topla');
    let gundem: unknown;
    if (arastirma && kat.kaynaklar?.length) {
      ilerleme.adimBasladi('gundem-topla');
      const r = await arastirma.run({
        tur: 'gundem-topla',
        adet: cfg.sources.limit,
        sebep: `${kat.ad} kaynaklari`,
        kategori: kat.id,
      });
      sonuclar.push(r);
      gundem = r.veri;
      if (r.ok) ilerleme.adimBitti('gundem-topla', r.ozet);
      else ilerleme.adimHata('gundem-topla', r.error ?? 'basarisiz');
    } else {
      ilerleme.adimBitti('gundem-topla', 'kategorinin kendi kaynagi yok');
    }

    // 2) Fikir -> metin -> medya -> puan, hepsi bu kategori icin.
    for (const tur of ['fikir-bul', 'icerik-yaz', 'medya-uret', 'puanla'] as const) {
      const ekip = ekipBul(tur);
      if (!ekip) continue;
      ilerleme.adimBasladi(tur);
      const r = await ekip.run({
        tur,
        adet,
        sebep: `${kat.ad} (elle)`,
        kategori: kat.id,
        ...(tur === 'fikir-bul' && gundem !== undefined ? { girdi: gundem } : {}),
      });
      sonuclar.push(r);
      if (r.ok) {
        log.ok(`${ekip.id}: ${r.ozet}`);
        ilerleme.adimBitti(tur, r.ozet);
      } else {
        log.err(`${ekip.id}: ${r.error}`);
        ilerleme.adimHata(tur, r.error ?? 'basarisiz');
      }
    }
    return sonuclar;
  } finally {
    // Hata da olsa panelde sonsuza dek donen bir adim kalmamali.
    ilerleme.bitir();
  }
}

/** Panel ve doctor icin: kim hangi gorevi ustleniyor. */
export function kadro() {
  return ekipler.map((e) => ({
    id: e.id,
    role: e.role,
    lead: e.lead,
    members: e.members,
    handles: e.handles,
  }));
}

