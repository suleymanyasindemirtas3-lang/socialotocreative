// Tum sistemin ortak sozlesmesi. Hicbir saglayici bu dosyanin disina sizmaz.

export type PostStatus =
  | 'draft'
  /** Metinler yazildi, medya heNUZ uretilmedi. Iki ekip arasindaki sinir. */
  | 'scripted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'failed';

/**
 * Post basina medya tercihi.
 * 'otomatik' hedef platformlarin ihtiyacindan turer (YouTube/TikTok video ister).
 * Digerleri o turetmeyi ezer; kullanici bilerek secmisse sistem karismaz.
 */
export type MedyaTercihi = 'otomatik' | 'gorsel' | 'video' | 'yok';

export interface MediaAsset {
  kind: 'image' | 'video';
  path: string;
  alt: string;
  mime: string;
}

/** Sosyal medya uzmaninin verdigi yayilma puani. */
export interface PostPuani {
  yildiz: number;
  gerekce: string;
  sinyaller: { id: string; aciklama: string; etki: number }[];
  oneri?: string;
}

export interface PublishResult {
  /** Hangi hesaba gitti. Coklu hesapta platform tek basina yetmiyor. */
  accountId: string;
  platform: string;
  ok: boolean;
  url?: string;
  error?: string;
  at: string;
  /** API ile degil, kullanici elle paylasti. Bkz. Account.manuel */
  manuel?: boolean;
}

export interface Post {
  id: string;
  createdAt: string;
  topic: string;
  angle: string;
  status: PostStatus;
  /** platformId -> o platformun sinirlarina gore uyarlanmis metin */
  variants: Record<string, string>;
  media: MediaAsset[];
  /** Hesap id'leri. Ayni platformda birden fazla hesap olabilir. */
  targets: string[];
  /**
   * Senaryo ekibinin ciktisi. Ayri tutulur cunku medya uretimi cokerse
   * yazilan metin kaybolmamali; tekrar denerken bastan yazilmaz.
   */
  script?: { visualPrompt: string; narration?: string };
  /** Bos ise 'otomatik'. Panelden degistirilir. */
  medya?: MedyaTercihi;
  /** Icerik kategorisi id'si. Bicimi ve varsayilan medyayi belirler. */
  kategori?: string;
  /** Dayandigi haber: ozet, link ve haberin kendi fotografi. */
  kaynak?: { ozet?: string; url?: string; gorsel?: string; tarih?: string; site?: string };
  /**
   * Platform basina METIN SECENEKLERI, her biri puanli.
   * Tek metin uretip dayatmak yerine secenek sunuluyor: ayni haber farkli
   * acilarla yazilabilir ve hangisinin tutacagi onceden belli degil.
   */
  metinAdaylari?: Record<string, { metin: string; puan?: PostPuani }[]>;
  /** Gorsel secenekleri; kullanici birini secer. */
  gorselAdaylari?: MediaAsset[];
  /** Secili metnin puani. Panelde yildiz olarak gorunur. */
  puan?: PostPuani;
  scheduledAt?: string;
  results: PublishResult[];
  approvalRef?: string;
  fingerprint: string;
}

// ---------------------------------------------------------------- hesaplar

/** Panelin "hesap ekle" formunu kendi kendine cizebilmesi icin alan tanimi. */
export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
  placeholder?: string;
  help?: string;
}

export interface Account {
  id: string;
  platform: string;
  label: string;
  enabled: boolean;
  credentials: Record<string, string>;
  createdAt: string;
  /** verify() sonucu: hesabin gercek kimligi. Yanlis hesaba yayini onler. */
  verifiedAs?: string;
  /**
   * MANUEL MOD.
   *
   * true ise sistem bu hesaba API ile yayin YAPMAZ. Uretimin tamami
   * (metin, gorsel, video, puanlama) normal calisir; yalnizca son adim
   * kullaniciya birakilir: panel hazir paketi verir, kullanici kendi
   * elleriyle paylasir ve "paylastim" der.
   *
   * Neden var: X ucretsiz katmani 6 Subat 2026'da kapandi ve yayin ucretli
   * krediye baglandi. Sistem calistigi kanitlanmadan hicbir platforma para
   * odenmemeli. Manuel mod, 0 maliyet kisitini bozmadan uretimin tamamini
   * ayakta tutar. Odeme yapildigi gun bu bayrak kapatilir, baska hicbir
   * degisiklik gerekmez.
   */
  manuel?: boolean;
}

export interface AccountStore {
  all(): Promise<Account[]>;
  get(id: string): Promise<Account | undefined>;
  upsert(a: Account): Promise<void>;
  remove(id: string): Promise<void>;
}

// ---------------------------------------------------------------- uretim

export interface LlmOptions {
  system?: string;
  maxTokens?: number;
  /** Kucuk modeller serbest metinde JSON'u bozuyor; destekleyen uc zorlar. */
  json?: boolean;
}

/** MOTTO 1: Her uretici bir arayuz. Ucretsiz/ucretli fark etmez. */
export interface LlmProvider {
  id: string;
  isConfigured(): boolean;
  complete(prompt: string, opts?: LlmOptions): Promise<string>;
}

/**
 * Saglayici sinifi. Panel ve doctor bunu gosterir; "0 maliyet zorunlu ama
 * ucretli degerlendirilebilir" kisitinin kod tarafindaki karsiligi.
 *   free   - sinirsiz/bedelsiz
 *   credit - ucretsiz kredi verir, bitince durur
 *   paid   - kullandikca oder
 */
export type Tier = 'free' | 'credit' | 'paid';

export interface TtsProvider {
  id: string;
  tier: Tier;
  isConfigured(): boolean;
  /** Metni seslendirip ses dosyasi yolunu dondurur. */
  speak(text: string, outPath: string, voice?: string): Promise<string>;
}

/**
 * Videonun GORUNTU kaynagi. Ses, altyazi ve formatlama compose() icinde kalir.
 * Bu ayrim onemli: ucretli AI video uretimi ffmpeg'in yerini almaz, yalnizca
 * durgun gorselin yerini alir. Boylece pahali sagayici yalniz gorsel uretir,
 * gerisi bedelsiz yerel islemede kalir.
 */
export interface ClipSource {
  id: string;
  tier: Tier;
  isConfigured(): boolean;
  produce(opts: ClipRequest): Promise<ClipResult>;
}

export interface ClipRequest {
  prompt: string;
  seconds: number;
  outStem: string;
  /**
   * Cagiran zaten uygun bir durgun gorsel urettiyse yolu. Ucretsiz kaynak
   * bunu aynen kullanir (ikinci kez uretmez); AI kaynagi yok sayar.
   */
  existingStill?: string;
}

export interface ClipResult {
  path: string;
  /** true ise hazir video klip, false ise durgun gorsel (Ken Burns uygulanir). */
  motion: boolean;
}

export interface ImageProvider {
  id: string;
  isConfigured(): boolean;
  generate(prompt: string, outPath: string): Promise<MediaAsset>;
}

// ---------------------------------------------------------------- platformlar

/**
 * MOTTO 2 (yeni platform = tek dosya): bir platform kendi kimlik alanlarini
 * da tanimlar. Panel formu bu tanimdan uretir, panelde platforma ozel kod olmaz.
 */
export interface PlatformDef {
  id: string;
  label: string;
  limits: { text: number; media: number };
  /**
   * Bu platform yayin icin ne istiyor.
   * 'video' olanlar (YouTube, TikTok) metin+gorselle beslenemez; uretim
   * asamasi bunu bilmeden dogru medyayi hazirlayamaz.
   */
  needs: 'none' | 'image' | 'video';
  fields: CredentialField[];
  setupUrl?: string;
  setupHint?: string;
  /** Kimlik dogrular ve hesabin gorunen adini dondurur. */
  verify(creds: Record<string, string>): Promise<string>;
  publish(post: Post, text: string, creds: Record<string, string>): Promise<PublishResult>;
}

export interface Store {
  all(): Promise<Post[]>;
  byStatus(...s: PostStatus[]): Promise<Post[]>;
  get(id: string): Promise<Post | undefined>;
  upsert(p: Post): Promise<void>;
  remove(id: string): Promise<void>;
  fingerprints(): Promise<Set<string>>;
}
