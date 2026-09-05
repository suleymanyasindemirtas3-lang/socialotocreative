# socialmediai

Sağlayıcı bağımsız otomatik sosyal medya üretim ve yayın hattı.
Sıfır maliyetle çalışır; ücretli sağlayıcıya geçiş tek `.env` satırıdır.

Tasarım gerekçeleri: [docs/PRINCIPLES.md](docs/PRINCIPLES.md)

## Akış

```
ideate    LLM konu havuzu üretir, daha önce üretilenleri eler
   ↓
generate  her platform için metin + görsel üretir
   ↓
approve   Telegram'a [Onayla] [Reddet] butonlarıyla taslak gönderir
   ↓
publish   onaylananları platform adaptörleriyle yayınlar
```

## Kurulum

```bash
npm install
cp .env.example .env
npm run doctor
```

`doctor` hangi sağlayıcının hazır, hangisinin eksik olduğunu söyler.
Hiçbir anahtar girmeden bile hattın tamamı `mock` LLM + `console` hedefiyle çalışır:

```bash
npm run dev
```

## Komutlar

| Komut | İş |
|---|---|
| `npm run doctor` | ayar ve bağlantı taraması |
| `npm run ideate` | sadece konu üret |
| `npm run generate` | taslakları metne/görsele çevir |
| `npm run approve` | onay iste + gelen onayları işle |
| `npm run publish` | onaylananları yayınla |
| `npm run status` | kuyruğun durumu |
| `npm run dev` | hepsini sırayla çalıştır |

## Sağlayıcı seçimi

| Katman | Ücretsiz | Ücretli geçiş |
|---|---|---|
| LLM | `mock`, `ollama` (yerel), `gemini`, `groq` | `claude` |
| Görsel | `pollinations` (anahtarsız) | fal / replicate adaptörü yaz |
| Depo | `JsonStore` (repo içi) | `SupabaseStore` yaz |
| Compute | GitHub Actions cron | kalıcı VM |

## Platform kurulum sırası

1. **console** — anahtar yok, hattı test etmek için.
2. **telegram** — [@BotFather](https://t.me/BotFather) ile bot aç, token al;
   kanalına ekle, `chat_id` öğren. Hem yayın hedefi hem onay kutusu.
3. **bluesky** — Ayarlar → App Passwords. Tamamen ücretsiz, limit yok, onay yok.
4. X / Instagram / LinkedIn — developer hesabı ve app onayı gerektirir,
   adaptörleri `src/platforms/` altına aynı arayüzle eklenir.

## Otomasyon

`.github/workflows/` altındaki iki cron:

- `pipeline.yml` — günde iki kez üretir ve onaya gönderir
- `publish.yml` — iki saatte bir onayları toplayıp yayınlar

Anahtarlar repo **Secrets**, ayarlar repo **Variables** altına girilir.
İlk hafta `DRY_RUN=true` bırak; logları okuyup içerik kalitesinden emin olunca kapat.
