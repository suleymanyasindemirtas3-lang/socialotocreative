import { readFile, writeFile } from 'node:fs/promises';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { tg } from '../platforms/telegram.ts';

/**
 * chat_id'yi elle bulmak zahmetli ve hataya acik.
 * Token .env'e girildikten sonra bu komut kalanini kendisi halleder.
 * Not: token gizlidir ve yalnizca .env'de durur; buraya yazilmaz.
 */

interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string; title?: string; username?: string } };
  channel_post?: { chat: { id: number; type: string; title?: string; username?: string } };
}

export async function telegramSetup(): Promise<void> {
  if (!cfg.telegram.token) {
    log.err('TELEGRAM_BOT_TOKEN bos. Once .env dosyasina token satirini yaz.');
    return;
  }

  const me = await tg.call<{ username: string; first_name: string }>('getMe', {});
  log.ok(`bot bulundu: @${me.username} (${me.first_name})`);

  const updates = await tg.call<Update[]>('getUpdates', { timeout: 0 });
  const chats = new Map<number, string>();
  for (const u of updates) {
    const chat = u.message?.chat ?? u.channel_post?.chat;
    if (chat) chats.set(chat.id, `${chat.type} ${chat.title ?? chat.username ?? ''}`.trim());
  }

  if (!chats.size) {
    log.warn('Hicbir sohbet gorunmuyor.');
    console.log(`\n  1. Telegram'da @${me.username} botunu ac`);
    console.log('  2. /start yaz (ya da bota bir mesaj gonder)');
    console.log('  3. Bu komutu tekrar calistir\n');
    return;
  }

  console.log('\nBulunan sohbetler:');
  for (const [id, label] of chats) console.log(`  ${id}  ${label}`);

  const first = [...chats.keys()][0]!;
  // chat_id gizli bir deger degil; otomatik yazmak bir adim tasarruf ettirir.
  const envText = await readFile('.env', 'utf8');
  const next = envText.includes('TELEGRAM_CHAT_ID=')
    ? envText.replace(/TELEGRAM_CHAT_ID=.*/, `TELEGRAM_CHAT_ID=${first}`)
    : envText + `\nTELEGRAM_CHAT_ID=${first}\n`;
  await writeFile('.env', next, 'utf8');
  log.ok(`.env guncellendi: TELEGRAM_CHAT_ID=${first}`);

  if (chats.size > 1) log.warn('Birden fazla sohbet var; yanlissa .env icinden elle degistir.');
}
