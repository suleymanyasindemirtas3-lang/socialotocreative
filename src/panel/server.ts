import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { accounts, redact } from '../core/accounts.ts';
import { manuelPaket, manuelIsaretle } from '../allagents/manuel.ts';
import { platforms, platform } from '../platforms/index.ts';
import { calistir, gorevYolla, planla, kadro, kategoridenUret } from '../allagents/index.ts';
import { publish } from '../allagents/yayinci.ts';
import { gorselAra, adayiIndir, type GorselAday } from '../providers/image/arama.ts';
import { getImage } from '../providers/image/index.ts';
import { senaryo } from '../allagents/senaryo.ts';
import { uret as yonetmenUret } from '../allagents/yonetmen.ts';
import { accounts as hesapDeposu } from '../core/accounts.ts';
import { platform as platformBul } from '../platforms/index.ts';
import { tumKategoriler, kategoriBul, kategoriYaz, kategoriSil, type Kategori } from '../kategoriler/index.ts';
import { puanla } from '../allagents/ekipler/strateji.ts';
import { algoritmaTabani } from '../allagents/algoritma.ts';
import type { Account, MedyaTercihi, PostStatus } from '../core/types.ts';
import type { GorevTuru } from '../allagents/types.ts';

const PORT = Number(process.env['PANEL_PORT'] ?? 8787);
// Varsayilan yalniz yerel. Uzaktan erisim bilincli bir karar olmali (tunel + token).
const HOST = process.env['PANEL_HOST'] ?? '127.0.0.1';

/** Token yoksa uret; panel hicbir zaman korumasiz acilmaz. */
const TOKEN = process.env['PANEL_TOKEN'] || randomBytes(16).toString('hex');

function tokenOk(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: IncomingMessage): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  const q = url.searchParams.get('token');
  if (q && tokenOk(q)) return true;
  const header = req.headers['x-panel-token'];
  if (typeof header === 'string' && tokenOk(header)) return true;
  const cookie = /panel_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
  return Boolean(cookie && tokenOk(cookie));
}

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error('govde cok buyuk');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
}

/** Ayni anda iki tur calismasin; kuyruk tek JSON dosyasi. */
let busy = false;
async function runStage(stage: string): Promise<string> {
  if (busy) return 'zaten calisiyor';
  busy = true;
  try {
    if (stage === 'run') {
      const r = await calistir();
      return r.length ? r.map((x) => `${x.ekip}: ${x.ozet}`).join(' | ') : 'yapilacak is yok';
    }
    const map: Record<string, GorevTuru> = {
      ideate: 'fikir-bul',
      write: 'icerik-yaz',
      generate: 'medya-uret',
      publish: 'yayinla',
      retry: 'tekrar-dene',
    };
    const tur = map[stage];
    if (!tur) return 'bilinmeyen adim';
    const r = await gorevYolla(tur);
    return r.ok ? `${r.ekip}: ${r.ozet}` : `${r.ekip} hata: ${r.error}`;
  } finally {
    busy = false;
  }
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? 'GET';

  if (path === '/api/state' && method === 'GET') {
    const posts = (await store.all()).slice().reverse();
    return send(res, 200, {
      posts,
      accounts: (await accounts.all()).map(redact),
      platforms: platforms.map((p) => ({
        id: p.id,
        label: p.label,
        limits: p.limits,
        needs: p.needs,
        fields: p.fields,
        setupUrl: p.setupUrl,
        setupHint: p.setupHint,
      })),
      teams: kadro(),
      kategoriler: await tumKategoriler(),
      algoritma: await algoritmaTabani(),
      plan: await planla(),
      config: {
        dryRun: cfg.safety.dryRun,
        autoApprove: cfg.approval.auto,
        llm: cfg.llm.chain.join(' > '),
        image: cfg.image.chain.join(' > '),
        busy,
      },
    });
  }

  if (path === '/api/decide' && method === 'POST') {
    const { id, decision } = await readJson<{ id: string; decision: PostStatus }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    if (!['approved', 'rejected', 'draft'].includes(decision)) {
      return send(res, 400, { error: 'gecersiz karar' });
    }

    // Metni olmayan post onaylanamaz: yayin asamasi konu basligini metin
    // sanip oldugu gibi paylasirdi. Onay, icerigi gormeden verilemez.
    if (decision === 'approved' && !Object.keys(post.variants).length) {
      return send(res, 400, {
        error: 'Bu postun metni henuz yazilmadi. Once "Metin yaz" calistir, metni oku, sonra onayla.',
      });
    }

    post.status = decision;
    await store.upsert(post);
    return send(res, 200, { ok: true, status: post.status });
  }

  if (path === '/api/post/targets' && method === 'POST') {
    const { id, targets } = await readJson<{ id: string; targets: string[] }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    post.targets = targets;
    await store.upsert(post);
    return send(res, 200, { ok: true });
  }

  if (path === '/api/post/text' && method === 'POST') {
    const { id, platform: pid, text } = await readJson<{ id: string; platform: string; text: string }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    const limit = platform(pid)?.limits.text ?? 500;
    post.variants[pid] = text.slice(0, limit);
    await store.upsert(post);
    return send(res, 200, { ok: true, text: post.variants[pid] });
  }

  /**
   * TEK POST UZERINDE ISLEM
   * Ust cubuktaki dugmeler tum kuyrugu isliyordu; hangi postun uzerinde
   * calisildigi belirsizdi. Bu uclar tek bir posta etki eder.
   */
  if (path === '/api/post/yaz' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });

    try {
      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await hesapDeposu.get(accId);
        if (acc) platformIds.add(acc.platform);
      }
      if (!platformIds.size) return send(res, 400, { error: 'once hedef hesap sec' });

      const wantsVideo =
        post.medya === 'video' ||
        (post.medya !== 'gorsel' && post.medya !== 'yok' &&
          [...platformIds].some((pid) => platformBul(pid)?.needs === 'video'));

      const kat = post.kategori ? await kategoriBul(post.kategori) : undefined;
      const script = await senaryo.run({
        fikir: { topic: post.topic, angle: post.angle },
        ...(kat ? { kategori: { id: kat.id, ad: kat.ad, yonerge: kat.yonerge } } : {}),
        platforms: [...platformIds].map((pid) => ({ pid, limit: platformBul(pid)?.limits.text ?? 500 }))
          .map((x) => ({ id: x.pid, limit: x.limit })),
        narrationNeeded: wantsVideo,
      });

      post.variants = script.variants;
      post.script = {
        visualPrompt: script.visualPrompt,
        ...(script.narration ? { narration: script.narration } : {}),
      };
      post.status = 'scripted';
      await store.upsert(post);
      return send(res, 200, { ok: true, message: 'metin yazildi' });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 300) });
    }
  }

  /**
   * TEK DUGMEYLE URETIM.
   *
   * Onceden kullanici once "Medya" acilir listesinden video secip sonra
   * "Medya" dugmesine basmak zorundaydi; hangi postun ne uretecegi
   * ekrandan okunmuyordu. Artik dugme ne yapacagini kendi soyluyor:
   * "Gorsel uret" / "Video uret". Tercih ve uretim tek istekte.
   */
  if (path === '/api/post/uret' && method === 'POST') {
    const { id, tur } = await readJson<{ id: string; tur: MedyaTercihi }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    if (!post.script) return send(res, 400, { error: 'once metin yazilmali' });
    if (!['gorsel', 'video'].includes(tur)) return send(res, 400, { error: 'gecersiz tur' });

    post.medya = tur;
    // Eski medya kalirsa yeni tercihle uretilmis sanilir; temizleniyor.
    post.media = [];
    post.results = [];
    post.status = 'scripted';
    await store.upsert(post);

    try {
      const n = await yonetmenUret(1);
      const guncel = await store.get(id);
      const gorselAdet = guncel?.media.filter((m) => m.kind === 'image').length ?? 0;
      const videoAdet = guncel?.media.filter((m) => m.kind === 'video').length ?? 0;
      return send(res, 200, {
        ok: true,
        message: n
          ? `${tur === 'video' ? 'video' : 'görsel'} üretildi: ${gorselAdet} görsel${videoAdet ? ' + video' : ''}`
          : 'üretilemedi',
      });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 300) });
    }
  }

  if (path === '/api/post/medya-uret' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    if (!post.script) return send(res, 400, { error: 'once metin yazilmali' });

    // Yonetmen 'scripted' postlari isler; bu postu ona veriyoruz.
    const oncekiDurum = post.status;
    post.status = 'scripted';
    await store.upsert(post);
    try {
      const n = await yonetmenUret(1);
      const guncel = await store.get(id);
      return send(res, 200, {
        ok: true,
        message: n ? `medya uretildi (${guncel?.media.length ?? 0} dosya)` : 'medya uretilemedi',
      });
    } catch (e) {
      post.status = oncekiDurum;
      await store.upsert(post);
      return send(res, 400, { error: String(e).slice(0, 300) });
    }
  }

  /** Web'den ve AI'dan gorsel adaylari; kullanici secsin diye. */
  if (path === '/api/post/gorsel-ara' && method === 'POST') {
    const { id, sorgu, kaynaklar } = await readJson<{ id: string; sorgu?: string; kaynaklar?: string[] }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });

    // Arama terimi: kullanici yazdiysa o, yoksa senaryo ajaninin ingilizce istemi.
    const terim = sorgu?.trim() || post.script?.visualPrompt || post.topic;
    try {
      const adaylar = await gorselAra(terim, 8, kaynaklar?.length ? kaynaklar : ['openverse']);
      return send(res, 200, { ok: true, terim, adaylar });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 200) });
    }
  }

  if (path === '/api/post/gorsel-sec' && method === 'POST') {
    const { id, aday } = await readJson<{ id: string; aday: GorselAday }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });

    try {
      const asset = await adayiIndir(aday, `data/media/${post.id}-secili.jpg`);
      // Secilen gorsel varsa uretilen gorselin yerini alir; video korunur.
      post.media = [asset, ...post.media.filter((m) => m.kind === 'video')];
      await store.upsert(post);
      return send(res, 200, { ok: true, message: `gorsel eklendi (${aday.kaynak})` });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 250) });
    }
  }

  /** Yalnizca AI gorseli yeniden uret. */
  if (path === '/api/post/gorsel-uret' && method === 'POST') {
    const { id, istem } = await readJson<{ id: string; istem?: string }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });

    const prompt = istem?.trim() || post.script?.visualPrompt;
    if (!prompt) return send(res, 400, { error: 'once metin yazilmali (gorsel istemi ondan geliyor)' });

    try {
      const asset = await getImage().generate(prompt, `data/media/${post.id}.jpg`);
      post.media = [asset, ...post.media.filter((m) => m.kind === 'video')];
      await store.upsert(post);
      return send(res, 200, { ok: true, message: 'AI gorseli uretildi' });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 250) });
    }
  }

  /** Postun kategorisini degistir; bicim ve varsayilan medya ondan gelir. */
  /** Tek postu yeniden puanla; metin adaylari da puanlanir. */
  /**
   * Tek kategori icin bastan sona uretim.
   * Yalnizca o kategorinin kaynaklari cekilir; diger kaynaklara ve
   * kategorilere hic dokunulmaz.
   */
  if (path === '/api/kategoriden-uret' && method === 'POST') {
    if (busy) return send(res, 200, { ok: true, message: 'zaten calisiyor' });
    const { kategori, adet } = await readJson<{ kategori: string; adet?: number }>(req);
    if (!kategori) return send(res, 400, { error: 'kategori secilmedi' });

    busy = true;
    try {
      const r = await kategoridenUret(kategori, adet ?? cfg.safety.maxPerRun);
      const ozet = r.filter((x) => x.ok).map((x) => `${x.ekip}: ${x.ozet}`).join(' | ');
      const hata = r.find((x) => !x.ok);
      return send(res, 200, {
        ok: true,
        message: ozet || (hata ? `hata: ${hata.error}` : 'sonuc yok'),
      });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 300) });
    } finally {
      busy = false;
    }
  }

  if (path === '/api/post/puanla' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    try {
      const yildiz = await puanla(id);
      return send(res, 200, { ok: true, message: `${yildiz} yildiz` });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 250) });
    }
  }

  /** Metin adaylarindan birini secili metin yap. */
  if (path === '/api/post/metin-sec' && method === 'POST') {
    const { id, platform: pid, index } = await readJson<{ id: string; platform: string; index: number }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });

    const adaylar = post.metinAdaylari?.[pid];
    const secilen = adaylar?.[index];
    if (!secilen) return send(res, 400, { error: 'aday yok' });

    // Secilen aday ana metin olur; eski ana metin aday listesine geri doner
    // ki karsilastirma imkani kaybolmasin.
    const eski = post.variants[pid];
    post.variants[pid] = secilen.metin;
    if (eski) adaylar![index] = { metin: eski, ...(post.puan ? { puan: post.puan } : {}) };
    if (secilen.puan) post.puan = secilen.puan;

    await store.upsert(post);
    return send(res, 200, { ok: true, message: 'metin degistirildi' });
  }

  if (path === '/api/post/kategori' && method === 'POST') {
    const { id, kategori } = await readJson<{ id: string; kategori: string }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });

    if (!kategori) {
      delete post.kategori;
      await store.upsert(post);
      return send(res, 200, { ok: true, message: 'kategori kaldirildi' });
    }

    const kat = await kategoriBul(kategori);
    if (!kat) return send(res, 400, { error: 'kategori yok' });

    post.kategori = kat.id;
    post.medya = kat.medya;

    // Metin zaten yazilmissa eski bicimde kalmis olur; yeniden yazilmali.
    if (Object.keys(post.variants).length) {
      post.variants = {};
      delete post.script;
      post.media = [];
      post.status = 'draft';
    }
    await store.upsert(post);
    return send(res, 200, {
      ok: true,
      message: `kategori: ${kat.ad}${post.status === 'draft' ? ' — metin yeniden yazilmali' : ''}`,
    });
  }

  if (path === '/api/kategori/kaydet' && method === 'POST') {
    const k = await readJson<Kategori>(req);
    if (!k.id || !k.ad) return send(res, 400, { error: 'id ve ad zorunlu' });
    // Eksik alanlar varsayilanla tamamlanir; panel formu hepsini gondermeyebilir.
    await kategoriYaz({
      ...k,
      agirlik: k.agirlik ?? 1,
      aktif: k.aktif ?? true,
      medya: k.medya ?? 'gorsel',
      aciklama: k.aciklama ?? '',
      yonerge: k.yonerge ?? '',
    });
    return send(res, 200, { ok: true, message: 'kategori kaydedildi' });
  }

  if (path === '/api/kategori/sil' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    await kategoriSil(id);
    return send(res, 200, { ok: true, message: 'kategori silindi' });
  }

  if (path === '/api/post/media' && method === 'POST') {
    const { id, tercih } = await readJson<{ id: string; tercih: MedyaTercihi }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    if (!['otomatik', 'gorsel', 'video', 'yok'].includes(tercih)) {
      return send(res, 400, { error: 'gecersiz tercih' });
    }

    post.medya = tercih;

    /**
     * Medyasi zaten uretilmis bir postta tercih degistirmek tek basina ise
     * yaramaz; eski medya duruyor olurdu. Post uretim asamasina geri alinir
     * ki yeni tercihle yeniden uretilsin. Yazilan metin korunur.
     */
    let notu = 'tercih kaydedildi';
    if (post.media.length && post.status !== 'scripted') {
      post.media = [];
      post.results = [];
      post.status = post.script ? 'scripted' : 'draft';
      notu = 'tercih kaydedildi, medya yeniden uretilecek';
    }

    await store.upsert(post);
    return send(res, 200, { ok: true, tercih, not: notu, status: post.status });
  }

  /**
   * MANUEL YAYIN UCLARI
   *
   * Ucretli API'ye baglanmadan paylasabilmek icin. Uretim degismez;
   * yalnizca son adim kullaniciya devredilir. Bkz. allagents/manuel.ts
   */
  if (path === '/api/post/manuel' && method === 'POST') {
    const { id, accountId } = await readJson<{ id: string; accountId?: string }>(req);
    try {
      return send(res, 200, { ok: true, paket: await manuelPaket(id, accountId) });
    } catch (e) {
      return send(res, 400, { error: String(e).replace(/^Error:\s*/, '').slice(0, 300) });
    }
  }

  if (path === '/api/post/manuel-isaretle' && method === 'POST') {
    const { id, accountId, url } = await readJson<{ id: string; accountId: string; url?: string }>(req);
    try {
      const post = await manuelIsaretle(id, accountId, url);
      return send(res, 200, { ok: true, status: post.status, message: 'paylasildi olarak isaretlendi' });
    } catch (e) {
      return send(res, 400, { error: String(e).replace(/^Error:\s*/, '').slice(0, 300) });
    }
  }

  if (path === '/api/post/delete' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    await store.remove(id);
    return send(res, 200, { ok: true });
  }

  // ------------------------------------------------------------- hesaplar

  if (path === '/api/account/save' && method === 'POST') {
    const body = await readJson<Partial<Account> & { credentials: Record<string, string> }>(req);
    const def = platform(body.platform ?? '');
    if (!def) return send(res, 400, { error: 'bilinmeyen platform' });

    const id = (body.id || `${def.id}-${randomBytes(3).toString('hex')}`).replace(/[^a-z0-9-]/gi, '');
    const existing = await accounts.get(id);

    // Maskeli deger geri gonderilirse eski gercek degeri koru.
    const creds: Record<string, string> = { ...(existing?.credentials ?? {}) };
    for (const f of def.fields) {
      const v = body.credentials?.[f.key];
      if (typeof v === 'string' && !v.startsWith('••••')) creds[f.key] = v.trim();
    }

    const missing = def.fields.filter((f) => !f.optional && !creds[f.key]).map((f) => f.label);
    if (missing.length) return send(res, 400, { error: `eksik alan: ${missing.join(', ')}` });

    const account: Account = {
      id,
      platform: def.id,
      label: body.label?.trim() || def.label,
      enabled: body.enabled ?? true,
      credentials: creds,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      verifiedAs: existing?.verifiedAs,
    };

    // Kaydetmeden once dogrula: yanlis kimlikle hesap eklemek sessiz hataya yol acar.
    try {
      account.verifiedAs = await def.verify(creds);
    } catch (e) {
      return send(res, 400, { error: `dogrulama basarisiz: ${String(e).slice(0, 200)}` });
    }

    await accounts.upsert(account);
    return send(res, 200, { ok: true, account: redact(account) });
  }

  if (path === '/api/account/toggle' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const a = await accounts.get(id);
    if (!a) return send(res, 404, { error: 'hesap yok' });
    a.enabled = !a.enabled;
    await accounts.upsert(a);
    return send(res, 200, { ok: true, enabled: a.enabled });
  }

  /**
   * Hesabi manuel moda alir ya da geri dondurur.
   * Odeme yapildigi gun buradan kapatilir; baska degisiklik gerekmez.
   */
  if (path === '/api/account/manuel' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const a = await accounts.get(id);
    if (!a) return send(res, 404, { error: 'hesap yok' });
    a.manuel = !a.manuel;
    await accounts.upsert(a);
    return send(res, 200, {
      ok: true,
      manuel: a.manuel,
      message: a.manuel
        ? 'manuel mod acik — sistem bu hesaba API ile yayin yapmaz'
        : 'manuel mod kapali — yayin yeniden API uzerinden',
    });
  }

  if (path === '/api/account/verify' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const a = await accounts.get(id);
    if (!a) return send(res, 404, { error: 'hesap yok' });
    const def = platform(a.platform);
    if (!def) return send(res, 400, { error: 'platform yok' });
    try {
      a.verifiedAs = await def.verify(a.credentials);
      await accounts.upsert(a);
      return send(res, 200, { ok: true, verifiedAs: a.verifiedAs });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 300) });
    }
  }

  if (path === '/api/account/delete' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    await accounts.remove(id);
    return send(res, 200, { ok: true });
  }

  if (path === '/api/run' && method === 'POST') {
    const { stage } = await readJson<{ stage: string }>(req);
    try {
      return send(res, 200, { ok: true, message: await runStage(stage) });
    } catch (e) {
      return send(res, 500, { error: String(e).slice(0, 400) });
    }
  }

  send(res, 404, { error: 'yok' });
}

async function serveMedia(res: ServerResponse, path: string): Promise<void> {
  // Yol kacisi: data/media disina cikilmasin.
  const root = resolve('data/media');
  const file = resolve(root, decodeURIComponent(path.slice('/media/'.length)));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: 'yasak' });
  try {
    const buf = await readFile(file);
    const ext = extname(file).toLowerCase();
    const type =
      ext === '.png' ? 'image/png' : ext === '.mp4' ? 'video/mp4' : ext === '.mp3' ? 'audio/mpeg' : 'image/jpeg';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    send(res, 404, { error: 'gorsel yok' });
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;

    if (!authorized(req)) {
      return send(res, 401, '<h1>401</h1><p>Panel adresine ?token=... ekleyin.</p>', 'text/html');
    }

    try {
      if (path === '/' || path === '/index.html') {
        const html = await readFile('src/panel/index.html', 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': `panel_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
          'cache-control': 'no-store',
        });
        return res.end(html);
      }
      if (path.startsWith('/media/')) return await serveMedia(res, path);
      if (path.startsWith('/api/')) return await api(req, res, path);
      send(res, 404, { error: 'yok' });
    } catch (e) {
      log.err(`panel ${path}: ${e}`);
      send(res, 500, { error: String(e).slice(0, 300) });
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.log();
  log.ok('Panel acildi:');
  console.log(`\n    http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/?token=${TOKEN}\n`);
  if (!process.env['PANEL_TOKEN']) {
    log.warn('PANEL_TOKEN .env icinde yok; her acilista yeni token uretiliyor.');
    log.warn(`Sabitlemek icin .env dosyasina ekle:  PANEL_TOKEN=${TOKEN}`);
  }
  if (HOST !== '127.0.0.1') log.warn(`Panel disa acik (${HOST}). Token olmadan kimse giremez ama tunel kullan.`);
});
