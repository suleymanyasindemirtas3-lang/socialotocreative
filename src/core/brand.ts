import { readFile } from 'node:fs/promises';
import { cfg } from './config.ts';

/**
 * Marka sesi her uretim isteginde sistem talimati olarak gonderilir.
 * ideate icindeydi; birden fazla ajan kullandigi icin ortak yere tasindi.
 */
export async function brandVoice(): Promise<string> {
  try {
    return await readFile('content/brand.md', 'utf8');
  } catch {
    return `Nis: ${cfg.brand.niche}. Ton: ${cfg.brand.tone}.`;
  }
}
