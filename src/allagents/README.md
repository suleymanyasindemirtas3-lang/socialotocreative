# allagents

Altı ajan. Her biri tek bir işten sorumlu ve tek bir çıktı üretir.

| # | Ajan | Sorumluluk | Dayandığı katman |
|---|---|---|---|
| 1 | `icerik-bulma` | Konu havuzu çıkarır, tekrar edenleri eler | llm |
| 2 | `video-uretim` | Videonun **görüntü kaynağını** üretir | clip, image |
| 3 | `ses` | Seslendirme üretir ve süresini ölçer | tts |
| 4 | `video` | Görüntü + ses + altyazıyı dikey mp4'e kurgular | ffmpeg |
| 5 | `senaryo` | Post metni, seslendirme metni, görsel istemi yazar | llm |
| 6 | `yonetmen` | Sırayı kurar, koşulları değerlendirir, karar verir | hepsi |

## Kural

**Yönetmen dışında hiçbir ajan başka bir ajanı çağırmaz.** Sıra, koşul ve hata
yönetimi tek yerde durur. Bir ajanın sorumluluğu değiştiğinde yalnızca o ajan ve
yönetmen değişir; aradaki hiçbir şey değişmez.

## Ajan ≠ sağlayıcı

İki ayrı katman, karıştırılmamalı:

- **Sağlayıcı** (`src/providers/`) — *ne ile yapılır.* ElevenLabs mi edge-tts mi.
- **Ajan** (`src/allagents/`) — *kim ne yapar.* Seslendirme kimin işi.

`ses` ajanı hangi TTS'in kullanıldığını bilmez ve umursamaz. Ücretsizden ücretliye
geçiş sağlayıcı zincirinin işidir ([docs/PROVIDERS.md](../../docs/PROVIDERS.md)),
ajan katmanı bundan etkilenmez.

## Neden 2 ve 4 ayrı

`video-uretim` görüntüyü üretir, `video` kurgular. Ayrılma sebebi **maliyet**:
pahalı olan yalnızca görüntü üretimi. Ücretli AI video sağlayıcısına geçtiğinde
ses, altyazı ve formatlama bedelsiz yerel işlemede kalır (Motto 9).

## Neden 5 üç ayrı çıktı verir

Post metni, seslendirme metni ve görsel istemi üç ayrı dilde yazılır:

- post metni — yazı dili, karakter sınırı sert
- seslendirme — konuşma dili; caption'ı sesli okumak izleyiciyi kaybettirir
- görsel istemi — İngilizce, görsel betimleme

Kalite kapısı burada çalışır: çöp metin sonraki ajanlara hiç geçmez, böylece
boşuna ses ve video üretilmez.

## Eksik olan: yayıncı

Yayın hâlâ `src/pipeline/publish.ts` içinde ve ajan değil. Listende yoktu, o yüzden
kendiliğimden ajanlaştırmadım — ama doğal yedinci ajan o. İstersen taşırım.

Analitik (yayın sonrası metrik toplayıp `icerik-bulma`'ya besleme) ise henüz
hiç yok; sekizinci ajan olmaya aday.
