import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { enabledAccounts } from '../core/accounts.ts';
import { ekipler, ekipBul } from './ekipler/index.ts';
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
 * Ihtiyac analizi. Kurallar bilinccli olarak basit ve okunabilir tutuldu:
 * gorunmeyen bir zeka degil, denetlenebilir bir politika olmali.
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
  for (const gorev of plan) {
    const ekip = ekipBul(gorev.tur);
    if (!ekip) {
      log.warn(`${gorev.tur} icin ekip yok, atlandi`);
      sonuclar.push({ gorev, ekip: '-', ok: false, ozet: 'ekip yok' });
      continue;
    }

    log.step(`${ekip.id} <- ${gorev.tur}`);
    const r = await ekip.run(gorev);
    sonuclar.push(r);
    if (r.ok) log.ok(`${ekip.id}: ${r.ozet}`);
    else log.err(`${ekip.id}: ${r.error}`);
  }
  return sonuclar;
}

/** Tek bir gorevi elle yollamak icin; panel dugmeleri bunu kullanir. */
export async function gorevYolla(tur: Gorev['tur'], adet = cfg.safety.maxPerRun): Promise<GorevSonucu> {
  const gorev: Gorev = { tur, adet, sebep: 'elle tetiklendi' };
  const ekip = ekipBul(tur);
  if (!ekip) return { gorev, ekip: '-', ok: false, ozet: 'ekip yok' };
  return ekip.run(gorev);
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

