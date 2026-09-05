import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { tg } from '../platforms/telegram.ts';
import type { Post } from '../core/types.ts';

const STATE = 'data/state.json';

interface State { tgOffset: number }

async function readState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE, 'utf8')) as State;
  } catch {
    return { tgOffset: 0 };
  }
}

async function saveState(s: State): Promise<void> {
  await mkdir('data', { recursive: true });
  await writeFile(STATE, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

function preview(post: Post): string {
  const body = Object.entries(post.variants)
    .map(([id, t]) => `--- ${id} ---\n${t}`)
    .join('\n\n');
  return `TASLAK ${post.id}\nKonu: ${post.topic}\n\n${body}`;
}

/** Adim 3a: onay bekleyenleri butonlarla Telegram'a yolla. */
export async function requestApproval(): Promise<number> {
  if (cfg.approval.auto) {
    log.info('AUTO_APPROVE acik, onay kapisi atlaniyor');
    return 0;
  }
  if (!tg.configured()) {
    log.warn('Telegram yapilandirilmamis, onay istegi gonderilemiyor');
    return 0;
  }

  const pending = (await store.byStatus('pending_approval')).filter((p) => !p.approvalRef);
  for (const post of pending) {
    const markup = {
      inline_keyboard: [[
        { text: 'Onayla', callback_data: `ok:${post.id}` },
        { text: 'Reddet', callback_data: `no:${post.id}` },
      ]],
    };
    const photo = post.media[0];
    const r = photo
      ? await tg.sendPhoto(cfg.telegram.chatId, photo.path, preview(post), markup)
      : await tg.call<{ message_id: number }>('sendMessage', {
          chat_id: cfg.telegram.chatId,
          text: preview(post).slice(0, 4096),
          reply_markup: markup,
        });
    post.approvalRef = String(r.message_id);
    await store.upsert(post);
    log.ok(`onay istegi gonderildi ${post.id}`);
  }
  return pending.length;
}

interface CallbackUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data: string;
    message?: { message_id: number };
  };
}

/** Adim 3b: gelen buton tiklamalarini isle. Cron her calistiginda cagrilir. */
export async function collectApprovals(): Promise<number> {
  if (!tg.configured()) return 0;
  const s = await readState();

  const updates = await tg.call<CallbackUpdate[]>('getUpdates', {
    offset: s.tgOffset,
    timeout: 0,
    allowed_updates: ['callback_query'],
  });

  let applied = 0;
  for (const u of updates) {
    s.tgOffset = u.update_id + 1;
    const cb = u.callback_query;
    if (!cb) continue;

    const [action, id] = cb.data.split(':');
    const post = id ? await store.get(id) : undefined;
    let note = 'bulunamadi';

    if (post && post.status === 'pending_approval') {
      post.status = action === 'ok' ? 'approved' : 'rejected';
      await store.upsert(post);
      note = post.status === 'approved' ? 'Onaylandi' : 'Reddedildi';
      applied++;
      log.ok(`${post.id} -> ${post.status}`);
    } else if (post) {
      note = `zaten ${post.status}`;
    }

    await tg.call('answerCallbackQuery', { callback_query_id: cb.id, text: note });
    if (cb.message) {
      await tg
        .call('editMessageReplyMarkup', {
          chat_id: cfg.telegram.chatId,
          message_id: cb.message.message_id,
          reply_markup: { inline_keyboard: [[{ text: note, callback_data: 'noop' }]] },
        })
        .catch(() => {});
    }
  }

  await saveState(s);
  return applied;
}
