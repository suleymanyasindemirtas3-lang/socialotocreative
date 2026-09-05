import { randomUUID } from 'node:crypto';
import { log } from '../../core/logger.ts';
import { store } from '../../core/store.ts';
import { accounts, enabledAccounts } from '../../core/accounts.ts';
import { fingerprint } from '../../core/fingerprint.ts';
import { platform } from '../../platforms/index.ts';
import { icerikBulma } from '../icerik-bulma.ts';
import { senaryo } from '../senaryo.ts';
import type { Ekip, Gorev, GorevSonucu } from '../types.ts';
import type { Post } from '../../core/types.ts';

/**
 * ICERIK EKIBI
 *
 * "Ne anlatilacak" ve "nasil yazilacak" sorularindan sorumlu.
 * Medyaya hic dokunmaz; ciktisi metindir.
 *
 * Ekip sinirinin buradan gecmesinin sebebi: metin ucuz ve hizli, medya
 * pahali ve yavas. Ikisini ayirmak, metin cope giderse bosuna ses/video
 * uretilmemesini saglar.
 */

async function fikirBul(adet: number): Promise<Post[]> {
  const targets = (await enabledAccounts()).map((a) => a.id);
  const fikirler = await icerikBulma.run({
    count: adet,
    recent: (await store.all()).slice(-40).map((p) => p.topic),
    seen: await store.fingerprints(),
  });

  const out: Post[] = [];
  for (const f of fikirler) {
    const post: Post = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      topic: f.topic,
      angle: f.angle,
      status: 'draft',
      variants: {},
      media: [],
      targets,
      results: [],
      fingerprint: fingerprint(f.topic),
    };
    await store.upsert(post);
    out.push(post);
    log.ok(`fikir ${post.id}: ${post.topic}`);
  }
  return out;
}

async function yaz(adet: number): Promise<number> {
  const drafts = (await store.byStatus('draft')).slice(0, adet);
  let ok = 0;

  for (const post of drafts) {
    try {
      // Hedef hesaplardan platform kumesi: ayni platformdaki iki hesap ayni
      // metni paylasir, metin hesap basina degil platform basina uretilir.
      const platformIds = new Set<string>();
      for (const accId of post.targets) {
        const acc = await accounts.get(accId);
        if (acc) platformIds.add(acc.platform);
      }
      if (!platformIds.size) throw new Error('acik hedef hesap yok');

      const wantsVideo = [...platformIds].some((id) => platform(id)?.needs === 'video');

      const script = await senaryo.run({
        fikir: { topic: post.topic, angle: post.angle },
        platforms: [...platformIds].map((id) => ({ id, limit: platform(id)?.limits.text ?? 500 })),
        narrationNeeded: wantsVideo,
      });

      post.variants = script.variants;
      post.script = {
        visualPrompt: script.visualPrompt,
        ...(script.narration ? { narration: script.narration } : {}),
      };
      post.status = 'scripted';
      await store.upsert(post);
      ok++;
      log.ok(`yazildi ${post.id}`);
    } catch (e) {
      post.status = 'failed';
      post.results.push({
        accountId: '',
        platform: 'icerik',
        ok: false,
        error: String(e),
        at: new Date().toISOString(),
      });
      await store.upsert(post);
      log.err(`yazim hatasi ${post.id}: ${e}`);
    }
  }
  return ok;
}

export const icerikEkibi: Ekip = {
  id: 'icerik',
  role: 'Ne anlatilacagina karar verir ve metinleri yazar',
  members: ['icerik-bulma', 'senaryo'],
  handles: ['fikir-bul', 'icerik-yaz'],

  async run(gorev: Gorev): Promise<GorevSonucu> {
    const head = { gorev, ekip: 'icerik' };
    try {
      if (gorev.tur === 'fikir-bul') {
        const n = (await fikirBul(gorev.adet)).length;
        return { ...head, ok: true, ozet: `${n} fikir bulundu` };
      }
      const n = await yaz(gorev.adet);
      return { ...head, ok: true, ozet: `${n} metin yazildi` };
    } catch (e) {
      return { ...head, ok: false, ozet: 'basarisiz', error: String(e) };
    }
  },
};
