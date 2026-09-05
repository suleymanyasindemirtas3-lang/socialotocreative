/**
 * LLM ciktisindan nesne dizisi cikarir.
 * Kucuk modeller sozu verilen semayi tutturamaz; gordugumuz gercek varyantlar:
 *   [{...}]                      dogru sema
 *   {...}                        tek nesne, dizi degil
 *   {"ideas":[{...}]}            sarmalanmis dizi (format:json sikca boyle doner)
 *   ```json\n[...]\n```          kod bloguna sarilmis
 *   {...}\n{...}                 satir satir nesneler
 * Hepsini tek yerde normalize etmek, her cagiran yerde ayri savunma yazmaktan iyidir.
 */
export function extractObjects(raw: string): Record<string, unknown>[] {
  const text = raw.replace(/```[a-z]*\n?/gi, '').trim();

  const asArray = (v: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      // Sarmalanmis dizi: tek bir dizi degeri varsa onu ac.
      const arrays = Object.values(obj).filter(Array.isArray) as unknown[][];
      if (arrays.length === 1 && arrays[0]) {
        return arrays[0].filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
      }
      return [obj];
    }
    return null;
  };

  // 1) Tumunu tek parca olarak dene.
  try {
    const parsed = asArray(JSON.parse(text));
    if (parsed?.length) return parsed;
  } catch {
    /* siradaki stratejiye gec */
  }

  // 2) Ilk [ ... ] blogunu dene.
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a >= 0 && b > a) {
    try {
      const parsed = asArray(JSON.parse(text.slice(a, b + 1)));
      if (parsed?.length) return parsed;
    } catch {
      /* siradaki stratejiye gec */
    }
  }

  // 3) Metne serpistirilmis tekil { ... } nesnelerini tara.
  const out: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const o = JSON.parse(text.slice(start, i + 1)) as unknown;
          if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o as Record<string, unknown>);
        } catch {
          /* bozuk parcayi atla */
        }
        start = -1;
      }
    }
  }
  return out;
}

export function str(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
