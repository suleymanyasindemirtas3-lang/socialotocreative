import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

const base = (creds: Record<string, string>) => (creds['instance'] ?? '').replace(/\/+$/, '');
const auth = (creds: Record<string, string>) => ({ authorization: `Bearer ${creds['accessToken'] ?? ''}` });

export const mastodon: PlatformDef = {
  id: 'mastodon',
  label: 'Mastodon',
  limits: { text: 500, media: 4 },
  setupUrl: 'https://mastodon.social/settings/applications',
  setupHint: 'Ayarlar > Development > New application. Yetki: write:statuses, write:media.',
  fields: [
    { key: 'instance', label: 'Sunucu', secret: false, placeholder: 'https://mastodon.social' },
    { key: 'accessToken', label: 'Access Token', secret: true },
  ],

  async verify(creds) {
    const res = await fetch(`${base(creds)}/api/v1/accounts/verify_credentials`, { headers: auth(creds) });
    if (!res.ok) throw new Error(`mastodon ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { acct: string };
    return `@${j.acct}`;
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const head = { accountId: '', platform: 'mastodon', at };
    try {
      const mediaIds: string[] = [];
      for (const m of post.media.slice(0, 4)) {
        const form = new FormData();
        form.set('file', new Blob([await readFile(m.path)], { type: m.mime }), basename(m.path));
        form.set('description', m.alt);
        const up = await fetch(`${base(creds)}/api/v2/media`, {
          method: 'POST',
          headers: auth(creds),
          body: form,
        });
        if (!up.ok) throw new Error(`media ${up.status}: ${await up.text()}`);
        mediaIds.push(((await up.json()) as { id: string }).id);
      }

      const res = await fetch(`${base(creds)}/api/v1/statuses`, {
        method: 'POST',
        headers: { ...auth(creds), 'content-type': 'application/json' },
        body: JSON.stringify({ status: text, ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
      });
      if (!res.ok) throw new Error(`mastodon ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { url: string };
      return { ...head, ok: true, url: j.url };
    } catch (e) {
      return { ...head, ok: false, error: String(e) };
    }
  },
};
