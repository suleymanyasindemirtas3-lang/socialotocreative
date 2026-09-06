import { log } from '../../core/logger.ts';
import { store } from '../../core/store.ts';
import { accounts } from '../../core/accounts.ts';
import { platform } from '../../platforms/index.ts';
import { sosyalMedyaUzmani } from '../sosyal-medya-uzmani.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';

/**
 * STRATEJI EKIBI - sosyal medya yoneticisi
 *
 * Uretim ile yayin arasinda duran karar katmani. Yonetmen "nasil uretilir"
 * sorusunu cozer; bu ekip "bu hali yayilir mi" sorusunu sorar.
 *
 * Yonetmenle iliskisi: yonetmen medyayi uretir, bu ekip sonucu puanlar ve
 * iyilestirme onerir. Puan dusukse kullanici baska bir metin adayina
 * gecebilir ya da oneriyi uygulayabilir.
 *
 * Ekiplerin ustunde lider var; bu ekip de ona bagli. Ama puanlama tek
 * post uzerinde de calisabilsin diye `puanla()` disari aciliyor - panelde
 * "yeniden puanla" dugmesi bunu cagiriyor.
 */

/** Tek bir postu, secili metnini ve medyasini dikkate alarak puanlar. */
export async function puanla(postId: string): Promise<number> {
  const post = await store.get(postId);
  if (!post) throw new Error('post yok');

  // Hangi platform icin puanlanacak: ilk acik hedefin platformu.
  let platformId = 'x';
  for (const accId of post.targets) {
    const acc = await accounts.get(accId);
    if (acc) {
      platformId = acc.platform;
      break;
    }
  }

  const metin = post.variants[platformId] ?? Object.values(post.variants)[0];
  if (!metin) throw new Error('puanlanacak metin yok');

  const puan = await sosyalMedyaUzmani.run({
    metin,
    platform: platformId,
    medyaVar: post.media.some((m) => m.kind === 'image'),
    videoVar: post.media.some((m) => m.kind === 'video'),
    ...(post.kategori ? { kategori: post.kategori } : {}),
  });

  post.puan = puan;

  // Metin adaylari varsa hepsi puanlanir; kullanici karsilastirarak secsin.
  const adaylar = post.metinAdaylari?.[platformId];
  if (adaylar?.length) {
    for (const aday of adaylar) {
      if (aday.puan) continue;
      aday.puan = await sosyalMedyaUzmani.run({
        metin: aday.metin,
        platform: platformId,
        medyaVar: post.media.some((m) => m.kind === 'image'),
        videoVar: post.media.some((m) => m.kind === 'video'),
        ...(post.kategori ? { kategori: post.kategori } : {}),
      });
    }
  }

  await store.upsert(post);
  log.ok(`${post.id} puanlandi: ${puan.yildiz} yildiz`);
  return puan.yildiz;
}

/** Puansiz postlari toplu puanlar. */
async function toplu(adet: number): Promise<number> {
  const hedefler = (await store.all())
    .filter((p) => Object.keys(p.variants).length && !p.puan)
    .slice(0, adet);

  let n = 0;
  for (const p of hedefler) {
    try {
      await puanla(p.id);
      n++;
    } catch (e) {
      log.warn(`${p.id} puanlanamadi: ${String(e).slice(0, 90)}`);
    }
  }
  return n;
}

export const stratejiEkibi: Ekip = {
  id: 'strateji',
  role: 'Postlari yayilma potansiyeline gore puanlar ve iyilestirme onerir',
  members: ['sosyal-medya-uzmani'],
  lead: 'sosyal-medya-uzmani',
  handles: ['puanla'],

  async run(gorev: Gorev): Promise<GorevSonucu> {
    const head = { gorev, ekip: 'strateji' };
    try {
      return { ...head, ok: true, ozet: `${await toplu(gorev.adet)} post puanlandi` };
    } catch (e) {
      return { ...head, ok: false, ozet: 'basarisiz', error: String(e) };
    }
  },
};
