/**
 * Survival-time leaderboard, persisted automatically after each run.
 *
 * Storage is injected so tests use memory and the browser uses
 * localStorage. A broken or full store degrades to memory silently.
 */

export const RECORDS_STORAGE_KEY = 'space_dodge_30s.records.v1';
const MAX_ENTRIES = 10;

export function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

export class RecordBook {
  /**
   * @param {{storage?: {getItem, setItem, removeItem}, now?: () => Date}} [options]
   */
  constructor(options = {}) {
    this.storage = options.storage ?? createMemoryStorage();
    this.now = options.now ?? (() => new Date());
    this.data = this.#load();
  }

  /** Insert a finished run; returns the entry with its 1-based rank (0 if unranked). */
  add({ seconds, nearMisses = 0, dodged = 0 }) {
    const entry = {
      seconds: Number(seconds),
      nearMisses: Number(nearMisses),
      dodged: Number(dodged),
      at: this.now().toISOString(),
    };
    this.data.totalRuns += 1;
    this.data.entries.push(entry);
    this.data.entries.sort((a, b) => b.seconds - a.seconds);
    this.data.entries = this.data.entries.slice(0, MAX_ENTRIES);
    this.#save();
    const rank = this.data.entries.indexOf(entry) + 1;
    return { ...entry, rank };
  }

  bestSeconds() {
    return this.data.entries[0]?.seconds ?? 0;
  }

  list() {
    return this.data.entries.map((entry, index) => ({ rank: index + 1, ...entry }));
  }

  totalRuns() {
    return this.data.totalRuns;
  }

  clear() {
    this.data = { entries: [], totalRuns: 0 };
    this.#save();
  }

  #load() {
    try {
      const raw = this.storage.getItem(RECORDS_STORAGE_KEY);
      if (!raw) return { entries: [], totalRuns: 0 };
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.filter((e) => Number.isFinite(Number(e?.seconds)))
        : [];
      return { entries, totalRuns: Number(parsed.totalRuns) || entries.length };
    } catch {
      return { entries: [], totalRuns: 0 };
    }
  }

  #save() {
    try {
      this.storage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode or quota: keep the in-memory board.
    }
  }
}
