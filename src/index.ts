import { cfg } from './core/config.ts';
import { log } from './core/logger.ts';
import { store } from './core/store.ts';
import { platforms } from './platforms/index.ts';
import { accounts } from './core/accounts.ts';
import { resolveChain } from './providers/llm/index.ts';
import { ttsRegistry, getTts } from './providers/tts/index.ts';
import { clipRegistry, getClipSource } from './providers/clip/index.ts';
import { bulFikir, uret, tekrarDene, agents } from './allagents/index.ts';
import { publish } from './pipeline/publish.ts';
import { review } from './tools/review.ts';

const cmd = process.argv[2] ?? 'run';

async function status(): Promise<void> {
  const posts = await store.all();
  const counts = posts.reduce<Record<string, number>>((a, p) => {
    a[p.status] = (a[p.status] ?? 0) + 1;
    return a;
  }, {});
  log.step('KUYRUK');
  console.table(counts);
  for (const p of posts.slice(-10)) {
    console.log(`${p.status.padEnd(17)} ${p.id}  ${p.topic}`);
  }
}

async function doctor(): Promise<void> {
  log.step('AYARLAR');
  console.log(`LLM zinciri  : ${cfg.llm.chain.join(' > ')}`);
  console.log(`Gorsel       : ${cfg.image.provider}`);
  console.log(`DRY_RUN      : ${cfg.safety.dryRun}`);
  console.log(`AUTO_APPROVE : ${cfg.approval.auto}`);

  log.step('DESTEKLENEN PLATFORMLAR');
  for (const p of platforms) {
    console.log(`  ${p.id.padEnd(10)} ${p.label.padEnd(18)} metin<=${p.limits.text} gorsel<=${p.limits.media}`);
  }

  log.step('BAGLI HESAPLAR');
  const list = await accounts.all();
  if (!list.length) console.log('  hic hesap yok. Panelden ekle: npm run panel');
  for (const a of list) {
    const mark = a.enabled ? '[acik]  ' : '[kapali]';
    console.log(`  ${mark} ${a.id.padEnd(16)} ${a.platform.padEnd(10)} ${a.verifiedAs ?? a.label}`);
  }

  log.step('AJANLAR');
  for (const a of agents) console.log(`  ${a.id.padEnd(14)} ${a.role}  [${a.uses.join(', ')}]`);
  console.log('  yonetmen       Sirayi kurar ve karar verir  [hepsi]');

  log.step('SAGLAYICILAR');
  const tiers = (r: Record<string, { id: string; tier: string; isConfigured(): boolean }>) =>
    Object.values(r).map((p) => `${p.isConfigured() ? '+' : '-'} ${p.id} (${p.tier})`).join('  ');
  console.log(`  ses    : ${tiers(ttsRegistry)}`);
  console.log(`  goruntu: ${tiers(clipRegistry)}`);
  try { console.log(`  etkin  : ses=${getTts().id} goruntu=${getClipSource().id}`); } catch (e) { console.log(`  etkin  : ${e}`); }

  log.step('URETICI (canli test)');
  let chain;
  try {
    chain = resolveChain();
  } catch (e) {
    console.log(`zincir kurulamadi: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  // Ayar okumak yeterli degil: her ucu gercekten cagirip yanit aliyor muyuz bak.
  for (const p of chain) {
    const t0 = Date.now();
    try {
      const out = await p.complete('Sadece su kelimeyi yaz: tamam', { maxTokens: 12 });
      const ms = Date.now() - t0;
      console.log(`[calisiyor] ${p.id.padEnd(13)} ${ms}ms  "${out.trim().slice(0, 40)}"`);
    } catch (e) {
      console.log(`[cokuyor]   ${p.id.padEnd(13)} ${String(e).slice(0, 90)}`);
    }
  }
}

switch (cmd) {
  case 'ideate':
    await bulFikir();
    break;
  case 'generate':
    await uret();
    break;
  case 'publish':
    await publish();
    break;
  case 'retry':
    await tekrarDene();
    await uret();
    break;
  case 'review':
    await review();
    break;
  case 'status':
    await status();
    break;
  case 'doctor':
    await doctor();
    break;
  case 'run':
    log.step('TAM HAT');
    await bulFikir();
    await uret();
    await publish();
    await status();
    break;
  default:
    console.log('Komutlar: ideate | generate | retry | publish | run | review | status | doctor');
}
