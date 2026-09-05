import type { PlatformDef } from '../core/types.ts';
import { consolePlatform } from './console.ts';
import { bluesky } from './bluesky.ts';
import { mastodon } from './mastodon.ts';
import { discord } from './discord.ts';
import { x } from './x.ts';
import { instagram } from './instagram.ts';
import { youtube } from './youtube.ts';
import { tiktok } from './tiktok.ts';

/**
 * Yeni platform eklemek: bir dosya yaz, bu diziye ekle. Baska hicbir yer degismez.
 * Panel formu, dogrulama ve yayin tamamen PlatformDef alanlarindan turer.
 */
export const platforms: PlatformDef[] = [consolePlatform, x, instagram, youtube, tiktok, bluesky, mastodon, discord];

export function platform(id: string): PlatformDef | undefined {
  return platforms.find((p) => p.id === id);
}
