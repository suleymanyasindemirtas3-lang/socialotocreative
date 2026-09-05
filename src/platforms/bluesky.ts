import { readFile } from 'node:fs/promises';
import { AtpAgent, RichText } from '@atproto/api';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

// Hesap basina ayri oturum; coklu hesapta tek global agent yanlis hesaba yazardi.
const sessions = new Map<string, AtpAgent>();

async function agentFor(creds: Record<string, string>): Promise<AtpAgent> {
  const identifier = creds['identifier'] ?? '';
  const service = creds['service'] || 'https://bsky.social';
  const key = `${service}|${identifier}`;

  const cached = sessions.get(key);
  if (cached) return cached;

  const a = new AtpAgent({ service });
  await a.login({ identifier, password: creds['appPassword'] ?? '' });
  sessions.set(key, a);
  return a;
}

export const bluesky: PlatformDef = {
  id: 'bluesky',
  label: 'Bluesky',
  limits: { text: 300, media: 4 },
  setupUrl: 'https://bsky.app/settings/app-passwords',
  setupHint: 'Ayarlar > App Passwords ile uygulama sifresi uret. Ana sifreni girme.',
  fields: [
    { key: 'identifier', label: 'Kullanici adi', secret: false, placeholder: 'ad.bsky.social' },
    { key: 'appPassword', label: 'App Password', secret: true, placeholder: 'xxxx-xxxx-xxxx-xxxx' },
    { key: 'service', label: 'Sunucu', secret: false, optional: true, placeholder: 'https://bsky.social' },
  ],

  async verify(creds) {
    const a = await agentFor(creds);
    return a.session?.handle ?? creds['identifier'] ?? 'bilinmiyor';
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const base = { accountId: '', platform: 'bluesky', at };
    try {
      const a = await agentFor(creds);

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
        ...base,
        ok: true,
        url: `https://bsky.app/profile/${a.session?.handle ?? creds['identifier']}/post/${rkey}`,
      };
    } catch (e) {
      return { ...base, ok: false, error: String(e) };
    }
  },
};
