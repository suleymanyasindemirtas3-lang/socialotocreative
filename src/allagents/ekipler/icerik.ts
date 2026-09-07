import { randomUUID } from 'node:crypto';
import { log } from '../../core/logger.ts';
import { store } from '../../core/store.ts';
import { accounts, enabledAccounts } from '../../core/accounts.ts';
import { fingerprint } from '../../core/fingerprint.ts';
import { platform } from '../../platforms/index.ts';
import { icerikBulma } from '../icerik-bulma.ts';
import { senaryo } from '../senaryo.ts';
import { siradakiKategori, kullanildiIsaretle, kategoriBul } from '../../kategoriler/index.ts';
import { gundemTopla } from '../../kaynaklar/index.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';
import type { Post } from '../../core/types.ts';

/**
 * ICERIK EKIBI
 *
 * "Ne anlatilacak" ve "nasil yazilacak" sorularindan sorumlu.
 * Medyaya hic dokunmaz; ciktisi metindir.
 *
 * Ekip sinirinin buradan gecmesinin sebebi: metin ucuz ve hizli, medya
 * pahali ve yavas. Ikisini ayirmak, metin cope giderse bosuna ses/video
 * uretilmemesini saglar.
 */

async function fikirBul(
  adet: number,
  gundem: { title: string; source: string; ozet?: string; gorsel?: string; url?: string }[],
  istenenKategori?: string,
): Promise<Post[]> {
  const targets = (await enabledAccounts()).map((a) => a.id);

  /**
   * Kullanici panelden bir kategori sectiyse rotasyon atlanir.
   * Rotasyon otomatik turlar icin: ayni kalibin ust uste gelmesi hem
   * okuyucuyu hem algoritmayi yoruyor. Elle istek varsa secim kullanicinin.
   */
  const kategori = istenenKategori ? await kategoriBul(istenenKategori) : await siradakiKategori();
  if (kategori) log.info(`kategori: ${kategori.ad}${istenenKategori ? ' (elle secildi)' : ' (rotasyon)'}`);

  // Kategorinin kendi kaynaklari varsa gundem onlardan toplanir.
  if (kategori?.kaynaklar?.length) {
    gundem = (await gundemTopla(20, kategori.kaynaklar).catch(() => [])).map((g) => ({
      title: g.title,
      source: g.source,
      ...(g.ozet ? { ozet: g.ozet } : {}),
      ...(g.gorsel ? { gorsel: g.gorsel } : {}),
      ...(g.url ? { url: g.url } : {}),
    }));
    log.info(`kategori kaynaklarindan ${gundem.length} madde`);
  }
  /**
   * KULLANILMIS HABERLERI GUNDEMDEN CIKAR.
   *
   * Olcum: kuyruktaki 35 postun 9'u yalnizca 4 haberden uretilmisti;
   * bir haber tek basina dort post dogurmustu.
   *
   * Sebep: tekrar filtresi KONU METNINE bakiyordu. Model ayni haberi her
   * turda birazcik farkli yaziyor ("Sword Art Online: Material 1 - Sugary
   * Days Agustos 2026'da..." / "Sword Art Online Material 1 'Sugary Days'
   * Oricon...") ve iki metnin parmak izi tutmadigi icin ikisi de geciyordu.
   *
   * Cozum konu metni degil KAYNAK LINKI: bir haberden post uretildiyse o
   * haber gundemden dusuyor ve model onu hic gormuyor. Boylece hem tekrar
   * bitiyor hem de modelin dikkati kalan taze haberlere kaliyor.
   */
  const kullanilmis = new Set(
    (await store.all()).map((p) => p.kaynak?.url).filter((u): u is string => Boolean(u)),
  );
  const oncekiAdet = gundem.length;
  gundem = gundem.filter((g) => !g.url || !kullanilmis.has(g.url));
  if (oncekiAdet !== gundem.length) {
    log.info(`${oncekiAdet - gundem.length} haber daha once kullanilmis, gundemden cikarildi`);
  }

  if (!gundem.length) {
    log.warn('bu kaynaklardaki butun haberler kullanilmis; yeni haber bekleniyor');
    return [];
  }

  const fikirler = await icerikBulma.run({
    count: adet,
    recent: (await store.all()).slice(-40).map((p) => p.topic),
    seen: await store.fingerprints(),
    gundem,
    ...(kategori ? { kategori: { id: kategori.id, ad: kategori.ad, yonerge: kategori.yonerge } } : {}),
  });

  const out: Post[] = [];
  for (const f of fikirler) {
    const post: Post = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      topic: f.topic,
      angle: f.angle,
      status: 'draft',
      variants: {},
      media: [],
      targets,
      results: [],
      fingerprint: fingerprint(f.topic),
      ...(f.kaynak ? { kaynak: f.kaynak } : {}),
      ...(kategori ? { kategori: kategori.id, medya: kategori.medya } : {}),
    };
    await store.upsert(post);
    out.push(post);
    log.ok(`fikir ${post.id}: ${post.topic}`);
  }
  if (kategori && out.length) await kullanildiIsaretle(kategori.id);
  return out;
}

/**
 * `kategori` verilirse yalniz o kategorinin taslaklari yazilir.
 *
 * Medya ve puanlama adimlarinda duzeltilen ayni kapsam hatasi burada da
 * vardi ve gozden kacmisti: kullanici "Anime icerigi getir" dedi, uc
 * anime fikri uretildi, sonra metin adimi kuyruktaki en eski uc taslagi
 * aldi - onlar baska kategorilerdendi. Ekranda "3 fikir bulundu, 1 metin
 * yazildi" yaziyor ama yazilan metin o uc fikre ait degildi.
 */
async function yaz(adet: number, kategori?: string): Promise<number> {
  const tumu = await store.byStatus('draft');
  const drafts = (kategori ? tumu.filter((p) => p.kategori === kategori) : tumu).slice(0, adet);
  let ok = 0;

  for (const post of drafts) {
    try {
      // Hedef hesaplardan platform kumesi: ayni platformdaki iki hesap ayni
      // metni paylasir, metin hesap basina degil platform basina uretilir.
      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await accounts.get(accId);
        if (acc) platformIds.add(acc.platform);
      }
      if (!platformIds.size) throw new Error('acik hedef hesap yok');

      const wantsVideo = [...platformIds].some((id) => platform(id)?.needs === 'video');

      const kat = post.kategori ? await kategoriBul(post.kategori) : undefined;
      const script = await senaryo.run({
        fikir: {
          topic: post.topic,
          angle: post.angle,
          ...(post.kaynak ? { kaynak: post.kaynak } : {}),
        },
        ...(kat ? { kategori: { id: kat.id, ad: kat.ad, yonerge: kat.yonerge } } : {}),
        platforms: [...platformIds].map((id) => ({ id, limit: platform(id)?.limits.text ?? 500 })),
        narrationNeeded: wantsVideo,
      });

      post.variants = script.variants;
      if (script.metinAdaylari && Object.keys(script.metinAdaylari).length) {
        post.metinAdaylari = script.metinAdaylari;
      }
      post.script = {
        visualPrompt: script.visualPrompt,
        ...(script.narration ? { narration: script.narration } : {}),
        ...(script.mekanPrompt ? { mekanPrompt: script.mekanPrompt } : {}),
      };
      post.status = 'scripted';
      await store.upsert(post);
      ok++;
      log.ok(`yazildi ${post.id}`);
    } catch (e) {
      post.status = 'failed';
      post.results.push({
        accountId: '',
        platform: 'icerik',
        ok: false,
        error: String(e),
        at: new Date().toISOString(),
      });
      await store.upsert(post);
      log.err(`yazim hatasi ${post.id}: ${e}`);
    }
  }
  return ok;
}

export const icerikEkibi: Ekip = {
  id: 'icerik',
  role: 'Ne anlatilacagina karar verir ve metinleri yazar',
  members: ['icerik-bulma', 'senaryo'],
  handles: ['fikir-bul', 'icerik-yaz'],

  async run(gorev: Gorev): Promise<GorevSonucu> {
    const head = { gorev, ekip: 'icerik' };
    try {
      if (gorev.tur === 'fikir-bul') {
        // Gundem liderden girdi olarak gelir; ekip disariya kendi istek atmaz.
        const gundem = Array.isArray(gorev.girdi)
          ? (gorev.girdi as { title: string; source: string }[])
          : [];
        const n = (await fikirBul(gorev.adet, gundem, gorev.kategori)).length;
        return {
          ...head,
          ok: true,
          ozet: `${n} fikir bulundu${gundem.length ? ` (${gundem.length} gundem maddesinden)` : ' (gundemsiz)'}`,
        };
      }
      const n = await yaz(gorev.adet, gorev.kategori);
      return { ...head, ok: true, ozet: `${n} metin yazildi` };
    } catch (e) {
      return { ...head, ok: false, ozet: 'basarisiz', error: String(e) };
    }
  },
};
