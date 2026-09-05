import { cfg } from '../../core/config.ts';
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
        generationConfig: { maxOutputTokens: opts?.maxTokens ?? 1024 },
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
  [gemini.id]: gemini,
  [claude.id]: claude,
  [ollama.id]: ollama,
  [mock.id]: mock,
  groq: openAiCompatible('groq', 'https://api.groq.com/openai/v1', cfg.llm.groq.key, cfg.llm.groq.model),
};

export function getLlm(): LlmProvider {
  const p = registry[cfg.llm.provider];
  if (!p) throw new Error(`Bilinmeyen LLM_PROVIDER: ${cfg.llm.provider}. Secenekler: ${Object.keys(registry).join(', ')}`);
  if (!p.isConfigured()) throw new Error(`${p.id} yapilandirilmamis (.env icindeki anahtari doldur).`);
  return p;
}
