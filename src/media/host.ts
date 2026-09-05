import { basename } from 'node:path';
import { cfg } from '../core/config.ts';

/**
 * Yalnizca Instagram medyayi public URL olarak ister; Graph API dosya yuklemesi
 * kabul etmez, medyayi kendisi cekmek zorundadir. X, Bluesky, Mastodon, Discord,
 * YouTube ve TikTok dogrudan ikili yukleme aldigi icin bu katmani kullanmaz.
 */
export interface MediaHost {
  id: string;
  isConfigured(): boolean;
  /** Yerel dosya yolundan disaridan erisilebilir bir URL uretir. */
  publicUrl(localPath: string): Promise<string>;
}

/**
 * Medya zaten kuyrukla birlikte repoya commit'leniyor; public repoda
 * raw.githubusercontent.com onu bedelsiz ve kendi kontrolunde servis eder.
 * Ucuncu taraf anonim barindiriciya yuklemekten hem daha guvenli hem daha kalici.
 */
const github: MediaHost = {
  id: 'github',
  isConfigured: () => Boolean(cfg.mediaHost.repo),
  async publicUrl(localPath) {
    const rel = localPath.replace(/\\/g, '/').replace(/^\.?\//, '');
    return `https://raw.githubusercontent.com/${cfg.mediaHost.repo}/${cfg.mediaHost.branch}/${rel}`;
  },
};

/** Kendi sunucun ya da tunel: PUBLIC_MEDIA_BASE=https://ornek.com/media */
const baseUrl: MediaHost = {
  id: 'base',
  isConfigured: () => Boolean(cfg.mediaHost.base),
  async publicUrl(localPath) {
    return `${cfg.mediaHost.base.replace(/\/+$/, '')}/${basename(localPath)}`;
  },
};

const none: MediaHost = {
  id: 'none',
  isConfigured: () => true,
  async publicUrl() {
    throw new Error(
      'Instagram medyayi public URL olarak ister. MEDIA_HOST=github ve ' +
        'MEDIA_REPO=kullanici/repo ayarla (repo public olmali), ya da MEDIA_HOST=base ' +
        've PUBLIC_MEDIA_BASE=https://... ver.',
    );
  },
};

const registry: Record<string, MediaHost> = { github, base: baseUrl, none };

export function getMediaHost(): MediaHost {
  const h = registry[cfg.mediaHost.provider];
  return h?.isConfigured() ? h : none;
}
