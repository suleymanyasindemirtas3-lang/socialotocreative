"""Edge TTS - ses + KELIME ZAMANLAMALARI.

Neden ayri bir dosya: `python -m edge_tts` komut satiri yalnizca cumle
sinirlarini veriyor. Altyazinin konusmayla birlikte kelime kelime
yazilabilmesi icin kelime zamanlamalari gerekiyor; onu yalnizca kutuphane
arayuzu `boundary="WordBoundary"` ile veriyor.

Kullanim:
    python edge_kelime.py <cikti.mp3> <ses> <hiz> <metin-dosyasi>

Metin dosyadan okunur; komut satirindan gecirilince Turkce karakterler
Windows konsol kod sayfasinda bozuluyordu.

Cikti:
    <cikti.mp3>            ses
    <cikti.mp3>.kelime.json  [{"t": baslangic_sn, "d": sure_sn, "k": kelime}]
"""

import asyncio
import json
import sys

import edge_tts


async def main() -> int:
    if len(sys.argv) < 5:
        print("kullanim: edge_kelime.py <cikti.mp3> <ses> <hiz> <metin-dosyasi>", file=sys.stderr)
        return 2

    cikti, ses, hiz, metin_dosyasi = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

    with open(metin_dosyasi, encoding="utf-8") as f:
        metin = f.read().strip()

    if not metin:
        print("metin bos", file=sys.stderr)
        return 2

    iletisim = edge_tts.Communicate(metin, ses, rate=hiz, boundary="WordBoundary")

    kelimeler = []
    with open(cikti, "wb") as f:
        async for parca in iletisim.stream():
            if parca["type"] == "audio":
                f.write(parca["data"])
            elif parca["type"] == "WordBoundary":
                kelimeler.append(
                    {
                        # edge-tts 100 nanosaniyelik birim kullaniyor.
                        "t": round(parca["offset"] / 10_000_000, 3),
                        "d": round(parca["duration"] / 10_000_000, 3),
                        "k": parca["text"],
                    }
                )

    with open(cikti + ".kelime.json", "w", encoding="utf-8") as f:
        json.dump(kelimeler, f, ensure_ascii=False)

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
