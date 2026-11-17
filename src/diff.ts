import type { DotenvEntry } from './parser/dotenv.js';

export interface EnvDiff {
  /** Keys in the template (usually `.env.example`) that the env file lacks. */
  missing: Array<{ key: string; line: number }>;
  /** Keys in the env file that the template does not have. */
  extra: Array<{ key: string; line: number }>;
  /** Keys present in both, but empty in the env file while the template has a value. */
  empty: Array<{ key: string; line: number }>;
  /** Keys present in both files. */
  common: string[];
}

/**
 * Compares the keys of an env file with a template. Values are never
 * compared because a template should not contain real ones.
 */
export function diffEnv(actual: DotenvEntry[], template: DotenvEntry[]): EnvDiff {
  const a = lastByKey(actual);
  const t = lastByKey(template);
  const missing: EnvDiff['missing'] = [];
  const extra: EnvDiff['extra'] = [];
  const empty: EnvDiff['empty'] = [];
  const common: string[] = [];
  for (const [key, entry] of t) {
    const mine = a.get(key);
    if (!mine) missing.push({ key, line: entry.line });
    else {
      common.push(key);
      if (mine.value === '' && entry.value !== '') empty.push({ key, line: mine.line });
    }
  }
  for (const [key, entry] of a) if (!t.has(key)) extra.push({ key, line: entry.line });
  return { missing, extra, empty, common };
}

function lastByKey(entries: DotenvEntry[]): Map<string, DotenvEntry> {
  const map = new Map<string, DotenvEntry>();
  for (const e of entries) map.set(e.key, e);
  return map;
}
