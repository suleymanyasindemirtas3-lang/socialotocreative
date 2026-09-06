import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { cfg } from '../core/config.ts';
import { accounts } from '../core/accounts.ts';
import { platform } from '../platforms/index.ts';
import { getImage, imageEnabled } from '../providers/image/index.ts';
import { ses } from './ses.ts';
import { videoUretim } from './video-uretim.ts';
import { video } from './video.ts';
import { isteKonulu } from './ekipler/arastirma.ts';
import { seslendirmeYaz } from './senaryo.ts';
import { adayiIndir } from '../providers/image/arama.ts';
import { haberFotografi, gundemTopla } from '../kaynaklar/index.ts';
import { kategoriBul } from '../kategoriler/index.ts';
import { benzerlik } from './icerik-bulma.ts';
import type { MediaAsset, Post } from '../core/types.ts';

/**
 * 6. YONETMEN - produksiyon ekibinin lideri
 *
 * Ses, video-uretim ve video ajanlari birbirini cagirmaz; sirayi ve kosullari
 * bu dosya kurar. Hedef platformlarin ne istedigine (PlatformDef.needs) bakip
 * yalnizca gerekeni uretir - video istemeyen bir hedef icin video uretmez.
 *
 * Lider'den farki: lider EKIPLER arasinda dagitim yapar, yonetmen kendi
 * ekibinin ICINDE sira kurar. Iki ayri olcek, ayni desen.
 *
 * ARASTIRMA EKIBIYLE ILISKI
 * Yonetmen uretim sirasinda "bu konuda disarida ne var" diye sorabilir
 * (`isteKonulu`). Tur beklemesi anlamsiz olurdu; onbellekli oldugu icin
 * ayni turda tekrar dis istek atilmaz.
 * Bu ayricalik yalnizca EKIP LIDERLERINE ait: ses, video-uretim ve video
 * ajanlari disariya uzanamaz.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Gorsel istemi konuyla alakasiz cikiyorsa buraya bak.
 * Asagida gundem baglami gorsel istemine ekleniyor; istemin nasil
 * zenginlestigini gormek icin `npm run status` ciktisindaki gorsele bak.
 * ---------------------------------------------------------------------------
 */

/**
 * GORSEL TOPLAYICI
 *
 * Bir posta `hedef` adet gorsel bulur. Sira kalite sirasidir; ust basamak
 * yeterse alt basamaklara hic inilmez:
 *
 *   1. HABERIN KENDI FOTOGRAFI - konuyla birebir, okuyucunun tanidigi kare
 *   2. AYNI OLAYI ANLATAN DIGER HABERLERIN FOTOGRAFLARI - postun KENDI
 *      kategorisinin kaynaklarindan; ayni haber birden cok sitede cikiyor
 *      ve her birinin kendi fotografi oluyor
 *   3. AI URETIMI - en son care
 *
 * GENEL WEB GORSEL ARAMASI NEDEN YOK
 * Bir ara Openverse bu siraya konmustu. "GORA 4'un vizyon tarihi ve Cem
 * Yilmaz'in plani" haberine getirdigi gorsel Gurcistan'da bir kasaba
 * manzarasi oldu: Openverse bir Creative Commons arsivi, icinde haber
 * fotografi ya da unlu fotografi yok, kelimeye benzeyen ne varsa onu
 * donduruyor. Konusu yanlis GERCEK fotograf, konuya yakin AI gorselinden
 * daha kotu - okuyucu haberle ilgisiz kareyi hemen fark ediyor.
 * Openverse panelde "Web gorsel" dugmesi olarak duruyor: orada secen
 * kullanici, dogrulugunu kendi yargilar.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Gorseller hala zayifsa once hangi basamaktan geldigine
 * bak: dosya adindaki ek (-haber, -ilgili, -ai) kaynagi soyluyor.
 * Cok "-ai" goruyorsan sorun uretimde degil kaynakta: o kategorinin
 * kaynaklari fotograf vermiyor demektir.
 * ---------------------------------------------------------------------------
 */
async function gorselleriTopla(
  post: Post,
  visualPrompt: string,
  mekanPrompt: string | undefined,
  hedef: number,
  media: MediaAsset[],
): Promise<void> {
  /** Ayni fotografi iki kez eklememek icin. */
  const alinan = new Set<string>();

  const ekle = async (url: string, dosya: string, etiket: string): Promise<boolean> => {
    if (media.length >= hedef || alinan.has(url)) return false;
    try {
      const asset = await adayiIndir(
        { kaynak: etiket, url, thumb: url, baslik: post.topic },
        `data/media/${post.id}-${dosya}`,
      );
      media.push(asset);
      alinan.add(url);
      return true;
    } catch {
      log.warn(`${post.id}: ${etiket} gorseli alinamadi`);
      return false;
    }
  };

  // ---- 1. haberin kendi fotografi -----------------------------------------
  /**
   * RSS fotografi vermediyse haberin kendi sayfasindan al.
   *
   * Kaynaklarin %36'si RSS'te fotograf vermiyor ama haber sayfalarinin
   * hepsinde og:image var (olcum: 27/27). Onceden bu haberler dogruca AI
   * uretimine dusuyor ve konudan kopuk gorsel aliyordu.
   *
   * Bulunan adres posta yaziliyor: ayni post tekrar uretilirse sayfa
   * ikinci kez indirilmez.
   */
  if (!post.kaynak?.gorsel && post.kaynak?.url) {
    const bulunan = await haberFotografi(post.kaynak.url);
    if (bulunan && post.kaynak) {
      post.kaynak.gorsel = bulunan;
      log.info(`${post.id}: fotograf haber sayfasindan alindi`);
    }
  }

  if (post.kaynak?.gorsel) {
    if (await ekle(post.kaynak.gorsel, 'haber.jpg', post.kaynak.site ?? 'haber')) {
      log.ok(`${post.id}: haberin kendi fotografi kullanildi`);
    }
  }

  // ---- 2. ayni olayi anlatan diger haberler --------------------------------
  /**
   * Postun KENDI kategorisinin kaynaklarina bakilir, genel gundeme degil.
   *
   * Onceki hali `isteKonulu` cagiriyordu; o da genel trend zincirini
   * (hackernews, devto, github) okuyor. Turkce bir sinema haberine
   * Hacker News'ten eslesme cikmasi mumkun degil - basamak pratikte
   * hic calismiyordu.
   *
   * Eslesme esigi 0.3: ayni olayi anlatan iki baslik bu esigi rahat gecer,
   * ayni kategorideki alakasiz haber gecemez.
   */
  if (media.length < hedef && post.kategori) {
    const kat = await kategoriBul(post.kategori).catch(() => undefined);
    if (kat?.kaynaklar?.length) {
      const gundem = await gundemTopla(20, kat.kaynaklar).catch(() => []);
      const yakinlar = gundem
        .map((h) => ({ h, p: benzerlik(post.topic, h.title) }))
        .filter((x) => x.p >= 0.3)
        .sort((a, b) => b.p - a.p);

      let i = 0;
      for (const { h } of yakinlar) {
        if (media.length >= hedef) break;
        const foto = h.gorsel ?? (h.url ? await haberFotografi(h.url) : undefined);
        if (!foto) continue;
        if (await ekle(foto, `ilgili${++i}.jpg`, h.source)) {
          log.ok(`${post.id}: ayni olayi anlatan haberden fotograf (${h.source})`);
        }
      }
    }
  }

  // ---- 3. AI uretimi ------------------------------------------------------
  if (media.length < hedef && imageEnabled()) {
    /**
     * Gundem baglami isteme ekleniyor: model yalniz basligi gorunce
     * genel gecer bir sahne ciziyordu.
     */
    const baglam = await isteKonulu(post.topic, 2).catch(() => []);
    const zenginIstem = baglam.length
      ? `${visualPrompt}. Context: ${baglam.map((i) => i.title).join('; ').slice(0, 160)}`
      : visualPrompt;

    /**
     * GERCEK FOTOGRAF VARKEN AI'YA INSAN CIZDIRILMEZ.
     *
     * Ucretsiz gorsel modelleri gercek kisileri beceremiyor: yuz bozuk
     * cikiyor. Venedik galasi haberinde uretilen kare yuzu carpik bir
     * figurdu ve yanindaki iki gercek fotografin yaninda daha da kotu
     * duruyordu.
     *
     * Uzun bir kisi tarifinin sonuna "insan cizme" eklemek ise yaramadi:
     * model istemin BASINI takip ediyor, sonuna eklenen sarti yok sayiyor.
     * Bu yuzden mekan istemi senaryo asamasinda bastan ayri yaziliyor
     * (Senaryo.mekanPrompt).
     *
     * Kural: elde gercek fotograf varsa AI yalniz MEKAN uretir - sahneyi
     * gercek fotograf zaten anlatiyor. Hic fotograf yoksa sahne istemi
     * kullanilir, cunku o zaman konuyu anlatacak baska sey yok.
     */
    const gercekVar = media.length > 0;
    const temelIstem = gercekVar && mekanPrompt ? mekanPrompt : zenginIstem;
    const acilar = ['wide establishing shot', 'close detail of the setting', 'atmospheric mood shot'];

    let i = 0;
    while (media.length < hedef) {
      try {
        // Her karede farkli aci: ayni istemle ayni gorselin kopyasini
        // uretmek videoya hicbir sey katmaz.
        const istem = `${temelIstem}. ${acilar[i % acilar.length]}. No text or letters.`;
        media.push(await getImage().generate(istem, `data/media/${post.id}-ai${++i}.jpg`));
      } catch (e) {
        log.warn(`${post.id}: AI gorsel uretilemedi: ${String(e).slice(0, 90)}`);
        break;
      }
    }
  }
}

/**
 * `kategori` verilirse YALNIZ o kategorinin postlari islenir.
 *
 * Neden gerekti: kuyruk global. Kullanici panelden "Anime icerigi getir"
 * dediginde metinler yazildiktan sonra medya asamasi kuyruktaki EN ESKI
 * uc 'scripted' postu aliyordu - onlar da onceki turdan kalma Muzik
 * postlariydi. Sonuc: kullanicinin az once istedigi anime postlari
 * medyasiz kaliyor, eski postlarin medyasi uretiliyordu. Ekranda
 * "3 medya uretildi" yaziyor ama istenen postlarda medya yok.
 */
export async function uret(adet: number, kategori?: string): Promise<number> {
  const tumu = await store.byStatus('scripted');
  const hazir = (kategori ? tumu.filter((p) => p.kategori === kategori) : tumu).slice(0, adet);
  let ok = 0;

  for (const post of hazir) {
    try {
      const script = post.script;
      if (!script) throw new Error('senaryo yok; once icerik ekibi yazmali');

      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await accounts.get(accId);
        if (acc) platformIds.add(acc.platform);
      }

      // Hedeflerin ihtiyaci varsayilan; kullanici panelden ezebilir.
      const needs = [...platformIds].map((id) => platform(id)?.needs ?? 'none');
      const tercih = post.medya ?? 'otomatik';

      const wantsVideo =
        tercih === 'video' ? true : tercih === 'gorsel' || tercih === 'yok' ? false : needs.includes('video');
      const wantsImage =
        tercih === 'yok' ? false : tercih === 'gorsel' || wantsVideo || needs.includes('image') || imageEnabled();

      // Secim hedefle celisiyorsa sessizce gecme: yayin asamasinda anlasilmaz
      // bir hataya donusur, burada soylemek daha yararli.
      if (!wantsVideo && needs.includes('video')) {
        log.warn(`${post.id}: hedef video istiyor ama tercih "${tercih}" - o platformlarda yayin basarisiz olacak`);
      }
      if (!wantsImage && needs.includes('image')) {
        log.warn(`${post.id}: hedef gorsel istiyor ama tercih "${tercih}"`);
      }

      const media: MediaAsset[] = [];

      if (wantsImage) {
        /**
         * KAC GORSEL
         *
         * Tek gorsel yetmiyordu. Metin postunda tek kare akista zayif
         * kaliyor, videoda ise 40-50 saniye ayni fotografa bakmak
         * izleyiciyi ilk saniyeden sonra tutmuyor.
         *
         * Video daha fazla gorsel istiyor cunku gorseller ARDI ARDINA
         * gosteriliyor; gorsel postta ise yan yana duruyorlar.
         */
        const hedefAdet = wantsVideo ? 3 : 2;
        await gorselleriTopla(post, script.visualPrompt, script.mekanPrompt, hedefAdet, media);

        if (!media.length) {
          throw new Error('hic gorsel uretilemedi (haber fotografi yok, arama bos, AI kapali)');
        }
        if (media.length < hedefAdet) {
          log.warn(`${post.id}: ${hedefAdet} gorsel hedeflendi, ${media.length} bulundu`);
        }
      }

      if (wantsVideo) {
        // Metin yazilirken hedef video istemiyorduysa seslendirme uretilmemis
        // olur. Kullanici sonradan "video" secebilir; eksigi burada tamamla.
        if (!script.narration) {
          log.info(`${post.id}: seslendirme metni yok, uretiliyor`);
          script.narration = await seslendirmeYaz({ topic: post.topic, angle: post.angle });
          post.script = script;
          await store.upsert(post);
        }
        if (!script.narration) throw new Error('seslendirme metni uretilemedi');
        const stem = `data/media/${post.id}`;

        const audio = await ses.run({ text: script.narration, outPath: `${stem}.mp3` });
        const clip = await videoUretim.run({
          visualPrompt: script.visualPrompt,
          seconds: audio.seconds,
          outStem: stem,
          // Ucretsiz kaynak bunu aynen kullanir; AI kaynagi yok sayar.
          ...(media[0] ? { existingStill: media[0].path } : {}),
        });
        /**
         * Toplanan butun gorseller montaja gidiyor: video tek kareye
         * sabitlenmek yerine sirayla hepsini gosteriyor.
         */
        const kareler = media.filter((m) => m.kind === 'image').map((m) => m.path);
        const mp4 = await video.run({
          clip,
          audio,
          caption: script.narration,
          outPath: `${stem}.mp4`,
          ...(kareler.length > 1 ? { ekGorseller: kareler } : {}),
        });
        media.push({ kind: 'video', path: mp4, alt: post.topic, mime: 'video/mp4' });
      }

      post.media = media;
      post.status = cfg.approval.auto ? 'approved' : 'pending_approval';
      await store.upsert(post);
      ok++;
      log.ok(`uretildi ${post.id} -> ${post.status}`);
    } catch (e) {
      post.status = 'failed';
      post.results.push({
        accountId: '',
        platform: 'yonetmen',
        ok: false,
        error: String(e),
        at: new Date().toISOString(),
      });
      await store.upsert(post);
      log.err(`uretim hatasi ${post.id}: ${e}`);
    }
  }
  return ok;
}

/**
 * Basarisiz postlari geri alir. Senaryo duruyorsa 'scripted'e doner: metin
 * kaybolmaz, yalnizca medya uretimi tekrarlanir (Motto 5).
 */
export async function tekrarDene(adet: number): Promise<number> {
  const failed = (await store.byStatus('failed')).slice(0, adet);
  for (const post of failed) {
    const hasScript = Boolean(post.script && Object.keys(post.variants).length);
    post.status = hasScript ? 'scripted' : 'draft';
    if (!hasScript) {
      post.variants = {};
      delete post.script;
    }
    post.media = [];
    post.results = [];
    delete post.approvalRef;
    await store.upsert(post);
    log.info(`geri alindi ${post.id} -> ${post.status}`);
  }
  return failed.length;
}
