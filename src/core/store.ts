import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Post, PostStatus, Store } from './types.ts';

/**
 * MOTTO 3: Sifir altyapi. Kuyruk git'te duran tek bir JSON dosyasi.
 * Buyudugunde SupabaseStore yazilir, Store arayuzu degismez.
 */
export class JsonStore implements Store {
  // Not: Node "strip-only" TS calistirir; parametre ozelligi (private x) desteklenmez.
  readonly file: string;

  constructor(file = 'data/queue.json') {
    this.file = file;
  }

  private async read(): Promise<Post[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Post[];
    } catch {
      return [];
    }
  }

  private async write(posts: Post[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(posts, null, 2) + '\n', 'utf8');
  }

  all() { return this.read(); }

  async byStatus(...s: PostStatus[]) {
    return (await this.read()).filter((p) => s.includes(p.status));
  }

  async get(id: string) {
    return (await this.read()).find((p) => p.id === id);
  }

  async upsert(p: Post) {
    const posts = await this.read();
    const i = posts.findIndex((x) => x.id === p.id);
    if (i >= 0) posts[i] = p;
    else posts.push(p);
    await this.write(posts);
  }

  async fingerprints() {
    return new Set((await this.read()).map((p) => p.fingerprint));
  }
}

export const store: Store = new JsonStore();
