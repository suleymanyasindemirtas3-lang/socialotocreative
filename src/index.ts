import { cfg } from './core/config.ts';
import { log } from './core/logger.ts';
import { store } from './core/store.ts';
import { allPlatforms, activePlatforms } from './platforms/index.ts';
import { getLlm } from './providers/llm/index.ts';
import { ideate } from './pipeline/ideate.ts';
import { generate } from './pipeline/generate.ts';
import { requestApproval, collectApprovals } from './pipeline/approve.ts';
import { publish } from './pipeline/publish.ts';

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

function doctor(): void {
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

  log.step('URETICI');
  try {
    console.log(`${getLlm().id} hazir.`);
  } catch (e) {
    console.log(`sorun: ${e instanceof Error ? e.message : String(e)}`);
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
  case 'status':
    await status();
    break;
  case 'doctor':
    doctor();
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
    console.log('Komutlar: ideate | generate | approve | publish | run | status | doctor');
}
