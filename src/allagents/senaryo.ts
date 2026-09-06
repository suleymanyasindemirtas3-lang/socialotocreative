import { log } from '../core/logger.ts';
import { brandVoice } from '../core/brand.ts';
import { getLlm } from '../providers/llm/index.ts';
import { inspect, tidy } from './quality.ts';
import { extractObjects } from '../core/json.ts';
import type { Agent, Senaryo, SenaryoIstegi } from './types.ts';

/**
 * 5. SENARYO
 *
 * Fikri metne cevirir. Uc ayri cikti uretir cunku ucu ayri dilde yazilir:
 *   - post metni : platform basina, karakter siniri sert
 *   - seslendirme: konusma dili; caption'i sesli okumak izleyiciyi kaybettiriyor
 *   - gorsel istemi: ingilizce, gorsel betimleme
 *
 * Kalite kapisi burada calisir: cop metin sonraki ajanlara hic gecmez,
 * boylece bosuna ses ve video uretilmez.
 */
export const senaryo: Agent<SenaryoIstegi, Senaryo> = {
  id: 'senaryo',
  role: 'Post metni, seslendirme metni ve gorsel istemi yazar',
  uses: ['llm'],

  async run({ fikir, platforms, narrationNeeded, kategori }): Promise<Senaryo> {
    const llm = getLlm();
    const voice = await brandVoice();
    const konu = [
      `Konu: ${fikir.topic}`,
      fikir.angle ? `Bakis acisi: ${fikir.angle}` : '',
      // Haberin ozeti modelin elindeki tek gercek bilgi kaynagi. Olmadan
      // basligi yeniden yazmaktan oteye gidemiyordu.
      fikir.kaynak?.ozet
        ? `HABERIN OZETI (yalnizca buradaki bilgileri kullan, ekleme yapma):
${fikir.kaynak.ozet}`
        : '',
      // Kategori yonergesi bicimi belirler; markanin sesi ustune biner.
      kategori ? `BICIM (${kategori.ad}): ${kategori.yonerge}` : '',
    ].filter(Boolean);

    const variants: Record<string, string> = {};
    const metinAdaylari: Record<string, { metin: string }[]> = {};
    for (const p of platforms) {
      /**
       * Modele sinirin biraz altini hedef gosteriyoruz. Tam siniri soyleyince
       * surekli birkac karakter tasiyor ve iyi bir metin 2-3 karakter yuzunden
       * cope gidiyordu.
       */
      const hedef = Math.max(80, Math.floor(p.limit * 0.9));

      /**
       * UC VERSIYON TEK CAGRIDA.
       *
       * Onceden her versiyon ayri istek atiyordu: platform basina 3 cagri,
       * artı gorsel istemi ve seslendirme ile post basina 7-8 cagri.
       * Ucretsiz kotalarda (Groq gunde 1000 istek) bu ~125 post demekti.
       *
       * Uc versiyonu tek istemde toplamak hem kotayi ucte bire indiriyor
       * hem de modele "birbirinden farkli olsunlar" demeyi mumkun kiliyor -
       * ayri cagrilarda model onceki versiyonu gormedigi icin benzer
       * metinler uretebiliyordu.
       */
      const ham = await llm.complete(
        [
          ...konu,
          `Platform: ${p.id}. Her metin ${hedef} karakteri gecmesin (kesin ust sinir ${p.limit}).`,
          '',
          'BIRBIRINDEN FARKLI UC VERSIYON yaz:',
          '  1. duz anlatim, bilgiyi net veren',
          '  2. soru sorarak tartisma baslatan',
          '  3. carpici bir sayi ya da iddiayla acan',
          '',
          'Kurallar:',
          '- Haber basligini OLDUGU GIBI kopyalama; ozetteki bilgiyle kendi cumleni kur.',
          '- Ozette olmayan sayi, isim ya da iddia UYDURMA.',
          '- TURKCE yaz. Kaynak ingilizce olsa bile birebir cevirme, Turk okuyucuya',
          '  gore yerellestir. Ozel isimleri (film, oyun, sanatci, marka) orijinal birak.',
          '- Uc versiyon birbirine benzemesin.',
          '',
          'Yalnizca su semada JSON dondur:',
          '{"versiyonlar":["birinci metin","ikinci metin","ucuncu metin"]}',
        ].join('\n'),
        { system: voice, maxTokens: 1200, json: true },
      );

      const nesne = extractObjects(ham)[0] ?? {};
      const dizi = Array.isArray(nesne['versiyonlar'])
        ? (nesne['versiyonlar'] as unknown[])
        : Object.values(nesne).filter((v) => typeof v === 'string');

      const temizler = dizi
        .filter((v): v is string => typeof v === 'string')
        .map((v) => tidy(v))
        .filter((v) => v.length > 0);

      if (!temizler.length) throw new Error(`${p.id}: model versiyon uretmedi`);

      // Kalite kapisindan gecenler; en az biri gecmeliyse post yasar.
      const gecenler = temizler.filter((v) => !inspect(v, p.limit, fikir.topic, fikir.kaynak?.ozet).length);

      if (!gecenler.length) {
        const ilkSorun = inspect(temizler[0]!, p.limit, fikir.topic, fikir.kaynak?.ozet);
        throw new Error(
          `kalite kapisi (${p.id}): ${ilkSorun.map((i) => `${i.code}=${i.detail}`).join(', ')}`,
        );
      }

      variants[p.id] = gecenler[0]!;
      const adaylar = gecenler.slice(1).map((metin) => ({ metin }));
      if (adaylar.length) metinAdaylari[p.id] = adaylar;
      log.info(`${p.id}: ${temizler.length} versiyon uretildi, ${gecenler.length} gecti`);
    }

    const visualPrompt = (
      await llm.complete(
        `Su post icin ingilizce, tek cumlelik bir gorsel uretim promptu yaz. Metin/yazi icermesin.\n\n${fikir.topic}`,
        { maxTokens: 120 },
      )
    ).trim();

    if (!narrationNeeded) return { variants, visualPrompt, metinAdaylari };

    const narration = tidy(
      await llm.complete(
        [
          ...konu,
          'Bu konuyu 30-40 saniyede anlatan bir seslendirme metni yaz.',
          'Konusma dili kullan. Tek fikri ac ve somut bitir.',
          'Sadece seslendirilecek metni yaz; sahne yonergesi, baslik ya da etiket yazma.',
        ].join('\n'),
        { system: voice, maxTokens: 500 },
      ),
    );

    return { variants, narration, visualPrompt, metinAdaylari };
  },
};

/**
 * Yalnizca seslendirme metni uretir.
 *
 * Neden ayri: metin ilk yazildiginda hedef platform video istemiyorsa
 * seslendirme uretilmiyor. Kullanici sonradan panelden "video" secince
 * senaryoda seslendirme olmuyor ve uretim cokuyordu. Tercih degisimi
 * kendi kendini onarabilmeli.
 */
export async function seslendirmeYaz(fikir: { topic: string; angle?: string }): Promise<string> {
  const llm = getLlm();
  return tidy(
    await llm.complete(
      [
        `Konu: ${fikir.topic}`,
        fikir.angle ? `Bakis acisi: ${fikir.angle}` : '',
        'Bu konuyu 30-40 saniyede anlatan bir seslendirme metni yaz.',
        'Konusma dili kullan. Tek fikri ac ve somut bitir.',
        'Sadece seslendirilecek metni yaz; sahne yonergesi, baslik ya da etiket yazma.',
      ].filter(Boolean).join('\n'),
      { system: await brandVoice(), maxTokens: 500 },
    ),
  );
}
