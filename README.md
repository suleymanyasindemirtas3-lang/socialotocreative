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
approve   panelde (ya da npm run review ile) onaylanır
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

## Panel

```bash
npm run panel
```

Tarayicidan kuyrugu gorur, metni duzenler, onaylar/reddeder ve **hesap eklersin**.
Hesap ekleme formu platformun kendi alan tanimindan uretilir; panelde platforma
ozel kod yoktur. Kaydetmeden once kimlik dogrulanir, hatali hesap eklenmez.

Panel `PANEL_TOKEN` ile korunur ve varsayilan olarak yalniz `127.0.0.1` dinler.
Uzaktan erismek icin tunel kullan (`cloudflared tunnel --url http://localhost:8787`),
`PANEL_HOST=0.0.0.0` yapip paneli dogrudan aga acma.

## Coklu hesap

Hedef artik platform degil **hesap**. Ayni platformda birden fazla hesap olabilir
(iki Bluesky, uc Discord kanali) ve bir post hepsine ayni anda gider.
Metin platform basina uretilir; ayni platformdaki hesaplar ayni metni paylasir.

Hesaplar `data/accounts.json` icinde durur ve **repoya girmez** (kimlik bilgisi tasir).
GitHub Actions'ta tek bir `ACCOUNTS_JSON` secret'indan okunur.

## Komutlar

| Komut | İş |
|---|---|
| `npm run doctor` | ayar ve bağlantı taraması |
| `npm run ideate` | sadece konu üret |
| `npm run generate` | taslakları metne/görsele çevir |
| `npm run publish` | onaylananları yayınla |
| `npm run status` | kuyruğun durumu |
| `npm run dev` | hepsini sırayla çalıştır |
| `npm run panel` | web paneli (onay + hesap yonetimi) |
| `npm run review` | terminalden onayla |
| `npm run retry` | basarisiz taslaklari geri al |

## Sağlayıcı seçimi

`LLM_PROVIDER` virgullu bir zincirdir; ilki çökerse sıradakine geçilir:
`LLM_PROVIDER=ollama,pollinations,gemini`


Sağlayıcı ekleme rehberi: [docs/PROVIDERS.md](docs/PROVIDERS.md)

| Katman | Ücretsiz | Ücretli geçiş |
|---|---|---|
| LLM | `ollama` (yerel, sinirsiz), `pollinations` (anahtarsiz), `gemini`, `groq` | `claude` |
| Görsel | `pollinations` (anahtarsız) | fal / replicate adaptörü yaz |
| Seslendirme | `edge` (anahtarsız, Türkçe) | `elevenlabs` |
| Video görüntüsü | `still` (görsel + Ken Burns) | `fal` (AI video üretimi) |
| Depo | `JsonStore` (repo içi) | `SupabaseStore` yaz |
| Compute | GitHub Actions cron | kalıcı VM |

## Platform kurulum sırası

Panelden eklenebilen platformlar:

| Platform | Kurulum zorlugu | Gereken |
|---|---|---|
| console | yok | — (test hedefi) |
| discord | cok dusuk | kanal webhook URL'i |
| bluesky | dusuk | app password |
| mastodon | dusuk | sunucu + access token |

Telegram, X, Instagram, LinkedIn ve YouTube su an yok. Ilk ucu disindakiler developer hesabi ve app onayi gerektirir;
adaptorleri `src/platforms/` altina ayni `PlatformDef` arayuzuyle eklenir.

## Otomasyon

`.github/workflows/` altındaki iki cron:

- `pipeline.yml` — günde iki kez üretir ve onaya gönderir
- `publish.yml` — iki saatte bir onayları toplayıp yayınlar

Anahtarlar repo **Secrets**, ayarlar repo **Variables** altına girilir.
İlk hafta `DRY_RUN=true` bırak; logları okuyup içerik kalitesinden emin olunca kapat.
