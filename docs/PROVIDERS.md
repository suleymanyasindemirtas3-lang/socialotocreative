# Sağlayıcı Ekleme

Beş takılabilir nokta var. Hepsi aynı deseni izler: **arayüz + kayıt + zincir**.
Ücretsizden ücretliye geçiş her zaman bir `.env` satırıdır (Motto 1).

| Katman | Arayüz | Kayıt dosyası | `.env` |
|---|---|---|---|
| Metin | `LlmProvider` | `src/providers/llm/index.ts` | `LLM_PROVIDER` |
| Görsel | `ImageProvider` | `src/providers/image/index.ts` | `IMAGE_PROVIDER` |
| Seslendirme | `TtsProvider` | `src/providers/tts/index.ts` | `TTS_PROVIDER` |
| Video görüntüsü | `ClipSource` | `src/providers/clip/index.ts` | `CLIP_SOURCE` |
| Platform | `PlatformDef` | `src/platforms/index.ts` | panelden hesap |

## Zincir

`LLM_PROVIDER`, `TTS_PROVIDER` ve `CLIP_SOURCE` virgülle ayrılmış birer zincirdir:

```
TTS_PROVIDER=elevenlabs,edge
```

İlki çökerse ya da kredisi biterse sıradakine düşülür. **Ücretsiz krediyle çalışan
sağlayıcılar için tasarım budur:** kredi bitince hat durmaz, ücretsiz yedeğe iner.
Ücretli olanı başa, ücretsizi sona koy.

## Tier

Her sağlayıcı `tier` bildirir: `free` · `credit` · `paid`.
`npm run doctor` bunu listeler, panel gösterir. Amaç, hangi anahtarın para
harcadığının hiçbir zaman belirsiz kalmaması.

## Video mimarisi — önemli ayrım

AI video üretimi ffmpeg'in **yerine geçmez**, sadece görüntü kaynağının yerine geçer:

```
ClipSource (takılabilir)        compose() (her zaman yerel, bedelsiz)
  still → görsel + Ken Burns  ─┐
  fal   → AI video klibi      ─┴→ ses + altyazı + 9:16 + h264 → mp4
```

Böylece pahalı sağlayıcıya geçtiğinde yalnızca görüntü maliyeti doğar;
seslendirme, altyazı ve formatlama bedelsiz kalır.

`ClipRequest.existingStill`: üretim aşaması zaten bir görsel ürettiyse yolunu
verir. Ücretsiz kaynak onu aynen kullanır (ikinci kez üretmez), AI kaynağı yok sayar.

## Yeni bir seslendirme sağlayıcısı

```ts
const yeni: TtsProvider = {
  id: 'yeni',
  tier: 'credit',
  isConfigured: () => Boolean(cfg.tts.yeniKey),
  async speak(text, outPath, voice) {
    // ... istek at, sesi outPath'e yaz
    return outPath;
  },
};
```

`registry`'ye ekle, `.env`'e anahtarını koy, `TTS_PROVIDER=yeni,edge` yaz. Bitti.
Çağıran hiçbir kod değişmez.

## Yeni bir video sağlayıcısı

```ts
const yeni: ClipSource = {
  id: 'yeni',
  tier: 'paid',
  isConfigured: () => Boolean(cfg.clip.yeniKey),
  async produce({ prompt, seconds, outStem }) {
    // ... klibi indir
    return { path: `${outStem}.src.mp4`, motion: true };
  },
};
```

`motion: true` dönersen `compose()` Ken Burns uygulamaz (hazır hareket titrer).
`motion: false` dönersen durgun görsel muamelesi görür.

## Yeni bir platform

Tek dosya: `src/platforms/<ad>.ts`. `PlatformDef` doldur — `fields` dizisi
panelin formunu **kendisi üretir**, panelde platforma özel kod yazılmaz.
`verify()` kaydetmeden önce kimliği doğrular; hatalı hesap eklenmez.
`needs` alanı (`none`/`image`/`video`) üretim aşamasına ne hazırlaması
gerektiğini söyler.
