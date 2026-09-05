import { cfg } from './core/config.ts';
import { log } from './core/logger.ts';
import { store } from './core/store.ts';
import { platforms } from './platforms/index.ts';
import { accounts } from './core/accounts.ts';
import { resolveChain } from './providers/llm/index.ts';
import { ttsRegistry, getTts } from './providers/tts/index.ts';
import { clipRegistry, getClipSource } from './providers/clip/index.ts';
import { agents, kadro, planla, calistir, gorevYolla } from './allagents/index.ts';
import { review } from './tools/review.ts';
import { kontrol, temizle, ozet } from './saglik/index.ts';

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

  log.step('EKIPLER');
  for (const e of kadro()) {
    console.log(`  ${e.id.padEnd(13)} ${e.role}`);
    console.log(`  ${''.padEnd(13)} uye: ${e.members.join(', ')}${e.lead ? `  lider: ${e.lead}` : ''}`);
    console.log(`  ${''.padEnd(13)} gorev: ${e.handles.join(', ')}`);
  }
  console.log('  lider         Durumu okur, gorevleri ekiplere dagitir');

  log.step('SIRADAKI PLAN');
  const plan = await planla();
  if (!plan.length) console.log('  yapilacak is yok');
  for (const g of plan) console.log(`  ${g.tur.padEnd(13)} x${g.adet}  <- ${g.sebep}`);

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
    await gorevYolla('fikir-bul');
    break;
  case 'write':
    await gorevYolla('icerik-yaz');
    break;
  case 'generate':
    await gorevYolla('medya-uret');
    break;
  case 'plan':
    for (const g of await planla()) console.log(`${g.tur.padEnd(13)} x${g.adet}  <- ${g.sebep}`);
    break;
  case 'publish':
    await gorevYolla('yayinla');
    break;
  case 'retry':
    await gorevYolla('tekrar-dene');
    break;
  case 'review':
    await review();
    break;
  case 'saglik': {
    const bulgular = await kontrol();
    log.step(`SAGLIK: ${ozet(bulgular).toUpperCase()}`);
    for (const b of bulgular) {
      const isaret = b.seviye === 'kritik' ? '[!!]' : b.seviye === 'uyari' ? '[! ]' : '[ok]';
      console.log(`${isaret} ${b.konu.padEnd(14)} ${b.detay}`);
      if (b.yapilacak) console.log(`     -> YAP: ${b.yapilacak}`);
    }
    break;
  }
  case 'temizle':
    await temizle();
    break;
  case 'status':
    await status();
    break;
  case 'doctor':
    await doctor();
    break;
  case 'run':
    await calistir();
    await status();
    break;
  default:
    console.log('Komutlar: plan | ideate | write | generate | retry | publish | run | review | status | doctor | saglik | temizle');
}
