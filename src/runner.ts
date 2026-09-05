import { cfg } from './core/config.ts';
import { log } from './core/logger.ts';
import { ideate } from './pipeline/ideate.ts';
import { generate } from './pipeline/generate.ts';
import { requestApproval, collectApprovals } from './pipeline/approve.ts';
import { publish } from './pipeline/publish.ts';

/**
 * GitHub Actions'a gecene kadar yerel surekli calisan mod.
 * Ayni adimlar, sadece zamanlayici farkli. Mantik tek yerde durur.
 */

const MIN = 60_000;
const GENERATE_EVERY = Number(process.env['GENERATE_EVERY_MIN'] ?? 360) * MIN;
const PUBLISH_EVERY = Number(process.env['PUBLISH_EVERY_MIN'] ?? 20) * MIN;

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.warn('kapatiliyor, mevcut tur bitince cikilacak');
    stopping = true;
  });
}

async function guard(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // Bir tur cokerse dongu olmez; sonraki tur tekrar dener (Motto 5).
    log.err(`${name} turu basarisiz: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function generateCycle(): Promise<void> {
  if (stopping) return;
  log.step('URETIM TURU');
  await guard('ideate', () => ideate());
  await guard('generate', () => generate());
  await guard('approve', () => requestApproval());
}

async function publishCycle(): Promise<void> {
  if (stopping) return;
  log.step('YAYIN TURU');
  await guard('collect', () => collectApprovals());
  await guard('publish', () => publish());
}

log.step('RUNNER BASLADI');
log.info(`uretim her ${GENERATE_EVERY / MIN} dk, yayin her ${PUBLISH_EVERY / MIN} dk`);
log.info(`hedefler: ${cfg.targets.join(', ')} | DRY_RUN=${cfg.safety.dryRun} | AUTO_APPROVE=${cfg.approval.auto}`);

await generateCycle();
await publishCycle();

setInterval(() => void generateCycle(), GENERATE_EVERY);
setInterval(() => void publishCycle(), PUBLISH_EVERY);
