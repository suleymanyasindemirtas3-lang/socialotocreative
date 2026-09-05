import { gundemTopla, sourceRegistry, type TrendItem } from '../kaynaklar/index.ts';
import type { Agent } from './types.ts';

/**
 * GUNDEM TOPLAYICI
 *
 * Dis dunyayla konusan tek ajan. Hacker News, GitHub, dev.to ve RSS
 * kaynaklarindan gercek gundemi toplar.
 *
 * Neden ayri bir ajan: onceden icerik-bulma kendi basina internete
 * uzaniyordu. Dis bagimliligi tek bir ajanda toplamak iki sey saglar:
 *   - kaynak coktugunde nerede oldugu belli olur
 *   - baska ajanlar da ayni gundemi isteyebilir, herkes kendi istek atmaz
 */
export const gundemToplayici: Agent<{ adet: number }, TrendItem[]> = {
  id: 'gundem-toplayici',
  role: 'Dis kaynaklardan gercek gundemi toplar',
  uses: Object.keys(sourceRegistry),

  async run({ adet }): Promise<TrendItem[]> {
    return gundemTopla(adet);
  },
};
