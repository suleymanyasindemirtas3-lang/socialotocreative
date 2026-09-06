import type { MediaAsset, Post } from '../core/types.ts';

/**
 * Ajan katmani.
 *
 * Saglayicilar (LLM, TTS, ClipSource) "ne ile yapilir" sorusunu cevaplar.
 * Ajanlar "kim ne yapar" sorusunu cevaplar. Ikisi ayri katman: bir ajanin
 * hangi saglayiciyi kullandigi degisebilir, sorumlulugu degismez.
 *
 * Her ajan tek bir isten sorumlu ve tek bir cikti uretir. Yonetmen disinda
 * hicbir ajan baska bir ajani cagirmaz; boylece sira ve karar tek yerde durur.
 */
export interface Agent<In, Out> {
  id: string;
  /** Insanin okuyacagi gorev tanimi; panel ve doctor bunu gosterir. */
  role: string;
  /** Hangi saglayici katmanlarina dayaniyor. Maliyet takibi icin. */
  uses: string[];
  run(input: In): Promise<Out>;
}

// --------------------------------------------------------------- 1. icerik bulma

export interface Fikir {
  topic: string;
  angle: string;
}

export interface FikirIstegi {
  /** Kac fikir istendigi. */
  count: number;
  /** Daha once uretilmis konular; ayni fikri tekrar uretmemek icin. */
  recent: string[];
  /** Daha once gorulmus parmak izleri. */
  seen: Set<string>;
  /**
   * Arastirma ekibinden gelen gercek gundem. Bos gelirse model konu uydurur
   * ve icerik jeneriklesir - hat durmaz ama kalite duser.
   */
  gundem?: { title: string; source: string }[];
  /** Bu turda uretilecek icerik kategorisi; bicimi belirler. */
  kategori?: { id: string; ad: string; yonerge: string };
}

// ------------------------------------------------------------------- 5. senaryo

export interface SenaryoIstegi {
  fikir: Fikir;
  /** Kategori yonergesi metnin bicimini belirler. */
  kategori?: { id: string; ad: string; yonerge: string };
  /** Metin uretilecek platformlar ve karakter sinirlari. */
  platforms: { id: string; limit: number }[];
  /** Seslendirme metni de istensin mi (video hedefi varsa). */
  narrationNeeded: boolean;
}

export interface Senaryo {
  /** platformId -> post metni */
  variants: Record<string, string>;
  /** Seslendirme metni. Post metninden ayri: konusma dili yazi dilinden farkli. */
  narration?: string;
  /** Goruntu uretimi icin ingilizce istem. */
  visualPrompt: string;
}

// ----------------------------------------------------------------------- 3. ses

export interface SesIstegi {
  text: string;
  outPath: string;
  voice?: string;
}

export interface SesSonucu {
  path: string;
  seconds: number;
  provider: string;
}

// -------------------------------------------------------------- 2. video uretim

export interface KlipIstegi {
  visualPrompt: string;
  seconds: number;
  outStem: string;
  /** Uretim asamasi zaten gorsel urettiyse; ucretsiz kaynak onu kullanir. */
  existingStill?: string;
}

export interface KlipSonucu {
  path: string;
  /** true ise hazir hareket var, Ken Burns uygulanmaz. */
  motion: boolean;
  provider: string;
}

// --------------------------------------------------------------------- 4. video

export interface MontajIstegi {
  clip: KlipSonucu;
  audio: SesSonucu;
  caption: string;
  outPath: string;
}

// ------------------------------------------------------------------ 6. yonetmen

export interface YonetmenSonucu {
  post: Post;
  media: MediaAsset[];
}

// ------------------------------------------------------------- ekip / gorev

/**
 * Gorev turleri. Lider bunlari uretir, ekipler bunlari yerine getirir.
 * Yeni bir ekip eklemek = yeni bir tur tanimlayip ekibi kayda eklemek.
 */
export type GorevTuru =
  | 'gundem-topla'
  | 'fikir-bul'
  | 'icerik-yaz'
  | 'medya-uret'
  | 'yayinla'
  | 'tekrar-dene';

export interface Gorev {
  tur: GorevTuru;
  /** Kac birim islenecek. */
  adet: number;
  /** Liderin bu gorevi neden actigi. Log ve panelde gorunur. */
  sebep: string;
  /**
   * Onceki gorevin ciktisi. Ekipler arasi veri boyle akar: hicbir ekip
   * baska bir ekibi cagirmaz, lider sonucu bir sonrakine girdi olarak verir.
   */
  girdi?: unknown;
}

export interface GorevSonucu {
  gorev: Gorev;
  ekip: string;
  ok: boolean;
  ozet: string;
  error?: string;
  /** Sonraki goreve aktarilacak veri. Liderin tasidigi tek yuk. */
  veri?: unknown;
}

/**
 * Ekip: ortak bir alanda calisan ajanlar toplulugu.
 *
 * Lider ekibin ICINE bakmaz; yalnizca `handles` listesine bakip gorevi yollar.
 * Ekibin kac ajani oldugu, hangi sirayla calistirdigi ekibin kendi bilgisi.
 * Yeni ekip eklemek liderde tek satir degisiklik bile gerektirmez.
 */
export interface Ekip {
  id: string;
  role: string;
  /** Ekip uyeleri. Yalnizca gorunurluk icin; lider bunlari cagirmaz. */
  members: string[];
  /** Ekibin lideri olan ajan varsa id'si. */
  lead?: string;
  handles: GorevTuru[];
  run(gorev: Gorev): Promise<GorevSonucu>;
}
