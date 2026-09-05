# Ana Mottolar

Bu projede verilen her karar bu yedi maddeden birine dayanır. Yeni bir özellik
eklemeden önce hangi maddeye hizmet ettiğini söyleyebiliyor olman gerekir.

---

## 1. Sağlayıcı bağlamaz, arayüz bağlar

Hiçbir yerde `fetch("https://api.openai.com/...")` doğrudan yazılmaz. LLM, görsel,
depolama ve platform — dördü de `src/core/types.ts` içindeki arayüzlerin arkasında.

**Sonuç:** ücretsizden ücretliye geçiş bir `.env` satırı. `LLM_PROVIDER=gemini` →
`LLM_PROVIDER=claude`. Tek satır kod değişmez. "0 maliyet zorunlu ama ücretli
opsiyon değerlendirilebilir" şartı mimariye böyle gömülür, sonradan eklenmez.

## 2. Varsayılan güvenli

`DRY_RUN=true` ve `AUTO_APPROVE=false` fabrika ayarı. Yani projeyi klonlayıp
yanlışlıkla çalıştıran biri hiçbir yere hiçbir şey paylaşmaz. Zarar vermek için
açık bir hamle gerekir; zarardan kaçınmak için hiçbir şey gerekmez.

## 3. İnsan kapısı silinmez, sadece kapatılır

Telegram onayı devre dışı bırakılabilir ama koddan kaldırılmaz. Otomasyona
güvenin arttığında `AUTO_APPROVE=true` yaparsın; iş ters gittiğinde aynı satırı
geri alıp kontrolü anında geri alırsın. Kill-switch her zaman elinin altında.

## 4. Sıfır altyapı

Sunucu yok, veritabanı yok, kuyruk servisi yok. Durum `data/queue.json` içinde,
compute GitHub Actions cron'unda. Aylık maliyet: 0. Büyüdüğünde `Store` arayüzüne
`SupabaseStore` yazılır — çağıran hiçbir kod değişmez (bkz. Motto 1).

## 5. Idempotent ve tekrarsız

Aynı post aynı platforma iki kez gitmez (`results` kontrolü). Aynı fikir iki kez
üretilmez (`fingerprint` dedup). Cron'un aynı işi ikinci kez çalıştırması zararsız
olmalı — çünkü er ya da geç çalıştıracak.

## 6. Sadece resmi API

Tarayıcı otomasyonu, scraping, gizli endpoint yok. Bunlar ToS ihlali ve hesap
kaybı demek. Bir platformun resmi API'si yoksa o platform bu projede yok.

## 7. Kalite prompt'tan gelir, koddan değil

`content/brand.md` bu projenin en değerli dosyası. Kodun ne kadar temiz olduğu
içeriğin kalitesini belirlemez; marka sesi belirler. Zamanın çoğunu oraya ayır.

## 8. Tek sağlayıcıya bağımlı kalma

`LLM_PROVIDER` bir zincirdir: `ollama,pollinations,gemini`. İlki çökerse ya da
kotasını doldurursa sıradakine geçilir. Ücretsiz uçlar tanım gereği güvenilmezdir;
mimari bunu bir arıza değil, normal işletme koşulu olarak kabul eder.

Zincire `mock` **koyma**. Sağlayıcıların hepsi düştüğünde hat gürültüyle durmalı,
sessizce çöp içerik yayınlamamalı — bu Motto 2'nin devamıdır.

---

## Teknik kısıtlar

- **Strip-only TypeScript.** Node `.ts` dosyalarını doğrudan çalıştırır, tipleri
  siler. Bu yüzden `enum`, `namespace` ve constructor parametre özelliği
  (`constructor(private x)`) kullanılamaz. `interface` ve `type` serbest.
- **Sıfır runtime bağımlılığı hedefi.** Şu an tek bağımlılık `@atproto/api`.
  HTTP için `fetch`, env için `--env-file`, hepsi Node yerleşiği.
- **Yeni platform = tek dosya.** `src/platforms/x.ts` yaz, `index.ts` dizisine ekle.
  Başka hiçbir yer değişmez.
