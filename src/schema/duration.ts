const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parses a duration such as `250ms`, `30s`, `5m`, `1h30m`, `1.5h` or `2d`
 * into milliseconds. A plain number is read as milliseconds. Returns
 * `undefined` for anything else.
 */
export function parseDuration(input: string): number | undefined {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const re = /(\d+(?:\.\d+)?)(ms|sec|min|hr|s|m|h|d|w)/gy;
  let total = 0;
  let consumed = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    total += Number(m[1]) * UNITS[m[2]!]!;
    consumed = re.lastIndex;
  }
  if (consumed !== s.length || consumed === 0) return undefined;
  return Math.round(total);
}

/** Formats milliseconds as the shortest duration string, e.g. `90000` -> `1m30s`. */
export function formatDuration(ms: number): string {
  if (ms === 0) return '0ms';
  const parts: string[] = [];
  let rest = ms;
  for (const [unit, size] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
  ] as const) {
    if (rest >= size) {
      const n = Math.floor(rest / size);
      parts.push(`${n}${unit}`);
      rest -= n * size;
    }
  }
  if (rest > 0) parts.push(`${rest}ms`);
  return parts.join('');
}
