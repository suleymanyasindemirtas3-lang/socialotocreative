import { createHash } from 'node:crypto';

/** Ayni fikri iki kez uretmemek icin kaba ama etkili normalizasyon. */
export function fingerprint(text: string): string {
  const norm = text
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 24)
    .join(' ');
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}
