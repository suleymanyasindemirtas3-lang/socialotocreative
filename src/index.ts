import { cfg } from './core/config.ts';
import { log } from './core/logger.ts';
import { store } from './core/store.ts';
import { allPlatforms, activePlatforms } from './platforms/index.ts';
import { resolveChain } from './providers/llm/index.ts';
import { ideate } from './pipeline/ideate.ts';
import { generate, retryFailed } from './pipeline/generate.ts';
import { requestApproval, collectApprovals } from './pipeline/approve.ts';
import { publish } from './pipeline/publish.ts';
import { telegramSetup } from './tools/telegram-setup.ts';

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
  console.log(`Hedefler     : ${cfg.targets.join(', ')}`);
  console.log(`DRY_RUN      : ${cfg.safety.dryRun}`);
  console.log(`AUTO_APPROVE : ${cfg.approval.auto}`);

  log.step('PLATFORMLAR');
  for (const p of allPlatforms) {
    const mark = p.isConfigured() ? '[hazir]' : '[eksik]';
    console.log(`${mark} ${p.id.padEnd(10)} metin<=${p.limits.text} gorsel<=${p.limits.media}`);
  }
  const active = activePlatforms().map((p) => p.id);
  console.log(`\nEtkin hedef: ${active.length ? active.join(', ') : 'YOK'}`);

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
    await ideate();
    break;
  case 'generate':
    await generate();
    break;
  case 'approve':
    await collectApprovals();
    await requestApproval();
    break;
  case 'publish':
    await collectApprovals();
    await publish();
    break;
  case 'retry':
    await retryFailed();
    await generate();
    break;
  case 'tgsetup':
    await telegramSetup();
    break;
  case 'status':
    await status();
    break;
  case 'doctor':
    await doctor();
    break;
  case 'run':
    log.step('TAM HAT');
    await ideate();
    await generate();
    await collectApprovals();
    await requestApproval();
    await publish();
    await status();
    break;
  default:
    console.log('Komutlar: ideate | generate | retry | approve | publish | run | status | doctor | tgsetup');
}
