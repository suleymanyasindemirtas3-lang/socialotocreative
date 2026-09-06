import { log } from '../core/logger.ts';
import { extractObjects, str } from '../core/json.ts';
import { getLlm } from '../providers/llm/index.ts';
import { platformAlgo, kurallariAnlat } from '../strateji/algoritma.ts';
import type { Agent } from './types.ts';

/**
 * SOSYAL MEDYA UZMANI
 *
 * Postu yayindan once degerlendirir ve yildizlar. Amaci "guzel mi" degil,
 * "bu post bu platformda yayilir mi" sorusunu cevaplamak.
 *
 * Puanlama iki katmanli, bilincli olarak:
 *
 *   1. OLCULEBILIR SINYALLER (kod)  - link var mi, medya var mi, kanca var mi,
 *      sayi geciyor mu, hashtag yigini var mi. Bunlar tartisilmaz; modelin
 *      yorumuna birakilirsa tutarsiz olur.
 *
 *   2. MODEL YARGISI (LLM)          - metin gercekten tartisma baslatir mi,
 *      kanca ilgi ceker mi. Bunlar kodla olculemez.
 *
 * Ikisini ayirmanin sebebi: sadece modele sorarsak ayni metne her seferinde
 * farkli puan verir; sadece kodla puanlarsak icerigin kalitesini goremeyiz.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI - Kurallar content/algoritma.json icinde, kodda degil.
 * Platform siralamasini degistirdiginde orayi guncelle.
 * ---------------------------------------------------------------------------
 */

export interface Sinyal {
  id: string;
  aciklama: string;
  etki: number;
}

export interface Puan {
  /** 1-5. Panelde yildiz olarak gorunur. */
  yildiz: number;
  /** Neden bu puan; kullaniciya gosterilir. */
  gerekce: string;
  /** Puani olusturan tek tek sinyaller. */
  sinyaller: Sinyal[];
  /** Metni daha iyi hale getirecek somut oneri. */
  oneri?: string;
}

export interface PuanIstegi {
  metin: string;
  platform: string;
  medyaVar: boolean;
  videoVar: boolean;
  kategori?: string;
}

/** Kodla olculebilen sinyaller. Model yorumuna birakilmaz. */
function olculebilirSinyaller(istek: PuanIstegi): Sinyal[] {
  const t = istek.metin;
  const s: Sinyal[] = [];

  // Harici link en agir ceza: erisimi %50-70 dusuruyor.
  if (/https?:\/\/\S+/i.test(t)) {
    s.push({
      id: 'harici-link',
      aciklama: 'Metinde harici bağlantı var — erişim ciddi düşer, linki yanıta taşı',
      etki: -3,
    });
  }

  // Yanit en degerli etkilesim (13.5x), yazarin yanit vermesi en guclusu (75x).
  if (/\?/.test(t)) {
    s.push({ id: 'soru', aciklama: 'Soru içeriyor — yanıt daveti', etki: 2 });
  }

  if (istek.videoVar) {
    s.push({ id: 'video', aciklama: 'Yerli video — dağıtımda en güçlü medya', etki: 2 });
  } else if (istek.medyaVar) {
    s.push({ id: 'gorsel', aciklama: 'Yerli görsel — dağıtımı destekler', etki: 1 });
  } else {
    s.push({ id: 'medyasiz', aciklama: 'Medya yok — dağıtım desteği eksik', etki: -1 });
  }

  // Somutluk: sayi ve ozel isim kaydetme/tiklama oranini artiriyor.
  const sayiVar = /\d/.test(t);
  const ozelIsim = /(?:^|\s)[A-ZĞÜŞİÖÇ][\wğüşıöç]{2,}/.test(t);
  if (sayiVar && ozelIsim) {
    s.push({ id: 'somut', aciklama: 'Sayı ve özel isim içeriyor — somut', etki: 2 });
  } else if (sayiVar || ozelIsim) {
    s.push({ id: 'kismen-somut', aciklama: 'Kısmen somut', etki: 1 });
  } else {
    s.push({ id: 'soyut', aciklama: 'Sayı ya da özel isim yok — soyut kalıyor', etki: -2 });
  }

  const hashtag = (t.match(/#\w+/g) ?? []).length;
  if (hashtag > 2) {
    s.push({ id: 'hashtag-yigini', aciklama: `${hashtag} hashtag — spam sinyali`, etki: -2 });
  }

  // Ilk satir akista tek basina gorunuyor.
  const ilkSatir = t.split('\n')[0] ?? '';
  if (ilkSatir.length > 0 && ilkSatir.length <= 90) {
    s.push({ id: 'kanca-uzunlugu', aciklama: 'İlk satır kısa ve okunur', etki: 1 });
  }

  return s;
}

async function modelYargisi(
  istek: PuanIstegi,
  kurallar: string,
): Promise<{ puan: number; gerekce: string; oneri: string }> {
  const llm = getLlm();
  const raw = await llm.complete(
    [
      'Sen bir sosyal medya performans uzmanisin. Asagidaki postu SADECE yayilma',
      'potansiyeli acisindan degerlendir. Uslup begenin onemli degil.',
      '',
      kurallar,
      '',
      `Platform: ${istek.platform}`,
      istek.kategori ? `Kategori: ${istek.kategori}` : '',
      `Medya: ${istek.videoVar ? 'video' : istek.medyaVar ? 'gorsel' : 'yok'}`,
      '',
      'POST:',
      istek.metin,
      '',
      'Su semada JSON dondur, baska hicbir sey yazma:',
      '{"puan": 1-10 arasi sayi, "gerekce": "tek cumle", "oneri": "metni iyilestirecek tek somut degisiklik"}',
    ]
      .filter(Boolean)
      .join('\n'),
    { maxTokens: 400, json: true },
  );

  const o = extractObjects(raw)[0];
  if (!o) return { puan: 5, gerekce: 'model degerlendirme dondurmedi', oneri: '' };

  const ham = Number(o['puan'] ?? o['score'] ?? 5);
  return {
    puan: Number.isFinite(ham) ? Math.min(10, Math.max(1, ham)) : 5,
    gerekce: str(o, 'gerekce', 'reason', 'aciklama') || 'gerekce yok',
    oneri: str(o, 'oneri', 'suggestion', 'tavsiye'),
  };
}

export const sosyalMedyaUzmani: Agent<PuanIstegi, Puan> = {
  id: 'sosyal-medya-uzmani',
  role: 'Postu yayilma potansiyeline gore yildizlar ve iyilestirme onerir',
  uses: ['llm', 'algoritma-tabani'],

  async run(istek): Promise<Puan> {
    const algo = await platformAlgo(istek.platform);
    const sinyaller = olculebilirSinyaller(istek);
    const olculebilirToplam = sinyaller.reduce((a, s) => a + s.etki, 0);

    let yargi = { puan: 5, gerekce: '', oneri: '' };
    try {
      yargi = await modelYargisi(istek, algo ? kurallariAnlat(algo) : '');
    } catch (e) {
      log.warn(`uzman model yargisi alinamadi: ${String(e).slice(0, 90)}`);
    }

    /**
     * Birlestirme: model yargisi 1-10 -> 0-5 tabana indirilir, olculebilir
     * sinyaller uzerine binir. Sinyallerin agirligi bilincli olarak dusuk
     * (0.35): tek basina karar vermemeli, ama tutarsiz model puanini
     * dengelemeli.
     */
    const ham = yargi.puan / 2 + olculebilirToplam * 0.35;
    const yildiz = Math.min(5, Math.max(1, Math.round(ham)));

    const gerekce =
      [yargi.gerekce, olculebilirToplam < 0 ? 'Ölçülebilir sinyaller negatif.' : '']
        .filter(Boolean)
        .join(' ') || 'değerlendirme yapılamadı';

    return { yildiz, gerekce, sinyaller, ...(yargi.oneri ? { oneri: yargi.oneri } : {}) };
  },
};
