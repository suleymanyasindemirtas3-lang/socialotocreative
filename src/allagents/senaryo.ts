import { log } from '../core/logger.ts';
import { brandVoice } from '../core/brand.ts';
import { getLlm } from '../providers/llm/index.ts';
import { inspect, tidy } from './quality.ts';
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

      let clean = tidy(
        await llm.complete(
          [
            ...konu,
            `Platform: ${p.id}. Metin ${hedef} karakteri gecmesin (kesin ust sinir ${p.limit}).`,
            'Tek bir post metni yaz. Aciklama, baslik, tirnak ya da secenek sunma.',
            'Haber basligini OLDUGU GIBI kopyalama; ozetteki bilgiyi kullanarak kendi cumleni kur.',
            'Ozette olmayan sayi, isim ya da iddia UYDURMA.',
            'Metin TURKCE olsun. Kaynak ingilizce olsa bile birebir cevirme, ' +
            'Turk okuyucuya gore yerellestir. Ozel isimleri (film, oyun, sanatci, ' +
            'marka) orijinal haliyle birak.',
          ].join('\n'),
          { system: voice, maxTokens: 700 },
        ),
      );

      // Yine tasarsa bir kez kisaltmasini iste; bastan uretmekten hem ucuz
      // hem de zaten begenilen fikri koruyor.
      if (clean.length > p.limit) {
        log.warn(`${p.id}: ${clean.length} karakter, kisaltiliyor`);
        const kisa = tidy(
          await llm.complete(
            [
              'Asagidaki metni anlamini ve iddiasini koruyarak kisalt.',
              `En fazla ${hedef} karakter olmali. Sadece kisaltilmis metni yaz.`,
              '',
              clean,
            ].join('\n'),
            { system: voice, maxTokens: 500 },
          ),
        );
        if (kisa && kisa.length <= p.limit) clean = kisa;
      }

      const issues = inspect(clean, p.limit, fikir.topic);
      if (issues.length) {
        throw new Error(`kalite kapisi (${p.id}): ${issues.map((i) => `${i.code}=${i.detail}`).join(', ')}`);
      }
      variants[p.id] = clean;

      /**
       * Ikinci ve ucuncu aday: ayni haber farkli acilarla yazilabilir ve
       * hangisinin tutacagi onceden belli degil. Kullaniciya secenek sunmak
       * tek metin dayatmaktan iyi; sosyal medya uzmani hepsini puanliyor.
       */
      const adaylar: { metin: string }[] = [];
      for (const aci of ['soru sorarak tartisma baslatan', 'carpici bir sayi ya da iddiayla acan']) {
        try {
          const alt = tidy(
            await llm.complete(
              [
                ...konu,
                `Platform: ${p.id}. Metin ${hedef} karakteri gecmesin.`,
                `Bu sefer ${aci} bir versiyon yaz.`,
                'Onceki versiyonu tekrarlama. Sadece post metnini yaz.',
              ].join('\n'),
              { system: voice, maxTokens: 600 },
            ),
          );
          if (alt && alt.length <= p.limit && !inspect(alt, p.limit, fikir.topic).length) adaylar.push({ metin: alt });
        } catch (e) {
          log.warn(`aday uretilemedi (${p.id}): ${String(e).slice(0, 70)}`);
        }
      }
      if (adaylar.length) metinAdaylari[p.id] = adaylar;
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
