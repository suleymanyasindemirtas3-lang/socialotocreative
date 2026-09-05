// Tum sistemin ortak sozlesmesi. Hicbir saglayici bu dosyanin disina sizmaz.

export type PostStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'failed';

export interface MediaAsset {
  kind: 'image' | 'video';
  path: string;
  alt: string;
  mime: string;
}

export interface PublishResult {
  /** Hangi hesaba gitti. Coklu hesapta platform tek basina yetmiyor. */
  accountId: string;
  platform: string;
  ok: boolean;
  url?: string;
  error?: string;
  at: string;
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
