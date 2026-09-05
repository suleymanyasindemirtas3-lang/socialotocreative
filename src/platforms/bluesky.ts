import { readFile } from 'node:fs/promises';
import { AtpAgent, RichText } from '@atproto/api';
import { cfg } from '../core/config.ts';
import type { PlatformAdapter, Post, PublishResult } from '../core/types.ts';

let agent: AtpAgent | null = null;

async function login(): Promise<AtpAgent> {
  if (agent) return agent;
  const a = new AtpAgent({ service: cfg.bluesky.service });
  await a.login({ identifier: cfg.bluesky.identifier, password: cfg.bluesky.password });
  agent = a;
  return a;
}

export const blueskyAdapter: PlatformAdapter = {
  id: 'bluesky',
  limits: { text: 300, media: 4 },
  isConfigured: () => Boolean(cfg.bluesky.identifier && cfg.bluesky.password),

  async publish(post: Post, text: string): Promise<PublishResult> {
    const at = new Date().toISOString();
    try {
      const a = await login();

      // Link ve etiketleri Bluesky'nin facet formatina cevirir.
      const rt = new RichText({ text });
      await rt.detectFacets(a);

      let embed;
      const shots = post.media.slice(0, 4);
      if (shots.length) {
        const images = [];
        for (const m of shots) {
          const up = await a.uploadBlob(await readFile(m.path), { encoding: m.mime });
          images.push({ image: up.data.blob, alt: m.alt });
        }
        embed = { $type: 'app.bsky.embed.images', images };
      }

      const r = await a.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: at,
        ...(embed ? { embed } : {}),
      });

      const rkey = r.uri.split('/').pop();
      return {
        platform: 'bluesky',
        ok: true,
        url: `https://bsky.app/profile/${cfg.bluesky.identifier}/post/${rkey}`,
        at,
      };
    } catch (e) {
      return { platform: 'bluesky', ok: false, error: String(e), at };
    }
  },
};
