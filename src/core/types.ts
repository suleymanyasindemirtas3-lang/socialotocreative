// Tum sistemin ortak sozlesmesi. Hicbir saglayici bu dosyanin disina sizmaz.

export type PostStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'failed';

export interface MediaAsset {
  kind: 'image';
  path: string;
  alt: string;
  mime: string;
}

export interface PublishResult {
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
  /** platformId -> o platforma gore uyarlanmis metin */
  variants: Record<string, string>;
  media: MediaAsset[];
  targets: string[];
  scheduledAt?: string;
  results: PublishResult[];
  /** Telegram onay mesajinin id'si; callback eslestirmek icin */
  approvalRef?: string;
  /** dedup icin normalize edilmis parmak izi */
  fingerprint: string;
}

/** MOTTO 1: Her uretici bir arayuz. Ucretsiz/ucretli fark etmez. */
export interface LlmProvider {
  id: string;
  isConfigured(): boolean;
  complete(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<string>;
}

export interface ImageProvider {
  id: string;
  isConfigured(): boolean;
  generate(prompt: string, outPath: string): Promise<MediaAsset>;
}

/** MOTTO 2: Her platform ayni adaptor arayuzu. Yenisi eklemek = 1 dosya. */
export interface PlatformAdapter {
  id: string;
  limits: { text: number; media: number };
  isConfigured(): boolean;
  publish(post: Post, text: string): Promise<PublishResult>;
}

export interface Store {
  all(): Promise<Post[]>;
  byStatus(...s: PostStatus[]): Promise<Post[]>;
  get(id: string): Promise<Post | undefined>;
  upsert(p: Post): Promise<void>;
  fingerprints(): Promise<Set<string>>;
}
