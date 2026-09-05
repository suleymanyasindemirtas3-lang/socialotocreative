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
}

// ------------------------------------------------------------------- 5. senaryo

export interface SenaryoIstegi {
  fikir: Fikir;
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
