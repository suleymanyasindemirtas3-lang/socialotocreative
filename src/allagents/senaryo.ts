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

    /**
     * Iki gorsel istemi TEK cagrida: biri sahnenin kendisi, digeri yalnizca
     * mekan. Ayri cagri atmak kotadan bosuna yer yerdi.
     */
    const gorselHam = await llm.complete(
      [
        `Konu: ${fikir.topic}`,
        '',
        'Bu haber icin IKI ayri ingilizce gorsel uretim promptu yaz.',
        '  sahne : haberin kendisini anlatan tek cumlelik prompt',
        '  mekan : haberin GORSEL DUNYASINI anlatan tek cumlelik prompt.',
        '',
        '"mekan" icin kurallar:',
        '- Taniinabilir gercek kisi ve yuz OLMASIN.',
        '- Ama BOS ODA da tarif etme. Konuya ait, dolu, renkli bir kare olsun:',
        '  oyun/anime haberinde o eserin gorsel dunyasi (manzara, kostum, esya,',
        '  poster duvari, sahne tasarimi); spor haberinde dolu tribun ve sahanin',
        '  isiklari; muzikte sahne ve isik; teknolojide cihazin yakin cekimi.',
        '- Isik, renk ve doku bakimindan ZENGIN olsun; sonuc video arka plani',
        '  olarak kullanilacak, donuk bir kare ise yaramaz.',
        '',
        'Ikisinde de yazi, metin ya da logo olmasin.',
        '',
        'Yalnizca su semada JSON dondur:',
        '{"sahne":"...","mekan":"..."}',
      ].join('\n'),
      { maxTokens: 300, json: true },
    );

    const gorselNesne = extractObjects(gorselHam)[0] ?? {};
    const visualPrompt =
      String(gorselNesne['sahne'] ?? '').trim() || `Editorial photo illustrating: ${fikir.topic}`;
    const mekanPrompt = String(gorselNesne['mekan'] ?? '').trim();
    const gorselAlan = mekanPrompt ? { mekanPrompt } : {};

    if (!narrationNeeded) return { variants, visualPrompt, ...gorselAlan, metinAdaylari };

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

    return { variants, narration, visualPrompt, ...gorselAlan, metinAdaylari };
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

/**
 * SAHNE BOLUMLEME
 *
 * Seslendirme metnini `adet` bolume ayirir ve HER BOLUM ICIN ayri bir
 * gorsel istemi yazar.
 *
 * ---------------------------------------------------------------------------
 * NEDEN GEREKTI
 *
 * Video uc gorsel gosteriyordu ve ucu de konuyla YALNIZCA GENEL olarak
 * ilgiliydi. Anlatim "Oricon listesinde birinci oldu" derken ekranda
 * konuyla alakali ama o cumleyle alakasiz bir kare duruyordu. Izleyici
 * icin goruntu ile ses ayri iki sey oluyordu; video "izlenecek" bir sey
 * olmuyordu.
 *
 * Artik goruntu metni TAKIP EDIYOR: anlatimin her bolumu icin o bolumde
 * ne anlatiliyorsa onu gosteren bir kare uretiliyor.
 *
 * Tek LLM cagrisi: bolme ve istem yazma ayri istekler olsaydi kota iki
 * katina cikardi.
 * ---------------------------------------------------------------------------
 */
export interface Sahne {
  /** Bu sahnede seslendirilen metin parcasi. */
  bolum: string;
  /** O parcayi anlatan ingilizce gorsel istemi. */
  istem: string;
}

/**
 * Metni `adet` bolume ayirir - CUMLE sinirlarindan, dengeli uzunlukta.
 *
 * Bolme neden kodda: ilk surumde modelden hem bolmesi hem istem yazmasi
 * istenmisti. Model bolum metnini geri yazmak yerine ozetliyordu
 * ("Metnin ilk bolumu: ...") ve uzun cevap token siniriná takilip JSON'u
 * yarida kesiyordu. Bolme kesin bir is; kodda hem bedava hem hatasiz.
 * Modele yalnizca yapabildigi is birakildi: gorseli tarif etmek.
 */
export function metniBol(metin: string, adet: number): string[] {
  const cumleler = metin
    .split(/(?<=[.!?])\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (cumleler.length <= adet) {
    // Cumle sayisi bolum sayisindan azsa her cumle bir bolum olur.
    return cumleler;
  }

  const hedefUzunluk = metin.length / adet;
  const bolumler: string[] = [];
  let biriken = '';

  for (let i = 0; i < cumleler.length; i++) {
    biriken = biriken ? `${biriken} ${cumleler[i]}` : cumleler[i]!;

    const kalanBolum = adet - bolumler.length - 1;
    const kalanCumle = cumleler.length - i - 1;

    /**
     * Bolumu kapatma sarti: hedef uzunluga ulasildi VE geride kalan
     * cumleler kalan bolumleri doldurmaya yetiyor. Ikinci sart olmazsa
     * son bolumler bos kaliyor.
     */
    if (kalanBolum > 0 && biriken.length >= hedefUzunluk && kalanCumle >= kalanBolum) {
      bolumler.push(biriken);
      biriken = '';
    }
  }

  if (biriken) bolumler.push(biriken);

  // Beklenenden az bolum ciktiysa sondan doldurmak yerine oldugu gibi don;
  // cagiran kare sayisini buna gore ayarlar.
  return bolumler;
}

export async function sahneleriYaz(narration: string, adet: number): Promise<Sahne[]> {
  const bolumler = metniBol(narration, adet);
  if (!bolumler.length) throw new Error('anlatim bolunemedi');

  const llm = getLlm();

  const ham = await llm.complete(
    [
      'Bir dikey videonun sahneleri icin gorsel istemi yazacaksin.',
      'Asagida anlatimin bolumleri numarali veriliyor.',
      'HER BOLUM ICIN, O BOLUMDE ANLATILANI gosteren bir ingilizce gorsel',
      'istemi yaz.',
      '',
      ...bolumler.map((b, i) => `${i + 1}. ${b}`),
      '',
      'Kurallar:',
      '- Istem o bolumdeki olayi, yeri, nesneyi ya da ani gostersin;',
      '  konunun genel bir resmi olmasin.',
      '- Taninabilir gercek kisi ya da yuz olmasin.',
      '- Gorselde yazi, harf, rakam ya da logo OLMASIN.',
      '- Istemler birbirinden gorsel olarak farkli olsun.',
      '- Her istem tek cumle, en fazla 30 kelime.',
      /**
       * Isik sarti bilincli: "gercek kisi olmasin" kurali modeli
       * siluete ve karanliga itiyordu. Cikan kareler kompozisyon
       * olarak dogru ama telefon ekraninda camur gibi gorunuyordu -
       * ustune altyazi perdesi de binince hic okunmuyordu.
       */
      '- Sahne AYDINLIK ve net olsun: gunduz isigi, parlak renkler,',
      '  aydinlatilmis ic mekan. Siluet, koyu golge ve gece karanligi YAZMA.',
      /**
       * Sonuc cumleleri ("bu gelisme sunu gosteriyor") somut bir goruntu
       * icermiyor; model bunlari resmetmeye calisinca konudan kopuk,
       * bos kareler cikiyordu. Boyle bolumlerde konunun kendi gorsel
       * dunyasina donmesi soyleniyor.
       */
      '- Bolum soyut bir degerlendirme cumlesiyse onu resmetmeye calisma;',
      '  KONUNUN kendi gorsel dunyasindan carpici bir sahne yaz.',
      /**
       * Kurum yasagi: model "studyo bir uyarlama planliyor" cumlesini
       * birebir okuyup bos bir ofis koridoru ciziyordu. Haberin ozunde
       * kurum degil, kurumun URETTIGI SEY var; izleyiciyi tutan da o.
       */
      '- OFIS, koridor, toplanti odasi, sirket binasi, bos ic mekan YAZMA.',
      '  Haber bir studyodan, sirketten ya da yayincidan bahsetse bile',
      '  onlarin binasini degil URETTIKLERI ESERIN dunyasini goster:',
      '  animenin sahnesi, oyunun manzarasi, konserin sahnesi, macin sahasi.',
      '',
      `Yalnizca su semada JSON dondur (${bolumler.length} istem):`,
      '{"istemler":["birinci sahne","ikinci sahne"]}',
    ].join('\n'),
    { maxTokens: 700, json: true },
  );

  const nesne = extractObjects(ham)[0] ?? {};
  const dizi = Array.isArray(nesne['istemler'])
    ? (nesne['istemler'] as unknown[])
    : Object.values(nesne).filter((v) => typeof v === 'string');

  const istemler = dizi.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  if (!istemler.length) throw new Error('sahne istemleri alinamadi');

  /**
   * Istem sayisi bolum sayisini tutmayabilir; eslesen kadari alinir.
   * Eksik kalan bolum videoda gosterilmez, kare sayisi ona gore duser -
   * yanlis bolume yanlis gorsel koymaktan iyidir.
   */
  return bolumler
    .slice(0, istemler.length)
    .map((bolum, i) => ({ bolum, istem: istemler[i]! }));
}
