import { ParsedAlert, SpendCategory, categorize, parseAlerts } from './alertParser';

/**
 * On-device money ledger. Deliberately separate from OfflineSyncEngine:
 * nothing here goes into the outbox or to the server.
 */

export interface LedgerEntry extends ParsedAlert {
  manualCategory?: boolean; // user picked the category, so threshold changes leave it alone
  fuelLoggedToGen?: boolean;
}

const KEYS = {
  LEDGER: 'howfar_v1_money_ledger',
  THRESHOLD: 'howfar_v1_urgent_threshold'
};

const MAX_ENTRIES = 1500; // ~ a few months of alerts; oldest drop off first

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[MoneyLedger] could not save:', err);
  }
}

export class MoneyLedger {
  static getEntries(): LedgerEntry[] {
    return read<LedgerEntry[]>(KEYS.LEDGER, []);
  }

  static saveEntries(entries: LedgerEntry[]): void {
    const sorted = [...entries].sort((a, b) => b.occurredAtIso.localeCompare(a.occurredAtIso));
    write(KEYS.LEDGER, sorted.slice(0, MAX_ENTRIES));
  }

  static getUrgentThreshold(): number {
    return read<number>(KEYS.THRESHOLD, 5000);
  }

  static setUrgentThreshold(value: number): LedgerEntry[] {
    write(KEYS.THRESHOLD, value);
    // Re-sort small vs large transfers under the new limit, keeping manual choices
    const updated = this.getEntries().map((e) => {
      if (e.manualCategory || (e.category !== 'URGENT_2K' && e.category !== 'TRANSFER')) return e;
      return { ...e, category: categorize(e.direction, e.amountNgn, e.narration, value) };
    });
    this.saveEntries(updated);
    return this.getEntries();
  }

  /** Parses pasted text and adds new alerts, skipping any already in the ledger. */
  static importText(raw: string): {
    entries: LedgerEntry[];
    added: LedgerEntry[];
    duplicates: number;
    unreadable: number;
  } {
    const existing = this.getEntries();
    const seen = new Set(existing.map((e) => e.fingerprint));
    const { parsed, unreadable } = parseAlerts(raw, this.getUrgentThreshold());

    const added: LedgerEntry[] = [];
    let duplicates = 0;
    for (const p of parsed) {
      if (seen.has(p.fingerprint)) {
        duplicates++;
        continue;
      }
      seen.add(p.fingerprint);
      added.push({ ...p, id: `${p.fingerprint}-${Date.now().toString(36)}-${added.length}` });
    }

    this.saveEntries([...added, ...existing]);
    return { entries: this.getEntries(), added, duplicates, unreadable: unreadable.length };
  }

  static setCategory(id: string, category: SpendCategory): LedgerEntry[] {
    this.saveEntries(
      this.getEntries().map((e) => (e.id === id ? { ...e, category, manualCategory: true } : e))
    );
    return this.getEntries();
  }

  static markFuelLogged(id: string): LedgerEntry[] {
    this.saveEntries(
      this.getEntries().map((e) => (e.id === id ? { ...e, fuelLoggedToGen: true } : e))
    );
    return this.getEntries();
  }

  static remove(id: string): LedgerEntry[] {
    this.saveEntries(this.getEntries().filter((e) => e.id !== id));
    return this.getEntries();
  }

  static clearAll(): LedgerEntry[] {
    write(KEYS.LEDGER, []);
    return [];
  }
}
