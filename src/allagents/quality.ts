/**
 * Kalite kapisi: LLM ciktisini yayin oncesi eler.
 * Motto 2'nin devami — supheli icerik sessizce gecmez, taslak reddedilir.
 *
 * ---------------------------------------------------------------------------
 * MUDAHALE NOKTASI — "Bu metin nasil yayina gitmis?" dersen buraya kural ekle.
 *
 * TELLTALES dizisine [desen, aciklama] cifti ekle; yakalanan taslak reddedilir
 * ve `npm run retry` ile yeniden uretilir.
 *
 * Tersi de gecerli: kapi cok siki elerse (surekli 'failed' goruyorsan)
 * buradaki bir kurali gevset. `npm run status` hangi kurala takildigini yazar.
 * ---------------------------------------------------------------------------
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
  // Sosyal medya markdown islemez; **kalin** ve ## baslik ekranda ham gorunur.
  // Panelde yayinlanmis bir postta "**Aciklama:**" goruldugu icin eklendi.
  [/\*\*[^*]+\*\*|^#{1,6}\s/m, 'markdown isareti (sosyal medya islemez)'],
  [/^\s*[-*]\s+.*\n\s*[-*]\s+/m, 'madde listesi (post degil, not gibi duruyor)'],
];

/**
 * Iki metnin kelime ortusmesi (0-1). Baslik kopyasini yakalamak icin.
 */
function ortusme(a: string, b: string): number {
  const kelime = (t: string) =>
    new Set(
      t.toLocaleLowerCase('tr')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const A = kelime(a);
  const B = kelime(b);
  if (!A.size || !B.size) return 0;
  let kesisim = 0;
  for (const w of A) if (B.has(w)) kesisim++;
  return kesisim / Math.min(A.size, B.size);
}

/**
 * UYDURMA TESPITI.
 *
 * Gercek bir vakadan dogdu: "oyun" kategorisinin yonergesi "fiyat ve cikis
 * tarihi varsa MUTLAKA belirt" diyordu. Kaynakta bu bilgiler olmayinca model
 * uydurdu - bir DIZI haberine "15 Mayis 2023'te 49,99 TL'ye cikti" ekledi.
 *
 * Haber hesabi icin en tehlikeli hata bu. Metindeki sayilar kaynakta da
 * geciyor mu diye bakiyoruz: gecmiyorsa uydurma suphesi var.
 *
 * Yil, yuzde ve kucuk sayilar (1-2 haneli) haric tutuluyor - onlar cumle
 * icinde dogal olarak geciyor ve yanlis alarm uretiyor.
 */
function uydurmaSayilar(metin: string, kaynak: string): string[] {
  const sayiCikar = (t: string) =>
    (t.match(/\d[\d.,]*/g) ?? [])
      .map((x) => x.replace(/[.,]$/, ''))
      .filter((x) => x.replace(/\D/g, '').length >= 3);

  const kaynakSayilar = new Set(sayiCikar(kaynak).map((x) => x.replace(/\D/g, '')));
  return sayiCikar(metin).filter((x) => !kaynakSayilar.has(x.replace(/\D/g, '')));
}

export function inspect(
  text: string,
  limit: number,
  kaynakBaslik?: string,
  kaynakOzet?: string,
): QualityIssue[] {
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

  /**
   * BASLIK KOPYASI.
   * Zayif modeller haber basligini oldugu gibi yapistiriyor. Bu post degil,
   * RSS yankisi: ne katma deger var ne ozgunluk. Ustelik ayni basligi
   * paylasan yuzlerce hesap arasinda kaybolur.
   */
  if (kaynakBaslik) {
    /**
     * Kopya olmak icin hem kelimeler ortusmeli HEM uzunluk yakin olmali.
     * Yalniz ortusmeye bakmak yanlis alarm uretiyordu: kisa bir basligin
     * kelimeleri uzun ve ozgun bir metinde dogal olarak geciyor ve
     * "%100 ayni" cikiyordu. Metin baslikta 1.4 katindan uzunsa artik
     * kopya degil, uzerine yazilmis demektir.
     */
    const oran = ortusme(t, kaynakBaslik);
    const uzunlukOrani = t.length / Math.max(1, kaynakBaslik.length);
    if (oran > 0.8 && uzunlukOrani < 1.4) {
      issues.push({
        code: 'baslik_kopyasi',
        detail: `kaynak basligiyla %${Math.round(oran * 100)} ayni`,
      });
    }
  }

  // Kaynakta olmayan sayilar: fiyat, tarih, surum uydurmasi.
  if (kaynakOzet) {
    const uydurma = uydurmaSayilar(t, `${kaynakBaslik ?? ''} ${kaynakOzet}`);
    if (uydurma.length) {
      issues.push({
        code: 'kaynakta_olmayan_sayi',
        detail: `kaynakta gecmeyen sayi: ${uydurma.slice(0, 3).join(', ')}`,
      });
    }
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
