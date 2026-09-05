import { log } from '../core/logger.ts';
import type { PlatformDef, Post, PublishResult } from '../core/types.ts';

/** Kimlik gerektirmez. Hattin tamamini gercek hesap acmadan test etmeye yarar. */
export const consolePlatform: PlatformDef = {
  id: 'console',
  label: 'Konsol (test)',
  limits: { text: 5000, media: 10 },
  needs: 'none',
  setupHint: 'Kimlik istemez. Yayin yerine terminale yazar.',
  fields: [],

  async verify() {
    return 'yerel konsol';
  },

  async publish(post: Post, text: string): Promise<PublishResult> {
    log.ok(`console <- ${post.id}`);
    console.log('---\n' + text + '\n' + post.media.map((m) => `[gorsel] ${m.path}`).join('\n') + '\n---');
    return { accountId: '', platform: 'console', ok: true, url: `console:${post.id}`, at: new Date().toISOString() };
  },
};
