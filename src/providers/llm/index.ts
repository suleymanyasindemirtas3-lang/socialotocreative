import { cfg } from '../../core/config.ts';
import { log } from '../../core/logger.ts';
import type { LlmProvider } from '../../core/types.ts';

// OpenAI uyumlu uclar (Groq dahil) tek govdeyi paylasir.
function openAiCompatible(id: string, base: string, key: string, model: string): LlmProvider {
  return {
    id,
    isConfigured: () => Boolean(key),
    async complete(prompt, opts) {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: opts?.maxTokens ?? 1024,
          messages: [
            ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`${id} ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { choices: { message: { content: string } }[] };
      return j.choices[0]?.message.content ?? '';
    },
  };
}

const gemini: LlmProvider = {
  id: 'gemini',
  isConfigured: () => Boolean(cfg.llm.gemini.key),
  async complete(prompt, opts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.llm.gemini.model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.llm.gemini.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(opts?.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
        generationConfig: {
          maxOutputTokens: opts?.maxTokens ?? 1024,
          ...(opts?.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { candidates?: { content: { parts: { text?: string }[] } }[] };
    return j.candidates?.[0]?.content.parts.map((p) => p.text ?? '').join('') ?? '';
  },
};

const claude: LlmProvider = {
  id: 'claude',
  isConfigured: () => Boolean(cfg.llm.claude.key),
  async complete(prompt, opts) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.llm.claude.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.llm.claude.model,
        max_tokens: opts?.maxTokens ?? 1024,
        ...(opts?.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { content: { type: string; text?: string }[] };
    return j.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  },
};

const ollama: LlmProvider = {
  id: 'ollama',
  isConfigured: () => Boolean(cfg.llm.ollama.host),
  async complete(prompt, opts) {
    const res = await fetch(`${cfg.llm.ollama.host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.llm.ollama.model,
        stream: false,
        ...(opts?.json ? { format: 'json' } : {}),
        options: { num_predict: opts?.maxTokens ?? 1024 },
        messages: [
          ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { message?: { content: string } };
    return j.message?.content ?? '';
  },
};

/**
 * Anahtarsiz gercek uretim. Tek ucretsiz yol GET; POST ucu paraya baglandi.
 * Bu yuzden sistem talimati prompt'un basina katlanir ve uzunluk sinirlanir.
 */
const pollinations: LlmProvider = {
  id: 'pollinations',
  isConfigured: () => true,
  async complete(prompt, opts) {
    const full = opts?.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;
    // URL uzunluk siniri: sistem talimati uzarsa sondan kirp.
    const body = full.length > 3500 ? full.slice(0, 3500) : full;
    const url = `https://text.pollinations.ai/${encodeURIComponent(body)}?model=openai`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url, { headers: { 'user-agent': 'socialmediai/0.1' } });
      const text = await res.text();
      if (res.ok && !text.startsWith('{"error"')) return text;
      if (attempt === 3) throw new Error(`pollinations ${res.status}: ${text.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
    return '';
  },
};

/** Anahtarsiz calisir; hattin ucdan uca test edilmesi icin. */
const mock: LlmProvider = {
  id: 'mock',
  isConfigured: () => true,
  async complete(prompt) {
    if (prompt.includes('JSON')) {
      return JSON.stringify([
        { topic: 'Ornek konu 1', angle: 'karsit gorus' },
        { topic: 'Ornek konu 2', angle: 'pratik ipucu' },
        { topic: 'Ornek konu 3', angle: 'kisa vaka' },
      ]);
    }
    return 'Bu bir mock ciktisidir. Gercek uretim icin LLM_PROVIDER degerini degistir.';
  },
};

const registry: Record<string, LlmProvider> = {
  [pollinations.id]: pollinations,
  [gemini.id]: gemini,
  [claude.id]: claude,
  [ollama.id]: ollama,
  [mock.id]: mock,
  groq: openAiCompatible('groq', 'https://api.groq.com/openai/v1', cfg.llm.groq.key, cfg.llm.groq.model),
};

export function resolveChain(): LlmProvider[] {
  const chain: LlmProvider[] = [];
  for (const id of cfg.llm.chain) {
    const p = registry[id];
    if (!p) throw new Error(`Bilinmeyen LLM_PROVIDER: ${id}. Secenekler: ${Object.keys(registry).join(', ')}`);
    if (p.isConfigured()) chain.push(p);
    else log.warn(`${id} yapilandirilmamis, zincirden cikarildi`);
  }
  if (!chain.length) throw new Error(`Calisir LLM yok. LLM_PROVIDER=${cfg.llm.chain.join(',')}`);
  return chain;
}

/**
 * MOTTO 8: Tek saglayiciya bagimli kalma.
 * Ucretsiz uclar kota doldurur ya da cover; zincirdeki bir sonrakine gecilir.
 */
export function getLlm(): LlmProvider {
  const chain = resolveChain();
  if (chain.length === 1) return chain[0]!;

  return {
    id: chain.map((p) => p.id).join('>'),
    isConfigured: () => true,
    async complete(prompt, opts) {
      let last: unknown;
      for (const p of chain) {
        try {
          const out = await p.complete(prompt, opts);
          if (out.trim()) return out;
          last = new Error(`${p.id} bos yanit dondurdu`);
        } catch (e) {
          last = e;
          log.warn(`${p.id} basarisiz, siradakine geciliyor: ${String(e).slice(0, 140)}`);
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}
