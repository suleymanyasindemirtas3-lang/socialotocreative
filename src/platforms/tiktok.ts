import { readFile, stat } from 'node:fs/promises';
import { log } from '../core/logger.ts';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

const API = 'https://open.tiktokapis.com/v2';
const tokenCache = new Map<string, { token: string; expires: number }>();

async function accessToken(creds: Record<string, string>): Promise<string> {
  const key = creds['refreshToken'] ?? '';
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;

  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: creds['clientKey'] ?? '',
      client_secret: creds['clientSecret'] ?? '',
      grant_type: 'refresh_token',
      refresh_token: key,
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`tiktok token: ${j.error_description ?? res.status}`);

  tokenCache.set(key, { token: j.access_token, expires: Date.now() + (j.expires_in ?? 7200) * 1000 });
  return j.access_token;
}

export const tiktok: PlatformDef = {
  id: 'tiktok',
  label: 'TikTok',
  limits: { text: 2200, media: 1 },
  needs: 'video',
  setupUrl: 'https://developers.tiktok.com/apps',
  setupHint:
    'Content Posting API basvurusu gerekir. App AUDIT EDILMEDEN video.publish ' +
    'kapsami acilmaz; onaysiz app SELF_ONLY (gizli) paylasir. ' +
    'video.upload + video.publish kapsamlariyla refresh token uret.',
  fields: [
    { key: 'clientKey', label: 'Client Key', secret: false },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
    { key: 'refreshToken', label: 'Refresh Token', secret: true },
  ],

  async verify(creds) {
    const token = await accessToken(creds);
    const res = await fetch(`${API}/user/info/?fields=display_name`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`tiktok ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { data?: { user?: { display_name: string } } };
    return j.data?.user?.display_name ?? 'TikTok hesabi';
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const head = { accountId: '', platform: 'tiktok', at };
    try {
      const video = post.media.find((m) => m.kind === 'video');
      if (!video) throw new Error('TikTok video ister; once video uretilmeli');

      const token = await accessToken(creds);
      const size = (await stat(video.path)).size;

      // Audit edilmemis app'te bu SELF_ONLY'ye zorlanir; API hata vermez, gizli paylasir.
      const privacy = process.env['TIKTOK_PRIVACY'] ?? 'SELF_ONLY';

      const init = await fetch(`${API}/post/publish/video/init/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          post_info: { title: text.slice(0, 2200), privacy_level: privacy },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: size,
            chunk_size: size,
            total_chunk_count: 1,
          },
        }),
      });
      const ij = (await init.json()) as {
        data?: { publish_id: string; upload_url: string };
        error?: { message: string; code: string };
      };
      if (!init.ok || !ij.data) throw new Error(`init: ${ij.error?.message ?? init.status}`);

      const up = await fetch(ij.data.upload_url, {
        method: 'PUT',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(size),
          'content-range': `bytes 0-${size - 1}/${size}`,
        },
        body: await readFile(video.path),
      });
      if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);

      if (privacy === 'SELF_ONLY') {
        log.warn('TikTok SELF_ONLY: video gizli yuklendi. Herkese acik icin app audit gerekir.');
      }
      return { ...head, ok: true, url: `tiktok:${ij.data.publish_id}` };
    } catch (e) {
      return { ...head, ok: false, error: String(e) };
    }
  },
};
