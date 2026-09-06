import { cfg } from '../../core/config.ts';
import { log } from '../../core/logger.ts';
import { kullanilabilir, hataBildir, basariBildir, kotaHatasiMi, kalanBekleme } from './saglik.ts';
import type { LlmProvider } from '../../core/types.ts';

/**
 * OpenAI uyumlu uclar tek govdeyi paylasir.
 * Groq, Cerebras, Mistral, OpenRouter ve Together hepsi ayni sozlesmeyi
 * kullaniyor - bu yuzden yeni bir ucretsiz saglayici eklemek tek satir.
 */
function openAiCompatible(
  id: string,
  base: string,
  key: string,
  model: string,
  ekBaslik: Record<string, string> = {},
): LlmProvider {
  return {
    id,
    isConfigured: () => Boolean(key),
    async complete(prompt, opts) {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          ...ekBaslik,
        },
        body: JSON.stringify({
          model,
          max_tokens: opts?.maxTokens ?? 1024,
          ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const govde = await res.text();
        hataBildir(id, govde, kotaHatasiMi(res.status, govde));
        throw new Error(`${id} ${res.status}: ${govde.slice(0, 200)}`);
      }

      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const metin = j.choices?.[0]?.message?.content ?? '';
      if (metin.trim()) basariBildir(id);
      return metin;
    },
  };
}

interface GeminiYanit {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { thoughtsTokenCount?: number };
}

const gemini: LlmProvider = {
  id: 'gemini',
  isConfigured: () => Boolean(cfg.llm.gemini.key),
  async complete(prompt, opts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.llm.gemini.model}:generateContent`;
    const govdeJson = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(opts?.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: opts?.maxTokens ?? 1024,
        ...(opts?.json ? { responseMimeType: 'application/json' } : {}),
        /**
         * Yeni Gemini modelleri "dusunen" modeller: cikti butcesini once
         * dusunceye harcayip metin uretmeden MAX_TOKENS ile donebiliyorlar.
         * Kisa istekler bu yuzden bos donuyordu. Dusunmeyi kapatmak hem
         * bunu cozuyor hem de ucretsiz kotayi koruyor.
         *
         * MUDAHALE: Uzun ve karmasik metinlerde kalite isteyip kota
         * harcamayi goze aliyorsan .env icinde GEMINI_THINKING=1 yap.
         */
        ...(cfg.llm.gemini.thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    });

    // Ucretsiz tier dakika basina istek siniri koyuyor; 429 kalici hata degil.
    for (let deneme = 1; deneme <= 3; deneme++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.llm.gemini.key },
        body: govdeJson,
      });

      // 429 kota, 5xx gecici yuk. Ikisi de kalici hata degil; hemen yedege
      // dusmek Gemini'yi bosuna terk edip kaliteyi dusuruyordu.
      const geciciMi = res.status === 429 || res.status >= 500;
      if (geciciMi && deneme < 3) {
        const bekle = deneme * 15_000;
        log.warn(`gemini ${res.status} (gecici), ${bekle / 1000}s sonra tekrar (${deneme}/2)`);
        await new Promise((r) => setTimeout(r, bekle));
        continue;
      }

      if (!res.ok) {
        const govde = await res.text();
        hataBildir('gemini', govde, kotaHatasiMi(res.status, govde));
        // Model adlari zamanla degisiyor; 404'u "hangi modeller var" listesine
        // cevirmek anlamsiz bir hatayi uygulanabilir bir talimata donusturur.
        if (res.status === 404) throw new Error(await modelHatasi(govde));
        throw new Error(`gemini ${res.status}: ${govde.slice(0, 300)}`);
      }

      const j = (await res.json()) as GeminiYanit;
      const aday = j.candidates?.[0];
      const metin = aday?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (metin.trim()) {
        basariBildir('gemini');
        return metin;
      }

      // Bos yanit sessizce gecmemeli: sebebini soyle, TypeError atma.
      const sebep = aday?.finishReason ?? 'bilinmiyor';
      const dusunce = j.usageMetadata?.thoughtsTokenCount ?? 0;
      throw new Error(
        `gemini metin dondurmedi (finishReason=${sebep}` +
          (dusunce ? `, dusunceye ${dusunce} token gitti` : '') +
          `). maxTokens degerini yukselt ya da GEMINI_THINKING=0 birak.`,
      );
    }
    throw new Error('gemini: kota siniri asilamadi');
  },
};

/** 404 aldiginda hesabin gercekten erisebildigi modelleri listeler. */
async function modelHatasi(govde: string): Promise<string> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': cfg.llm.gemini.key },
    });
    const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const kullanilabilir = (j.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .slice(0, 12);

    if (!kullanilabilir.length) return `gemini 404 ve model listesi bos: ${govde.slice(0, 200)}`;
    return (
      `GEMINI_MODEL="${cfg.llm.gemini.model}" bulunamadi.\n` +
      `.env icindeki GEMINI_MODEL satirini sunlardan biriyle degistir:\n  ` +
      kullanilabilir.join('\n  ')
    );
  } catch {
    return `gemini 404: ${govde.slice(0, 300)}`;
  }
}

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
  /**
   * Ucretsiz katmanlar (2026 itibariyle dogrulanmis):
   *   groq       30 istek/dk, 1000/gun - en hizli
   *   cerebras   gunde 1M token - en genis kota
   *   mistral    ayda 1B token
   *   openrouter ~30 ucretsiz model, 20 istek/dk
   * Hepsi ayni OpenAI sozlesmesini kullaniyor.
   */
  groq: openAiCompatible('groq', 'https://api.groq.com/openai/v1', cfg.llm.groq.key, cfg.llm.groq.model),
  cerebras: openAiCompatible('cerebras', 'https://api.cerebras.ai/v1', cfg.llm.cerebras.key, cfg.llm.cerebras.model),
  mistral: openAiCompatible('mistral', 'https://api.mistral.ai/v1', cfg.llm.mistral.key, cfg.llm.mistral.model),
  openrouter: openAiCompatible(
    'openrouter',
    'https://openrouter.ai/api/v1',
    cfg.llm.openrouter.key,
    cfg.llm.openrouter.model,
    { 'http-referer': 'https://github.com/suleymanyasindemirtas3-lang/socialotocreative', 'x-title': 'socialotocreative' },
  ),
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
 *
 * Zincir onceden her istekte bastan deniyordu: kotasi dolmus saglayici
 * yeniden cagriliyor, uc kez tekrar edip 45 saniye bekliyor, sonra yedege
 * geciliyordu. Her post icin bir dakika bosa gidiyordu.
 *
 * Artik kotasi dolan saglayici bir sure kenara ayriliyor (bkz. saglik.ts).
 * Siralamada oncelik korunuyor - en iyi CALISAN saglayici seciliyor,
 * korlemesine sirayla degil.
 */
export function getLlm(): LlmProvider {
  const chain = resolveChain();
  if (chain.length === 1) return chain[0]!;

  return {
    id: chain.map((p) => p.id).join('>'),
    isConfigured: () => true,
    async complete(prompt, opts) {
      // Beklemede olmayanlar once; hepsi beklemedeyse yine de denenir
      // (bekleme tahmindir, gercekten dolmus olmayabilir).
      const hazir = chain.filter((p) => kullanilabilir(p.id));
      const bekleyen = chain.filter((p) => !kullanilabilir(p.id));
      const sira = [...hazir, ...bekleyen];

      if (!hazir.length) {
        log.warn(
          'tum saglayicilar beklemede: ' +
            bekleyen.map((p) => `${p.id} ${Math.ceil(kalanBekleme(p.id) / 60000)}dk`).join(', '),
        );
      }

      let last: unknown;
      for (const p of sira) {
        try {
          const out = await p.complete(prompt, opts);
          if (out.trim()) return out;
          last = new Error(`${p.id} bos yanit dondurdu`);
        } catch (e) {
          last = e;
          log.warn(`${p.id} basarisiz, siradakine geciliyor: ${String(e).slice(0, 120)}`);
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}
