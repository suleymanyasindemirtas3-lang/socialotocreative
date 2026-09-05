const env = (k: string, d = ''): string => process.env[k]?.trim() || d;
const bool = (k: string, d = false): boolean => {
  const v = process.env[k]?.trim().toLowerCase();
  return v === undefined || v === '' ? d : v === 'true' || v === '1';
};
const list = (k: string, d: string[] = []): string[] => {
  const v = env(k);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d;
};

export const cfg = {
  llm: {
    // Virgulle ayrilmis zincir: ilki cokerse sonraki denenir.
    chain: list('LLM_PROVIDER', ['mock']),
    gemini: { key: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL', 'gemini-2.0-flash') },
    groq: { key: env('GROQ_API_KEY'), model: env('GROQ_MODEL', 'llama-3.3-70b-versatile') },
    claude: { key: env('ANTHROPIC_API_KEY'), model: env('ANTHROPIC_MODEL', 'claude-sonnet-5') },
    ollama: { host: env('OLLAMA_HOST', 'http://localhost:11434'), model: env('OLLAMA_MODEL', 'llama3.2') },
  },
  image: {
    provider: env('IMAGE_PROVIDER', 'pollinations'),
    width: Number(env('IMAGE_WIDTH', '1024')),
    height: Number(env('IMAGE_HEIGHT', '1024')),
  },
  approval: { auto: bool('AUTO_APPROVE', false) },
  // Instagram medyayi public URL olarak ister; digerleri dogrudan yukleme alir.
  mediaHost: {
    provider: env('MEDIA_HOST', 'github'),
    repo: env('MEDIA_REPO'),
    branch: env('MEDIA_BRANCH', 'main'),
    base: env('PUBLIC_MEDIA_BASE'),
  },
  // Seslendirme: ucretsiz edge varsayilan, ucretli saglayici zincire eklenir.
  tts: {
    chain: list('TTS_PROVIDER', ['edge']),
    voice: env('TTS_VOICE', 'tr-TR-AhmetNeural'),
    rate: env('TTS_RATE', '+8%'),
    elevenKey: env('ELEVENLABS_API_KEY'),
    elevenVoice: env('ELEVENLABS_VOICE_ID'),
    elevenModel: env('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
  },
  // Videonun goruntu kaynagi: durgun gorsel (bedelsiz) ya da AI video (ucretli).
  clip: {
    chain: list('CLIP_SOURCE', ['still']),
    falKey: env('FAL_API_KEY'),
    falModel: env('FAL_MODEL', 'fal-ai/ltx-video'),
  },
  brand: {
    niche: env('BRAND_NICHE', 'yazilim ve yapay zeka'),
    language: env('BRAND_LANGUAGE', 'tr'),
    tone: env('BRAND_TONE', 'net, iddiali, jargonsuz'),
  },
  safety: { dryRun: bool('DRY_RUN', true), maxPerRun: Number(env('MAX_POSTS_PER_RUN', '3')) },
};
