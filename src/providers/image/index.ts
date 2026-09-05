import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cfg } from '../../core/config.ts';
import type { ImageProvider, MediaAsset } from '../../core/types.ts';

/** Anahtar gerektirmez, tamamen ucretsiz. Ucretli gecis icin fal/replicate ayni arayuze yazilir. */
const pollinations: ImageProvider = {
  id: 'pollinations',
  isConfigured: () => true,
  async generate(prompt, outPath) {
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${cfg.image.width}&height=${cfg.image.height}&nologo=true&model=flux`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`pollinations ${res.status}`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return { kind: 'image', path: outPath, alt: prompt.slice(0, 280), mime: 'image/jpeg' };
  },
};

const none: ImageProvider = {
  id: 'none',
  isConfigured: () => true,
  async generate(): Promise<MediaAsset> {
    throw new Error('IMAGE_PROVIDER=none iken gorsel uretilemez');
  },
};

const registry: Record<string, ImageProvider> = { pollinations, none };

export function getImage(): ImageProvider {
  return registry[cfg.image.provider] ?? none;
}
export const imageEnabled = () => cfg.image.provider !== 'none';
