import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { cfg } from '../core/config.ts';
import type { PlatformAdapter, Post, PublishResult } from '../core/types.ts';

const api = (m: string) => `https://api.telegram.org/bot${cfg.telegram.token}/${m}`;

/** Hem yayin adaptoru hem onay kanali ayni ince istemciyi kullanir. */
export const tg = {
  configured: () => Boolean(cfg.telegram.token && cfg.telegram.chatId),

  async call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    return j.result;
  },

  async sendPhoto(chatId: string, path: string, caption: string, replyMarkup?: unknown) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', caption.slice(0, 1024));
    form.set('photo', new Blob([await readFile(path)]), basename(path));
    if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
    const res = await fetch(api('sendPhoto'), { method: 'POST', body: form });
    const j = (await res.json()) as { ok: boolean; result: { message_id: number }; description?: string };
    if (!j.ok) throw new Error(`telegram sendPhoto: ${j.description}`);
    return j.result;
  },
};

export const telegramAdapter: PlatformAdapter = {
  id: 'telegram',
  limits: { text: 4096, media: 1 },
  isConfigured: () => tg.configured(),

  async publish(post: Post, text: string): Promise<PublishResult> {
    const at = new Date().toISOString();
    try {
      const photo = post.media[0];
      const r = photo
        ? await tg.sendPhoto(cfg.telegram.chatId, photo.path, text)
        : await tg.call<{ message_id: number }>('sendMessage', {
            chat_id: cfg.telegram.chatId,
            text: text.slice(0, 4096),
            disable_web_page_preview: false,
          });
      return { platform: 'telegram', ok: true, url: `tg:${r.message_id}`, at };
    } catch (e) {
      return { platform: 'telegram', ok: false, error: String(e), at };
    }
  },
};
