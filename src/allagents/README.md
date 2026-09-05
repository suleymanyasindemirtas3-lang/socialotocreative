# allagents

```
                        ┌─────────┐
                        │  LİDER  │  durumu okur, görev dağıtır
                        └────┬────┘
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
      ┌──────────┐   ┌──────────────┐   ┌──────────┐
      │  içerik  │   │  prodüksiyon │   │  yayın   │
      └──────────┘   └──────────────┘   └──────────┘
      icerik-bulma    lider: yönetmen      publish
      senaryo         ses
                      video-uretim
                      video
```

## Ajanlar

| # | Ajan | Sorumluluk | Katman |
|---|---|---|---|
| 1 | `icerik-bulma` | Konu havuzu çıkarır, tekrar edenleri eler | llm |
| 5 | `senaryo` | Post metni, seslendirme metni, görsel istemi | llm |
| 3 | `ses` | Seslendirme üretir, süresini ölçer | tts |
| 2 | `video-uretim` | Videonun **görüntü kaynağını** üretir | clip, image |
| 4 | `video` | Görüntü + ses + altyazı → dikey mp4 | ffmpeg |
| 6 | `yonetmen` | Prodüksiyon ekibinin lideri | — |

## Ekipler

| Ekip | Üstlendiği görevler | Sınır |
|---|---|---|
| `icerik` | `fikir-bul`, `icerik-yaz` | çıktısı **metin** |
| `produksiyon` | `medya-uret`, `tekrar-dene` | çıktısı **medya** |
| `yayin` | `yayinla` | çıktısı **yayınlanmış post** |

Ekip sınırının metin/medya arasından geçmesinin sebebi: **metin ucuz ve hızlı,
medya pahalı ve yavaş.** Ayırınca, metin kalite kapısına takılırsa boşuna ses ve
video üretilmiyor. Bu yüzden `scripted` diye ayrı bir durum var.

## Lider

İki işi var:

1. **Planlar** — kuyruğun durumunu okur, ne gerektiğine karar verir
2. **Dağıtır** — her görevi `handles` listesine bakarak uygun ekibe yollar

```
LIDER: 2 gorev
  icerik-yaz    <- 1 taslak metin bekliyor
  fikir-bul     <- hatta 1 is var, esik 3
```

Önceki sürümde sıra sabitti: `ideate → generate → publish`. Sorun şuydu ki
kuyrukta 40 taslak birikmişken bile yeni fikir üretiyordu. Artık sıra değil,
**ihtiyaç** belirliyor:

- Önce biriken işi bitir, sonra yeni iş aç
- Başarısızlar 3'ü geçerse geri al
- Yeni fikir yalnızca hat boşalmaya başlayınca

Kurallar bilinçli olarak basit tutuldu. Görünmeyen bir zekâ değil,
**denetlenebilir bir politika** olmalı — panelde her görevin gerekçesi yazıyor.

## İki kural

**Yönetmen dışında hiçbir ajan başka ajanı çağırmaz.** Sıra ekip içinde
yönetmende, ekipler arasında liderde durur.

**Lider ekibin içine bakmaz.** Görevi `handles` listesinden bulur. Ekibin kaç
ajanı olduğu, hangi sırayla çalıştırdığı ekibin kendi bilgisi. Yeni ekip eklemek
liderde tek satır değişiklik gerektirmez.

## Ajan ≠ sağlayıcı

- **Sağlayıcı** (`src/providers/`) — *ne ile yapılır.* ElevenLabs mi edge-tts mi.
- **Ajan** (`src/allagents/`) — *kim ne yapar.* Seslendirme kimin işi.

`ses` ajanı hangi TTS'in kullanıldığını bilmez. Ücretsizden ücretliye geçiş
sağlayıcı zincirinin işi ([docs/PROVIDERS.md](../../docs/PROVIDERS.md)).

## Yeni ekip eklemek

```ts
export const analizEkibi: Ekip = {
  id: 'analiz',
  role: 'Yayin sonrasi metrikleri toplar',
  members: ['analist'],
  handles: ['olc'],
  async run(gorev) { /* ... */ },
};
```

`ekipler/index.ts` dizisine ekle, `GorevTuru`'ne `'olc'` ekle, liderin
`planla()` fonksiyonuna ne zaman gerektiğini yazan bir kural koy. Bitti.

## Henüz yok

- **analist** — yayın sonrası metrikleri toplayıp `icerik-bulma`'ya besleyecek.
  Bu olmadan sistem hangi içeriğin tuttuğunu hiç öğrenemez.
- **yayin** ekibi ajanlaştırılmadı; `pipeline/publish.ts` sarmalanıyor.
