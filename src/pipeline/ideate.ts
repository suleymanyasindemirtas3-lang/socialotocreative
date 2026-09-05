import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { fingerprint } from '../core/fingerprint.ts';
import { getLlm } from '../providers/llm/index.ts';
import type { Post } from '../core/types.ts';

export async function brandVoice(): Promise<string> {
  try {
    return await readFile('content/brand.md', 'utf8');
  } catch {
    return `Nis: ${cfg.brand.niche}. Ton: ${cfg.brand.tone}.`;
  }
}

/** Adim 1: konu havuzu uret, daha once uretilenleri ele. */
export async function ideate(count = cfg.safety.maxPerRun): Promise<Post[]> {
  const llm = getLlm();
  const seen = await store.fingerprints();
  const recent = (await store.all()).slice(-40).map((p) => p.topic);

  const prompt = [
    `Nis: ${cfg.brand.niche}. Dil: ${cfg.brand.language}.`,
    `${count * 2} adet ozgun sosyal medya post fikri uret.`,
    recent.length ? `Bunlara benzeme:\n${recent.map((t) => '- ' + t).join('\n')}` : '',
    'Yalnizca su semada JSON dizisi dondur, baska hicbir metin yazma:',
    '[{"topic":"tek cumlelik konu","angle":"bakis acisi"}]',
  ].filter(Boolean).join('\n\n');

  const raw = await llm.complete(prompt, { system: await brandVoice(), maxTokens: 1200, json: true });
  const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);

  let ideas: { topic: string; angle: string }[];
  try {
    ideas = JSON.parse(json);
  } catch {
    log.err('LLM gecerli JSON dondurmedi:\n' + raw.slice(0, 400));
    return [];
  }

  const fresh: Post[] = [];
  for (const idea of ideas) {
    if (fresh.length >= count) break;
    const fp = fingerprint(idea.topic);
    if (seen.has(fp)) { log.warn(`tekrar elendi: ${idea.topic}`); continue; }
    seen.add(fp);

    const post: Post = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      topic: idea.topic,
      angle: idea.angle ?? '',
      status: 'draft',
      variants: {},
      media: [],
      targets: cfg.targets,
      results: [],
      fingerprint: fp,
    };
    await store.upsert(post);
    fresh.push(post);
    log.ok(`fikir ${post.id}: ${post.topic}`);
  }
  return fresh;
}
