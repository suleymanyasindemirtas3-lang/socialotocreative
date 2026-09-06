import { getMediaHost } from '../providers/image/host.ts';
import { log } from '../core/logger.ts';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';

async function graph<T>(path: string, token: string, body?: Record<string, string>): Promise<T> {
  const url = `${GRAPH}${path}`;
  const res = body
    ? await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...body, access_token: token }),
      })
    : await fetch(`${url}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`);

  const j = (await res.json()) as { error?: { message: string } } & T;
  if (!res.ok || j.error) throw new Error(`instagram: ${j.error?.message ?? res.status}`);
  return j;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reels container'i hazir olana kadar beklenir; erken publish FINISHED degilse hata verir. */
async function waitReady(creationId: string, token: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const s = await graph<{ status_code: string }>(`/${creationId}?fields=status_code`, token);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR') throw new Error('medya isleme hatasi');
    await sleep(4000);
  }
  throw new Error('medya 2 dakikada hazir olmadi');
}

export const instagram: PlatformDef = {
  id: 'instagram',
  label: 'Instagram',
  limits: { text: 2200, media: 1 },
  needs: 'image',
  setupUrl: 'https://developers.facebook.com/apps',
  setupHint:
    'Instagram hesabi Business/Creator olmali ve bir Facebook Page ile bagli olmali. ' +
    'Meta app ac, instagram_content_publish + pages_read_engagement izinleri al, ' +
    'Graph API Explorer ile uzun omurlu token uret. Medya public URL gerektirir: MEDIA_HOST ayarla.',
  fields: [
    { key: 'igUserId', label: 'Instagram User ID', secret: false, placeholder: '17841400000000000' },
    { key: 'accessToken', label: 'Uzun omurlu Access Token', secret: true },
  ],

  async verify(creds) {
    const j = await graph<{ username: string }>(
      `/${creds['igUserId']}?fields=username`,
      creds['accessToken'] ?? '',
    );
    return `@${j.username}`;
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const head = { accountId: '', platform: 'instagram', at };
    try {
      const token = creds['accessToken'] ?? '';
      const igId = creds['igUserId'] ?? '';
      // Feed gonderisi gorseli tercih eder; yalniz video varsa Reels'e duser.
      const asset = post.media.find((m) => m.kind === 'image') ?? post.media[0];
      if (!asset) throw new Error('Instagram medyasiz post kabul etmiyor');

      // Graph API dosya yuklemesi almaz; medyayi kendisi cekmek zorunda.
      const mediaUrl = await getMediaHost().publicUrl(asset.path);
      const isVideo = asset.kind === 'video';
      log.info(`instagram medya kaynagi: ${mediaUrl}`);

      const container = await graph<{ id: string }>(`/${igId}/media`, token, {
        caption: text.slice(0, 2200),
        ...(isVideo
          ? { media_type: 'REELS', video_url: mediaUrl }
          : { image_url: mediaUrl }),
      });

      if (isVideo) await waitReady(container.id, token);

      const published = await graph<{ id: string }>(`/${igId}/media_publish`, token, {
        creation_id: container.id,
      });

      return { ...head, ok: true, url: `https://www.instagram.com/p/${published.id}` };
    } catch (e) {
      return { ...head, ok: false, error: String(e) };
    }
  },
};
