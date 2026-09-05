import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cfg } from '../../core/config.ts';
import { log } from '../../core/logger.ts';
import type { TtsProvider } from '../../core/types.ts';

const run = promisify(execFile);

const ensureDir = async (p: string) => mkdir(dirname(p), { recursive: true });

/** Microsoft Edge'in TTS ucu. Anahtar istemez, Turkce sesleri var. */
const edge: TtsProvider = {
  id: 'edge',
  tier: 'free',
  isConfigured: () => true,
  async speak(text, outPath, voice) {
    await ensureDir(outPath);
    await run(
      'python',
      [
        '-m', 'edge_tts',
        '--voice', voice || cfg.tts.voice,
        '--rate', cfg.tts.rate,
        '--text', text,
        '--write-media', outPath,
      ],
      { maxBuffer: 1 << 24 },
    );
    return outPath;
  },
};

/**
 * Ucretli referans uygulama. Arayuzun tek uygulamaya gore sekillenmedigini
 * dogrulamak icin burada: iki farkli govde ayni imzayi tasiyabiliyorsa
 * arayuz dogru cizilmis demektir.
 */
const elevenlabs: TtsProvider = {
  id: 'elevenlabs',
  tier: 'paid',
  isConfigured: () => Boolean(cfg.tts.elevenKey),
  async speak(text, outPath, voice) {
    const id = voice || cfg.tts.elevenVoice;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': cfg.tts.elevenKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: cfg.tts.elevenModel }),
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await ensureDir(outPath);
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return outPath;
  },
};

const registry: Record<string, TtsProvider> = { edge, elevenlabs };

/** LLM'deki gibi zincir: ucretli cokerse ucretsize duser, hat durmaz. */
export function getTts(): TtsProvider {
  const chain = cfg.tts.chain
    .map((id) => registry[id])
    .filter((p): p is TtsProvider => Boolean(p?.isConfigured()));

  if (!chain.length) throw new Error(`Calisir TTS yok. TTS_PROVIDER=${cfg.tts.chain.join(',')}`);
  if (chain.length === 1) return chain[0]!;

  return {
    id: chain.map((p) => p.id).join('>'),
    tier: chain[0]!.tier,
    isConfigured: () => true,
    async speak(text, outPath, voice) {
      let last: unknown;
      for (const p of chain) {
        try {
          return await p.speak(text, outPath, voice);
        } catch (e) {
          last = e;
          log.warn(`tts ${p.id} basarisiz, siradakine geciliyor: ${String(e).slice(0, 120)}`);
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}

export const ttsRegistry = registry;

/** ffprobe ile sure; video suresi sese gore kurulur. */
export async function duration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const d = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`sure okunamadi: ${file}`);
  return d;
}
