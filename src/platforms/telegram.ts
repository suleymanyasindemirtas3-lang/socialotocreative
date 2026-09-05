import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

/**
 * Ince istemci. Token parametre; boylece ayni kod hem coklu yayin hesabi
 * hem de tek operator onay kanali icin kullanilir.
 */
export function tgClient(token: string) {
  const api = (m: string) => `https://api.telegram.org/bot${token}/${m}`;

  return {
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
      const j = (await res.json()) as {
        ok: boolean;
        result: { message_id: number };
        description?: string;
      };
      if (!j.ok) throw new Error(`telegram sendPhoto: ${j.description}`);
      return j.result;
    },
  };
}

export const telegram: PlatformDef = {
  id: 'telegram',
  label: 'Telegram',
  limits: { text: 4096, media: 1 },
  setupUrl: 'https://t.me/BotFather',
  setupHint: 'BotFather ile /newbot yaz, token al. Sonra botu kanala ekleyip chat id gir.',
  fields: [
    { key: 'botToken', label: 'Bot Token', secret: true, placeholder: '8123456789:AAE...' },
    { key: 'chatId', label: 'Chat / Kanal ID', secret: false, placeholder: '-1001234567890' },
  ],

  async verify(creds) {
    const me = await tgClient(creds['botToken'] ?? '').call<{ username: string }>('getMe', {});
    return `@${me.username}`;
  },

  async publish(post: Post, text: string, creds): Promise<PublishResult> {
    const at = new Date().toISOString();
    const base = { accountId: '', platform: 'telegram', at };
    try {
      const client = tgClient(creds['botToken'] ?? '');
      const chatId = creds['chatId'] ?? '';
      const photo = post.media[0];
      const r = photo
        ? await client.sendPhoto(chatId, photo.path, text)
        : await client.call<{ message_id: number }>('sendMessage', {
            chat_id: chatId,
            text: text.slice(0, 4096),
          });
      return { ...base, ok: true, url: `tg:${chatId}:${r.message_id}` };
    } catch (e) {
      return { ...base, ok: false, error: String(e) };
    }
  },
};
