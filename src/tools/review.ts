import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';

/**
 * Terminalden onay. Panelin komut satiri esdegeri, hicbir dis servis istemez.
 * Ikisi de ayni kuyrugu ve ayni durumlari kullanir, mantik bolunmez.
 */
export async function review(): Promise<void> {
  const pending = await store.byStatus('pending_approval');
  if (!pending.length) {
    log.warn('onay bekleyen taslak yok');
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let approved = 0;
  let rejected = 0;

  try {
    for (const [i, post] of pending.entries()) {
      console.log(`\n${'='.repeat(64)}`);
      console.log(`${i + 1}/${pending.length}  ${post.id}   ${post.topic}`);
      if (post.angle) console.log(`aci: ${post.angle}`);
      for (const [id, text] of Object.entries(post.variants)) {
        console.log(`\n--- ${id} (${text.length} karakter) ---\n${text}`);
      }
      for (const m of post.media) console.log(`\n[gorsel] ${m.path}`);
      console.log('='.repeat(64));

      const ans = (await rl.question('[o]nayla  [r]eddet  [a]tla  [c]ik > ')).trim().toLowerCase();

      if (ans === 'c' || ans === 'q') break;
      if (ans === 'a') continue;

      post.status = ans === 'o' || ans === 'y' ? 'approved' : 'rejected';
      await store.upsert(post);
      if (post.status === 'approved') approved++;
      else rejected++;
    }
  } finally {
    rl.close();
  }

  log.ok(`${approved} onaylandi, ${rejected} reddedildi`);
}
