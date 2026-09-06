# socialotocreative

Otomatik sosyal medya içerik üretim ve yayın hattı.
Gerçek gündemden konu bulur, metin ve görsel üretir, video kurgular, onayından
geçirir ve birden fazla hesaba aynı anda yayınlar.

**Sıfır maliyetle çalışır.** Ücretli bir servise geçmek her zaman tek bir `.env`
satırıdır — kod değişmez.

---

## Nereden başlamalı

| Ne arıyorsun | Dosya |
|---|---|
| **Bir sorunu düzeltmek istiyorum** | [docs/MUDAHALE.md](docs/MUDAHALE.md) — şikâyet → dosya → ne yapılır |
| Neden böyle tasarlandı | [docs/PRINCIPLES.md](docs/PRINCIPLES.md) — 9 madde |
| Ücretli/yeni servis bağlayacağım | [docs/PROVIDERS.md](docs/PROVIDERS.md) |
| Ajanlar nasıl çalışıyor | [src/allagents/README.md](src/allagents/README.md) |
| İçerik kalitesini düzeltmek | [content/brand.md](content/brand.md) — **en değerli dosya** |

Kodda müdahale gereken yerler `MUDAHALE NOKTASI` yorumuyla işaretli:

```bash
grep -rn "MUDAHALE" src/ content/
```

---

## Nasıl çalışıyor

```
                        ┌─────────┐
                        │  LİDER  │  durumu okur, ihtiyaca göre görev dağıtır
                        └────┬────┘
        ┌────────────┬───────┴───────┬────────────┐
        ▼            ▼               ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌──────────────┐  ┌────────┐
   │araştırma│  │ içerik  │  │  prodüksiyon │  │ yayın  │
   └─────────┘  └─────────┘  └──────────────┘  └────────┘
   HN, GitHub    icerik-bulma   ses               8 platform
   dev.to, RSS   senaryo        video-uretim      adaptörü
                                video
                                (lider: yönetmen)
```

Bir postun yolculuğu:

```
draft  ──► scripted  ──► pending_approval ──► approved ──► published
  ▲          ▲                  ▲                              │
  │          │                  │                              │
fikir      metin             onayın                       hesaplara
bulundu    yazıldı           bekleniyor                    dağıtıldı
```

`scripted` ayrı bir durum çünkü **metin ucuz, medya pahalı.** Metin kalite
kapısına takılırsa boşuna ses ve video üretilmiyor.

---

## Kurulum

```bash
npm install
cp .env.example .env
npm run doctor
```

`doctor` her sağlayıcıya canlı istek atar, neyin çalışıp neyin eksik olduğunu
söyler. Hiçbir anahtar girmeden bile hat baştan sona çalışır (`console` hedefi).

```bash
npm run panel
```

Tarayıcıdan kuyruğu görür, metni düzenler, onaylar ve **hesap eklersin**.

---

## Komutlar

| Komut | İş |
|---|---|
| `npm run doctor` | her sağlayıcıya canlı bağlantı testi |
| `npm run saglik` | **iş üretiyor mu** kontrolü + ne yapman gerektiği |
| `npm run plan` | liderin sıradaki görev planı ve gerekçeleri |
| `npm run panel` | web paneli (onay + hesap yönetimi) |
| `npm run dev` | lideri bir kez çalıştır |
| `npm start` | sürekli çalışma modu |
| `npm run ideate` | sadece fikir bul |
| `npm run write` | taslakları metne çevir |
| `npm run generate` | metinleri medyaya çevir |
| `npm run publish` | onaylananları yayınla |
| `npm run review` | terminalden onayla |
| `npm run retry` | başarısızları geri al |
| `npm run status` | kuyruğun durumu |
| `npm run temizle` | eski medya dosyalarını sil |

---

## Sağlayıcılar

Her katman virgüllü bir **zincir**: ilki çökerse ya da kredisi biterse
sıradakine düşülür. Ücretsiz krediyle çalışan servisler için tasarım budur.

| Katman | Ücretsiz | Ücretli geçiş | `.env` |
|---|---|---|---|
| Metin | `gemini`, `ollama` (yerel), `groq`, `pollinations` | `claude` | `LLM_PROVIDER` |
| Görsel | `pollinations` (anahtarsız) | fal / replicate | `IMAGE_PROVIDER` |
| Seslendirme | `edge` (Türkçe, anahtarsız) | `elevenlabs` | `TTS_PROVIDER` |
| Video görüntüsü | `still` (görsel + Ken Burns) | `fal` (AI video) | `CLIP_SOURCE` |
| Gündem | HN, dev.to, GitHub, RSS | — | `TREND_SOURCES` |

---

## Platformlar

Hedef **platform değil hesap**: aynı platformda birden fazla hesap olabilir ve
bir post hepsine aynı anda gider. Hesaplar panelden eklenir, kaydedilmeden önce
kimlik doğrulanır.

| Platform | Kurulum | Gereken | İçerik |
|---|---|---|---|
| `console` | yok | — | test hedefi |
| `discord` | çok kolay | webhook URL | metin + görsel |
| `bluesky` | kolay | app password | metin + görsel |
| `mastodon` | kolay | sunucu + token | metin + görsel |
| `x` | orta | 4 anahtar (OAuth 1.0a) | metin + görsel |
| `youtube` | zor | OAuth refresh token | **video** |
| `instagram` | zor | Business hesap + Meta app | görsel / Reels |
| `tiktok` | en zor | app audit **onayı şart** | **video** |

TikTok uyarısı: app audit onaylanmadan `video.publish` açılmaz; onaysız app
videoları `SELF_ONLY` (gizli) yükler. Kod hazır, engel TikTok tarafında.

Kimlik bilgileri `data/accounts.json` içinde ve **repoya girmez**.
GitHub Actions'ta tek bir `ACCOUNTS_JSON` secret'ından okunur.

---

## Güvenlik

- `.env` ve `data/accounts.json` `.gitignore`'da — sır repoya girmez
- Panel `PANEL_TOKEN` ister, varsayılan olarak yalnız `127.0.0.1` dinler
- Varsayılan `DRY_RUN=true` ve `AUTO_APPROVE=false`: projeyi yanlışlıkla
  çalıştıran hiçbir yere hiçbir şey göndermez
- Yalnızca resmi API'ler kullanılır; scraping ve tarayıcı otomasyonu yok

> **Bu repo public.** `data/queue.json` ve `data/media/` içindeki taslaklar
> yayınlanmadan önce herkese görünür. Instagram medyayı public URL olarak
> istediği için repo public olmak zorunda; rahatsız ediciyse Cloudflare R2
> gibi ayrı bir barındırıcıya geçip repoyu private yapabilirsin.

---

## Otomasyon

`.github/workflows/` altında iki cron:

- `pipeline.yml` — günde iki kez üretir ve onaya gönderir
- `publish.yml` — iki saatte bir onaylananları yayınlar

Anahtarlar repo **Secrets**, ayarlar repo **Variables** altına girilir.
İlk hafta `DRY_RUN=true` bırak; logları okuyup içerikten emin olunca kapat.
