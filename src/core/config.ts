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
    gemini: {
      key: env('GEMINI_API_KEY'),
      model: env('GEMINI_MODEL', 'gemini-flash-latest'),
      // Yeni modeller dusunen modeller; kisa isteklerde butceyi yiyip bos donuyorlar.
      thinking: bool('GEMINI_THINKING', false),
    },
    groq: { key: env('GROQ_API_KEY'), model: env('GROQ_MODEL', 'llama-3.3-70b-versatile') },
    // Hepsi OpenAI uyumlu; ucretsiz katmanlari birbirini tamamliyor.
    cerebras: { key: env('CEREBRAS_API_KEY'), model: env('CEREBRAS_MODEL', 'llama-3.3-70b') },
    mistral: { key: env('MISTRAL_API_KEY'), model: env('MISTRAL_MODEL', 'mistral-large-latest') },
    openrouter: {
      key: env('OPENROUTER_API_KEY'),
      model: env('OPENROUTER_MODEL', 'meta-llama/llama-3.3-70b-instruct:free'),
    },
    claude: { key: env('ANTHROPIC_API_KEY'), model: env('ANTHROPIC_MODEL', 'claude-sonnet-5') },
    ollama: { host: env('OLLAMA_HOST', 'http://localhost:11434'), model: env('OLLAMA_MODEL', 'llama3.2') },
  },
  image: {
    // Zincir: kota biterse ucretsiz saglayiciya duser.
    chain: list('IMAGE_PROVIDER', ['pollinations']),
    geminiModel: env('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'),
    /**
     * Cloudflare Workers AI: gunluk yenilenen ucretsiz kota, kart yok.
     * Kredi veren servisler bir kez tukenince biter; bu her gun sifirlanir.
     */
    cloudflareAccount: env('CLOUDFLARE_ACCOUNT_ID', ''),
    cloudflareToken: env('CLOUDFLARE_API_TOKEN', ''),
    cloudflareModel: env('CLOUDFLARE_IMAGE_MODEL', '@cf/black-forest-labs/flux-1-schnell'),
    width: Number(env('IMAGE_WIDTH', '1024')),
    height: Number(env('IMAGE_HEIGHT', '1024')),
  },
  approval: { auto: bool('AUTO_APPROVE', false) },
  // Gundem kaynaklari: fikirlerin gercek veriye dayanmasini saglar.
  sources: {
    chain: list('TREND_SOURCES', ['hackernews', 'devto', 'github']),
    feeds: list('RSS_FEEDS'),
    limit: Number(env('TREND_LIMIT', '20')),
    cacheMs: Number(env('TREND_CACHE_DK', '30')) * 60_000,
  },
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
  video: {
    // Shorts/Reels/TikTok'ta 60sn ustu izlenme oranini dusuruyor.
    maxSaniye: Number(env('VIDEO_MAX_SANIYE', '55')),
  },
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
  saglik: {
    sessizlikSaat: Number(env('SAGLIK_SESSIZLIK_SAAT', '48')),
    medyaLimitMb: Number(env('SAGLIK_MEDYA_LIMIT_MB', '500')),
    temizlikGun: Number(env('SAGLIK_TEMIZLIK_GUN', '14')),
  },
  safety: { dryRun: bool('DRY_RUN', true), maxPerRun: Number(env('MAX_POSTS_PER_RUN', '3')) },
};
