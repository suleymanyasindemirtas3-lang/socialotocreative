import { readFile, stat } from 'node:fs/promises';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

/**
 * OAuth 2.0 refresh token akisi. X'in aksine Google statik access token vermiyor,
 * bu yuzden her calistirmada refresh token'dan kisa omurlu token uretiliyor.
 * Token bellekte tutuluyor; kalici saklamak kimlik dosyasini gereksiz sisirirdi.
 */
const tokenCache = new Map<string, { token: string; expires: number }>();

async function accessToken(creds: Record<string, string>): Promise<string> {
  const key = creds['refreshToken'] ?? '';
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds['clientId'] ?? '',
      client_secret: creds['clientSecret'] ?? '',
      refresh_token: key,
      grant_type: 'refresh_token',
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`google token: ${j.error_description ?? res.status}`);

  tokenCache.set(key, { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export const youtube: PlatformDef = {
  id: 'youtube',
  label: 'YouTube (Shorts)',
  limits: { text: 5000, media: 1 },
  needs: 'video',
  setupUrl: 'https://console.cloud.google.com/apis/credentials',
  setupHint:
    'YouTube Data API v3 ac, OAuth client (Desktop) olustur, ' +
    'youtube.upload kapsamiyla refresh token uret. ' +
    'Kota: gunde 10.000 birim, her yukleme 1600 birim -> gunde ~6 video.',
  fields: [
    { key: 'clientId', label: 'OAuth Client ID', secret: false },
    { key: 'clientSecret', label: 'OAuth Client Secret', secret: true },
    { key: 'refreshToken', label: 'Refresh Token', secret: true },
  ],

  async verify(creds) {
    const token = await accessToken(creds);
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`youtube ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { items?: { snippet: { title: string } }[] };
    const title = j.items?.[0]?.snippet.title;
    if (!title) throw new Error('bu hesaba bagli YouTube kanali yok');
    return title;
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const head = { accountId: '', platform: 'youtube', at };
    try {
      const video = post.media.find((m) => m.kind === 'video');
      if (!video) throw new Error('YouTube video ister; once video uretilmeli');

      const token = await accessToken(creds);
      const size = (await stat(video.path)).size;

      // Basligi ilk satirdan al; kalani aciklama olur.
      const [firstLine = '', ...rest] = text.split('\n');
      const meta = {
        snippet: {
          title: (firstLine || post.topic).slice(0, 100),
          description: rest.join('\n').slice(0, 5000),
          categoryId: '28',
        },
        status: { privacyStatus: process.env['YOUTUBE_PRIVACY'] ?? 'private', selfDeclaredMadeForKids: false },
      };

      // Resumable upload: once oturum ac, sonra baytlari gonder.
      const init = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-upload-content-length': String(size),
            'x-upload-content-type': 'video/mp4',
          },
          body: JSON.stringify(meta),
        },
      );
      if (!init.ok) throw new Error(`init ${init.status}: ${(await init.text()).slice(0, 300)}`);

      const location = init.headers.get('location');
      if (!location) throw new Error('resumable oturum URL donmedi');

      const up = await fetch(location, {
        method: 'PUT',
        headers: { 'content-type': 'video/mp4', 'content-length': String(size) },
        body: await readFile(video.path),
      });
      if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 300)}`);

      const j = (await up.json()) as { id: string };
      return { ...head, ok: true, url: `https://youtube.com/shorts/${j.id}` };
    } catch (e) {
      return { ...head, ok: false, error: String(e) };
    }
  },
};
