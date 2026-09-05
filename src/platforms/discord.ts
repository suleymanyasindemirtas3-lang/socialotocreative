import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

/** Webhook: uygulama onayi yok, OAuth yok. En dusuk surtunmeli hedef. */
export const discord: PlatformDef = {
  id: 'discord',
  label: 'Discord (webhook)',
  limits: { text: 2000, media: 10 },
  needs: 'none',
  setupUrl: 'https://support.discord.com/hc/en-us/articles/228383668',
  setupHint: 'Kanal ayarlari > Integrations > Webhooks > New Webhook > Copy URL.',
  fields: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      secret: true,
      placeholder: 'https://discord.com/api/webhooks/...',
    },
  ],

  async verify(creds) {
    const res = await fetch(creds['webhookUrl'] ?? '');
    if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { name: string; channel_id: string };
    return `${j.name} (kanal ${j.channel_id})`;
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const head = { accountId: '', platform: 'discord', at };
    try {
      const url = `${creds['webhookUrl']}?wait=true`;
      const form = new FormData();
      form.set('payload_json', JSON.stringify({ content: text.slice(0, 2000) }));
      for (const [i, m] of post.media.filter((m) => m.kind === 'image').slice(0, 10).entries()) {
        form.set(`files[${i}]`, new Blob([await readFile(m.path)], { type: m.mime }), basename(m.path));
      }
      const res = await fetch(url, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { id: string; channel_id: string };
      return { ...head, ok: true, url: `discord:${j.channel_id}:${j.id}` };
    } catch (e) {
      return { ...head, ok: false, error: String(e) };
    }
  },
};
