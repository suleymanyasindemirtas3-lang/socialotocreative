import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { cfg } from '../core/config.ts';
import { log } from '../core/logger.ts';
import { store } from '../core/store.ts';
import { accounts, redact } from '../core/accounts.ts';
import { platforms, platform } from '../platforms/index.ts';
import { ideate } from '../pipeline/ideate.ts';
import { generate, retryFailed } from '../pipeline/generate.ts';
import { publish } from '../pipeline/publish.ts';
import type { Account, PostStatus } from '../core/types.ts';

const PORT = Number(process.env['PANEL_PORT'] ?? 8787);
// Varsayilan yalniz yerel. Uzaktan erisim bilincli bir karar olmali (tunel + token).
const HOST = process.env['PANEL_HOST'] ?? '127.0.0.1';

/** Token yoksa uret; panel hicbir zaman korumasiz acilmaz. */
const TOKEN = process.env['PANEL_TOKEN'] || randomBytes(16).toString('hex');

function tokenOk(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: IncomingMessage): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  const q = url.searchParams.get('token');
  if (q && tokenOk(q)) return true;
  const header = req.headers['x-panel-token'];
  if (typeof header === 'string' && tokenOk(header)) return true;
  const cookie = /panel_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
  return Boolean(cookie && tokenOk(cookie));
}

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error('govde cok buyuk');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
}

/** Ayni anda iki tur calismasin; kuyruk tek JSON dosyasi. */
let busy = false;
async function runStage(stage: string): Promise<string> {
  if (busy) return 'zaten calisiyor';
  busy = true;
  try {
    if (stage === 'ideate') return `${(await ideate()).length} fikir`;
    if (stage === 'generate') return `${(await generate()).length} uretildi`;
    if (stage === 'publish') return `${(await publish()).length} islendi`;
    if (stage === 'retry') return `${await retryFailed()} kuyruga alindi`;
    if (stage === 'run') {
      await ideate();
      await generate();
      const p = await publish();
      return `tam tur bitti, ${p.length} yayin islendi`;
    }
    return 'bilinmeyen adim';
  } finally {
    busy = false;
  }
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? 'GET';

  if (path === '/api/state' && method === 'GET') {
    const posts = (await store.all()).slice().reverse();
    return send(res, 200, {
      posts,
      accounts: (await accounts.all()).map(redact),
      platforms: platforms.map((p) => ({
        id: p.id,
        label: p.label,
        limits: p.limits,
        fields: p.fields,
        setupUrl: p.setupUrl,
        setupHint: p.setupHint,
      })),
      config: {
        dryRun: cfg.safety.dryRun,
        autoApprove: cfg.approval.auto,
        llm: cfg.llm.chain.join(' > '),
        image: cfg.image.provider,
        busy,
      },
    });
  }

  if (path === '/api/decide' && method === 'POST') {
    const { id, decision } = await readJson<{ id: string; decision: PostStatus }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    if (!['approved', 'rejected', 'draft'].includes(decision)) {
      return send(res, 400, { error: 'gecersiz karar' });
    }
    post.status = decision;
    await store.upsert(post);
    return send(res, 200, { ok: true, status: post.status });
  }

  if (path === '/api/post/targets' && method === 'POST') {
    const { id, targets } = await readJson<{ id: string; targets: string[] }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    post.targets = targets;
    await store.upsert(post);
    return send(res, 200, { ok: true });
  }

  if (path === '/api/post/text' && method === 'POST') {
    const { id, platform: pid, text } = await readJson<{ id: string; platform: string; text: string }>(req);
    const post = await store.get(id);
    if (!post) return send(res, 404, { error: 'post yok' });
    const limit = platform(pid)?.limits.text ?? 500;
    post.variants[pid] = text.slice(0, limit);
    await store.upsert(post);
    return send(res, 200, { ok: true, text: post.variants[pid] });
  }

  if (path === '/api/post/delete' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    await store.remove(id);
    return send(res, 200, { ok: true });
  }

  // ------------------------------------------------------------- hesaplar

  if (path === '/api/account/save' && method === 'POST') {
    const body = await readJson<Partial<Account> & { credentials: Record<string, string> }>(req);
    const def = platform(body.platform ?? '');
    if (!def) return send(res, 400, { error: 'bilinmeyen platform' });

    const id = (body.id || `${def.id}-${randomBytes(3).toString('hex')}`).replace(/[^a-z0-9-]/gi, '');
    const existing = await accounts.get(id);

    // Maskeli deger geri gonderilirse eski gercek degeri koru.
    const creds: Record<string, string> = { ...(existing?.credentials ?? {}) };
    for (const f of def.fields) {
      const v = body.credentials?.[f.key];
      if (typeof v === 'string' && !v.startsWith('••••')) creds[f.key] = v.trim();
    }

    const missing = def.fields.filter((f) => !f.optional && !creds[f.key]).map((f) => f.label);
    if (missing.length) return send(res, 400, { error: `eksik alan: ${missing.join(', ')}` });

    const account: Account = {
      id,
      platform: def.id,
      label: body.label?.trim() || def.label,
      enabled: body.enabled ?? true,
      credentials: creds,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      verifiedAs: existing?.verifiedAs,
    };

    // Kaydetmeden once dogrula: yanlis kimlikle hesap eklemek sessiz hataya yol acar.
    try {
      account.verifiedAs = await def.verify(creds);
    } catch (e) {
      return send(res, 400, { error: `dogrulama basarisiz: ${String(e).slice(0, 200)}` });
    }

    await accounts.upsert(account);
    return send(res, 200, { ok: true, account: redact(account) });
  }

  if (path === '/api/account/toggle' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const a = await accounts.get(id);
    if (!a) return send(res, 404, { error: 'hesap yok' });
    a.enabled = !a.enabled;
    await accounts.upsert(a);
    return send(res, 200, { ok: true, enabled: a.enabled });
  }

  if (path === '/api/account/verify' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    const a = await accounts.get(id);
    if (!a) return send(res, 404, { error: 'hesap yok' });
    const def = platform(a.platform);
    if (!def) return send(res, 400, { error: 'platform yok' });
    try {
      a.verifiedAs = await def.verify(a.credentials);
      await accounts.upsert(a);
      return send(res, 200, { ok: true, verifiedAs: a.verifiedAs });
    } catch (e) {
      return send(res, 400, { error: String(e).slice(0, 300) });
    }
  }

  if (path === '/api/account/delete' && method === 'POST') {
    const { id } = await readJson<{ id: string }>(req);
    await accounts.remove(id);
    return send(res, 200, { ok: true });
  }

  if (path === '/api/run' && method === 'POST') {
    const { stage } = await readJson<{ stage: string }>(req);
    try {
      return send(res, 200, { ok: true, message: await runStage(stage) });
    } catch (e) {
      return send(res, 500, { error: String(e).slice(0, 400) });
    }
  }

  send(res, 404, { error: 'yok' });
}

async function serveMedia(res: ServerResponse, path: string): Promise<void> {
  // Yol kacisi: data/media disina cikilmasin.
  const root = resolve('data/media');
  const file = resolve(root, decodeURIComponent(path.slice('/media/'.length)));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: 'yasak' });
  try {
    const buf = await readFile(file);
    const type = extname(file) === '.png' ? 'image/png' : 'image/jpeg';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    send(res, 404, { error: 'gorsel yok' });
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;

    if (!authorized(req)) {
      return send(res, 401, '<h1>401</h1><p>Panel adresine ?token=... ekleyin.</p>', 'text/html');
    }

    try {
      if (path === '/' || path === '/index.html') {
        const html = await readFile('src/panel/index.html', 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': `panel_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
          'cache-control': 'no-store',
        });
        return res.end(html);
      }
      if (path.startsWith('/media/')) return await serveMedia(res, path);
      if (path.startsWith('/api/')) return await api(req, res, path);
      send(res, 404, { error: 'yok' });
    } catch (e) {
      log.err(`panel ${path}: ${e}`);
      send(res, 500, { error: String(e).slice(0, 300) });
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.log();
  log.ok('Panel acildi:');
  console.log(`\n    http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/?token=${TOKEN}\n`);
  if (!process.env['PANEL_TOKEN']) {
    log.warn('PANEL_TOKEN .env icinde yok; her acilista yeni token uretiliyor.');
    log.warn(`Sabitlemek icin .env dosyasina ekle:  PANEL_TOKEN=${TOKEN}`);
  }
  if (HOST !== '127.0.0.1') log.warn(`Panel disa acik (${HOST}). Token olmadan kimse giremez ama tunel kullan.`);
});
