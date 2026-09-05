import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { authHeader, credsFrom } from '../core/oauth1.ts';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

const API = 'https://api.x.com';

async function upload(path: string, mime: string, creds: Record<string, string>): Promise<string> {
  // v1.1 upload ucu kapatildi; v2 multipart kullaniliyor.
  const url = `${API}/2/media/upload`;
  const form = new FormData();
  form.set('media', new Blob([await readFile(path)], { type: mime }), basename(path));
  form.set('media_category', 'tweet_image');

  // Multipart govde imzaya girmez (RFC 5849): yalniz oauth parametreleri imzalanir.
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: authHeader('POST', url, credsFrom(creds)) },
    body: form,
  });
  if (!res.ok) throw new Error(`media ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: { id: string }; media_id_string?: string };
  const id = j.data?.id ?? j.media_id_string;
  if (!id) throw new Error('media id donmedi');
  return id;
}

export const x: PlatformDef = {
  id: 'x',
  label: 'X (Twitter)',
  limits: { text: 280, media: 4 },
  needs: 'none',
  setupUrl: 'https://developer.x.com/en/portal/dashboard',
  setupHint:
    'Portal > proje/app ac > User authentication settings: Read and write. ' +
    'Keys and tokens sekmesinden API Key/Secret ve Access Token/Secret uret. ' +
    'Yetkiyi "write" yaptiktan SONRA access token uret, yoksa token salt okunur kalir.',
  fields: [
    { key: 'consumerKey', label: 'API Key', secret: true },
    { key: 'consumerSecret', label: 'API Key Secret', secret: true },
    { key: 'accessToken', label: 'Access Token', secret: true },
    { key: 'accessSecret', label: 'Access Token Secret', secret: true },
  ],

  async verify(creds) {
    const url = `${API}/2/users/me`;
    const res = await fetch(url, { headers: { authorization: authHeader('GET', url, credsFrom(creds)) } });
    if (!res.ok) throw new Error(`x ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { data: { username: string; name: string } };
    return `@${j.data.username}`;
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const head = { accountId: '', platform: 'x', at };
    try {
      const mediaIds: string[] = [];
      for (const m of post.media.filter((m) => m.kind === 'image').slice(0, 4)) mediaIds.push(await upload(m.path, m.mime, creds));

      const url = `${API}/2/tweets`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: authHeader('POST', url, credsFrom(creds)),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: text.slice(0, 280),
          ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`x ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { data: { id: string } };
      return { ...head, ok: true, url: `https://x.com/i/status/${j.data.id}` };
    } catch (e) {
      return { ...head, ok: false, error: String(e) };
    }
  },
};
