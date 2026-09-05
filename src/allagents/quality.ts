/**
 * Kalite kapisi: LLM ciktisini yayin oncesi eler.
 * Motto 2'nin devami — supheli icerik sessizce gecmez, taslak reddedilir.
 */

export interface QualityIssue {
  code: string;
  detail: string;
}

/** Model kendini ele veren kaliplar. Tamami tek satirda yakalanir. */
const TELLTALES: [RegExp, string][] = [
  [/\b(bir yapay zek[aâ]|as an ai|bir dil modeli|language model)\b/i, 'model kendinden bahsediyor'],
  [/\b(elbette|tabii ki|iste|here is|sure,)[!,. ]/i, 'asistan girisi sizmis'],
  [/^(post|metin|cikti|output|tweet)\s*[:：]/i, 'etiketli cikti'],
  [/\[(ekle|buraya|insert|your|placeholder)[^\]]*\]/i, 'doldurulmamis yer tutucu'],
  [/\b(lorem ipsum)\b/i, 'yer tutucu metin'],
  [/```/, 'kod bloğu isareti'],
  [/\bhttps?:\/\/(example\.com|link\.buraya)/i, 'sahte link'],
];

export function inspect(text: string, limit: number): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const t = text.trim();

  if (t.length < 40) issues.push({ code: 'too_short', detail: `${t.length} karakter` });
  if (t.length > limit) issues.push({ code: 'too_long', detail: `${t.length} > ${limit}` });

  for (const [re, detail] of TELLTALES) {
    if (re.test(t)) issues.push({ code: 'telltale', detail });
  }

  // Model bazen 2-3 secenek uretip hepsini birden dondurur.
  if (/^\s*(secenek|option|varyant|alternatif)\s*\d/im.test(t)) {
    issues.push({ code: 'multiple_options', detail: 'tek metin yerine secenek listesi' });
  }

  // Ayni cumleyi tekrarlayan cikti (kucuk modellerde sik).
  const sentences = t.split(/[.!?\n]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 15);
  if (sentences.length > 2 && new Set(sentences).size < sentences.length) {
    issues.push({ code: 'repetition', detail: 'tekrar eden cumle' });
  }

  const hashtags = t.match(/#\w+/g) ?? [];
  if (hashtags.length > 2) issues.push({ code: 'hashtag_spam', detail: `${hashtags.length} hashtag` });

  return issues;
}

/** Modelin sikca ekledigi cerceve metnini kirpar. Elemeden once denenir. */
export function tidy(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  t = t.replace(/^(post|metin|cikti|output|tweet)\s*[:：]\s*/i, '');
  t = t.replace(/^["'“”«]|["'“”»]$/g, '');
  return t.trim();
}
