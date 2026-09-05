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

  async run({ fikir, platforms, narrationNeeded }): Promise<Senaryo> {
    const llm = getLlm();
    const voice = await brandVoice();
    const konu = [`Konu: ${fikir.topic}`, fikir.angle ? `Bakis acisi: ${fikir.angle}` : ''].filter(Boolean);

    const variants: Record<string, string> = {};
    for (const p of platforms) {
      const text = await llm.complete(
        [
          ...konu,
          `Platform: ${p.id}. Kesin ust sinir: ${p.limit} karakter.`,
          'Tek bir post metni yaz. Aciklama, baslik, tirnak ya da secenek sunma.',
        ].join('\n'),
        { system: voice, maxTokens: 700 },
      );

      const clean = tidy(text);
      const issues = inspect(clean, p.limit);
      if (issues.length) {
        throw new Error(`kalite kapisi (${p.id}): ${issues.map((i) => `${i.code}=${i.detail}`).join(', ')}`);
      }
      variants[p.id] = clean;
    }

    const visualPrompt = (
      await llm.complete(
        `Su post icin ingilizce, tek cumlelik bir gorsel uretim promptu yaz. Metin/yazi icermesin.\n\n${fikir.topic}`,
        { maxTokens: 120 },
      )
    ).trim();

    if (!narrationNeeded) return { variants, visualPrompt };

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

    return { variants, narration, visualPrompt };
  },
};
