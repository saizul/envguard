const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

/**
 * Expands `${VAR}`, `${VAR:-fallback}`, `${VAR-fallback}`, `${VAR:+alt}` and
 * `$VAR` in a value. `\$` produces a literal `$`. Fallbacks may contain
 * references themselves. Unknown variables expand to an empty string and are
 * reported through `onUndefined` (not for references that have a fallback).
 */
export function expandValue(
  value: string,
  lookup: (name: string) => string | undefined,
  onUndefined: (name: string) => void = () => {},
  depth = 0,
): string {
  if (depth > 10) return value;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '\\' && value[i + 1] === '$') {
      out += '$';
      i++;
      continue;
    }
    if (c !== '$') {
      out += c;
      continue;
    }
    const next = value[i + 1];
    if (next === '{') {
      const close = matchingBrace(value, i + 1);
      if (close === -1) {
        out += c;
        continue;
      }
      const body = value.slice(i + 2, close);
      out += expandBraced(body, lookup, onUndefined, depth);
      i = close;
      continue;
    }
    if (next !== undefined && NAME_START.test(next)) {
      let j = i + 1;
      while (j < value.length && NAME_CHAR.test(value[j]!)) j++;
      const name = value.slice(i + 1, j);
      const found = lookup(name);
      if (found === undefined) onUndefined(name);
      out += found ?? '';
      i = j - 1;
      continue;
    }
    out += c;
  }
  return out;
}

function expandBraced(
  body: string,
  lookup: (name: string) => string | undefined,
  onUndefined: (name: string) => void,
  depth: number,
): string {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+=?])([\s\S]*))?$/.exec(body);
  if (!m) return '';
  const name = m[1]!;
  const op = m[2];
  const arg = m[3] ?? '';
  const found = lookup(name);
  const sub = () => expandValue(arg, lookup, onUndefined, depth + 1);
  switch (op) {
    case undefined:
      if (found === undefined) onUndefined(name);
      return found ?? '';
    case ':-':
    case ':=':
      return found === undefined || found === '' ? sub() : found;
    case '-':
    case '=':
      return found === undefined ? sub() : found;
    case ':+':
      return found !== undefined && found !== '' ? sub() : '';
    case '+':
      return found !== undefined ? sub() : '';
    default:
      // ${VAR:?message} and ${VAR?message}: the value or nothing.
      if (found === undefined) onUndefined(name);
      return found ?? '';
  }
}

function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
