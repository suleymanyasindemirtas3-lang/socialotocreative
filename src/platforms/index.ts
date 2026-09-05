import { cfg } from '../core/config.ts';
import type { PlatformAdapter } from '../core/types.ts';
import { consoleAdapter } from './console.ts';
import { telegramAdapter } from './telegram.ts';
import { blueskyAdapter } from './bluesky.ts';

// Yeni platform eklemek: bir dosya yaz, buraya ekle. Baska hicbir yer degismez.
export const allPlatforms: PlatformAdapter[] = [consoleAdapter, telegramAdapter, blueskyAdapter];

export function platform(id: string): PlatformAdapter | undefined {
  return allPlatforms.find((p) => p.id === id);
}

/** .env TARGETS icinde yazan ve gercekten yapilandirilmis olanlar. */
export function activePlatforms(): PlatformAdapter[] {
  return cfg.targets
    .map((id) => platform(id))
    .filter((p): p is PlatformAdapter => Boolean(p?.isConfigured()));
}
