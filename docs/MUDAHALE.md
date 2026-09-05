# Nereye Müdahale Edilir

Bir sorunla karşılaştığında **hangi dosyaya bakacağını** bulmak için bu tablo.
Kodda bu noktalar `MUDAHALE NOKTASI` yorumuyla işaretli — `grep -rn MUDAHALE src/`
ile hepsini listeleyebilirsin.

## Önce bunu çalıştır

```bash
npm run saglik
```

Her bulgunun altında `-> YAP:` satırı var. Ne yapman gerektiğini orada yazıyor.

---

## Sorun → Bakılacak yer

| Şikâyet | Dosya | Ne yapılır |
|---|---|---|
| **"Metinler kötü / jenerik"** | `content/brand.md` | Marka sesini somutlaştır. Kodun temizliği içerik kalitesini belirlemez, bu dosya belirler. |
| "Konular alakasız" | `.env` → `TREND_SOURCES`, `RSS_FEEDS` | Kendi nişinin RSS adreslerini ekle. Kod yazman gerekmez. |
| "Bu çöp metin nasıl yayına gitmiş?" | `src/allagents/quality.ts` | `TELLTALES` dizisine desen ekle. |
| "Her şey `failed` oluyor" | `src/allagents/quality.ts` | Kapı fazla sıkı. `npm run status` hangi kurala takıldığını yazar, o kuralı gevşet. |
| "Çok fazla / çok az üretiyor" | `src/allagents/lider.ts` → `planla()` | Eşikler orada. `MAX_POSTS_PER_RUN` da etkiler. |
| "Görsel konuyla alakasız" | `src/allagents/yonetmen.ts` | Görsel istemi orada zenginleştiriliyor. |
| "Yeni platform lazım" | `src/platforms/<ad>.ts` | Tek dosya. `docs/PROVIDERS.md` içinde şablon var. |
| "Ücretli servis bağlayacağım" | `src/providers/` | `docs/PROVIDERS.md`. Beş takılabilir nokta. |
| "Yeni ekip lazım" | `src/allagents/ekipler/` | `src/allagents/README.md` içinde şablon var. |
| "Disk doluyor" | — | `npm run temizle` |

---

## Tek başına yapabileceklerin (kod yok, sadece `.env`)

| Ne istiyorsun | Satır |
|---|---|
| Daha hızlı/yavaş üretim | `MAX_POSTS_PER_RUN` |
| Onay beklemeden yayınla | `AUTO_APPROVE=true` |
| Hiçbir şey yayınlanmasın (test) | `DRY_RUN=true` |
| Ücretli LLM'e geç | `LLM_PROVIDER=claude,gemini,ollama` |
| Ücretli seslendirme | `TTS_PROVIDER=elevenlabs,edge` |
| AI video üretimi | `CLIP_SOURCE=fal,still` |
| Kendi kaynağını ekle | `RSS_FEEDS=https://...,https://...` |
| Kadın ses | `TTS_VOICE=tr-TR-EmelNeural` |

**Kural:** ücretliye geçiş her zaman tek bir `.env` satırıdır. Kod değiştirmen
gerekiyorsa mimaride bir eksik var demektir — söyle, düzeltelim.

---

## Benim yapamadıklarım (yetki gerektirenler)

Bunlar hesap açma ve kimlik doğrulama gerektiriyor; benim sınırım orada.

| İş | Nerede | Süre |
|---|---|---|
| Ücretsiz Gemini anahtarı | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 1 dk |
| X developer hesabı | [developer.x.com](https://developer.x.com/en/portal/dashboard) | 10 dk |
| YouTube OAuth | Google Cloud Console | 20 dk |
| Instagram Business + Meta app | developers.facebook.com | 40 dk |
| TikTok app audit | developers.tiktok.com | başvuru + bekleme |
| GitHub reposu (cron + medya barındırma) | github.com | 5 dk |

Anahtarları **bana gönderme** — doğrudan `.env` dosyasına yaz. Ben `.env`'i
okuyan kodu çalıştırırım, değeri görmem gerekmez.
