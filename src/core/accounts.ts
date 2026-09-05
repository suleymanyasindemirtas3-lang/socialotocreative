import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Account, AccountStore } from './types.ts';

/**
 * Hesaplar kimlik bilgisi tasir; kuyrugun aksine ASLA repoya girmez.
 * data/accounts.json .gitignore icindedir. GitHub Actions'ta tek bir
 * ACCOUNTS_JSON secret'indan yeniden yazilir.
 */
export class JsonAccountStore implements AccountStore {
  readonly file: string;

  constructor(file = 'data/accounts.json') {
    this.file = file;
  }

  private async read(): Promise<Account[]> {
    // Actions gibi dosyasiz ortamlarda tek secret'tan beslenebilsin.
    const inline = process.env['ACCOUNTS_JSON'];
    if (inline) {
      try {
        return JSON.parse(inline) as Account[];
      } catch {
        return [];
      }
    }
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Account[];
    } catch {
      return [];
    }
  }

  private async write(accounts: Account[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(accounts, null, 2) + '\n', 'utf8');
  }

  all() {
    return this.read();
  }

  async get(id: string) {
    return (await this.read()).find((a) => a.id === id);
  }

  async upsert(a: Account) {
    const list = await this.read();
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) list[i] = a;
    else list.push(a);
    await this.write(list);
  }

  async remove(id: string) {
    await this.write((await this.read()).filter((a) => a.id !== id));
  }
}

export const accounts: AccountStore = new JsonAccountStore();

/** Yayina uygun hesaplar: acik olanlar. */
export async function enabledAccounts(): Promise<Account[]> {
  return (await accounts.all()).filter((a) => a.enabled);
}

/** Panele ve loglara giderken gizli alanlari maskeler. */
export function redact(a: Account): Account {
  return {
    ...a,
    credentials: Object.fromEntries(
      Object.entries(a.credentials).map(([k, v]) => [k, v ? '••••••' + v.slice(-4) : '']),
    ),
  };
}
