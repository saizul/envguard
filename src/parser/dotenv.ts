import { expandValue } from './expand.js';

/** How a value was written in the file. */
export type QuoteStyle = 'none' | 'single' | 'double' | 'backtick';

/** One `KEY=value` assignment found in a .env file. */
export interface DotenvEntry {
  key: string;
  /** The value after unquoting, escape handling and (when enabled) expansion. */
  value: string;
  /** The value exactly as it appeared after `=` (without the trailing comment). */
  raw: string;
  quote: QuoteStyle;
  /** 1-based line of the key. */
  line: number;
  /** 1-based line where the value ends (differs from `line` for multiline values). */
  endLine: number;
  /** True when the line started with `export `. */
  exported: boolean;
  /** Comment lines directly above the entry, without the leading `#`. */
  comments: string[];
  /** Inline comment after the value, without the leading `#`. */
  inlineComment?: string;
}

export type DotenvProblemCode =
  | 'invalid-line'
  | 'invalid-key'
  | 'unterminated-quote'
  | 'trailing-characters'
  | 'duplicate-key'
  | 'undefined-variable'
  | 'missing-equals';

export interface DotenvProblem {
  code: DotenvProblemCode;
  severity: 'error' | 'warning';
  message: string;
  line: number;
  key?: string;
}

export interface ParseOptions {
  /** Expand `${VAR}` and `$VAR` references. Default `true`. */
  expand?: boolean;
  /**
   * Variables available to expansion besides the ones defined earlier in the
   * file, usually `process.env`.
   */
  env?: Record<string, string | undefined>;
  /**
   * When `true` (default), a variable from `env` wins over one defined in the
   * file during expansion, matching how the values are finally merged.
   */
  envFirst?: boolean;
}

export interface ParseResult {
  /** Final values, last assignment wins. */
  values: Record<string, string>;
  /** Every assignment in file order, duplicates included. */
  entries: DotenvEntry[];
  problems: DotenvProblem[];
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * Parses the contents of a .env file.
 *
 * Supported syntax: `KEY=value`, `export KEY=value`, spaces around `=`,
 * `#` comments (inline comments need a space before `#` in unquoted values),
 * single quotes (literal), double quotes (escapes `\n \r \t \" \\ \$` and
 * expansion), backticks (literal), multiline quoted values, CRLF line endings,
 * a byte order mark, and `${VAR}`, `${VAR:-fallback}`, `${VAR-fallback}`,
 * `$VAR` expansion. The parser never throws; problems are returned instead.
 */
export function parseDotenv(content: string, options: ParseOptions = {}): ParseResult {
  const expand = options.expand !== false;
  const external = options.env ?? {};
  const envFirst = options.envFirst !== false;
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const values: Record<string, string> = {};
  const entries: DotenvEntry[] = [];
  const problems: DotenvProblem[] = [];
  const seen = new Map<string, number>();
  let comments: string[] = [];

  const lookup = (name: string): string | undefined => {
    const fromEnv = external[name];
    if (envFirst && fromEnv !== undefined) return fromEnv;
    if (Object.hasOwn(values, name)) return values[name];
    return fromEnv;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') {
      comments = [];
      continue;
    }
    if (trimmed.startsWith('#')) {
      comments.push(trimmed.slice(1).replace(/^ /, ''));
      continue;
    }

    let rest = trimmed;
    let exported = false;
    const exportMatch = /^export\s+/.exec(rest);
    if (exportMatch) {
      exported = true;
      rest = rest.slice(exportMatch[0].length);
    }

    const eq = rest.indexOf('=');
    if (eq === -1) {
      const name = rest.trim();
      problems.push({
        code: KEY_RE.test(name) ? 'missing-equals' : 'invalid-line',
        severity: 'warning',
        message: KEY_RE.test(name)
          ? `"${name}" has no "=" and is ignored; write ${name}= for an empty value`
          : `Cannot parse line: ${truncate(trimmed)}`,
        line: lineNo,
      });
      comments = [];
      continue;
    }

    const key = rest.slice(0, eq).trim();
    if (!KEY_RE.test(key)) {
      problems.push({
        code: 'invalid-key',
        severity: 'error',
        message: `Invalid variable name "${truncate(key)}"`,
        line: lineNo,
      });
      comments = [];
      continue;
    }

    let after = rest.slice(eq + 1).replace(/^[ \t]+/, '');
    let quote: QuoteStyle = 'none';
    let value: string;
    let raw: string;
    let inlineComment: string | undefined;
    let endLine = lineNo;
    const first = after[0];

    if (first === '"' || first === "'" || first === '`') {
      quote = first === '"' ? 'double' : first === "'" ? 'single' : 'backtick';
      // Collect lines until the closing quote, which may be on a later line.
      let buffer = after.slice(1);
      let j = i;
      let close = findClosingQuote(buffer, first);
      while (close === -1 && j + 1 < lines.length) {
        j++;
        buffer += `\n${lines[j]}`;
        close = findClosingQuote(buffer, first);
      }
      if (close === -1) {
        problems.push({
          code: 'unterminated-quote',
          severity: 'error',
          message: `Value of ${key} starts with ${first} but the closing ${first} is missing`,
          line: lineNo,
          key,
        });
        comments = [];
        // Skip the whole remainder so the rest of the file is not misread.
        i = lines.length;
        continue;
      }
      endLine = j + 1;
      i = j;
      const inner = buffer.slice(0, close);
      raw = `${first}${inner}${first}`;
      const tail = buffer.slice(close + 1).trim();
      if (tail.startsWith('#')) {
        inlineComment = tail.slice(1).trim();
      } else if (tail !== '') {
        problems.push({
          code: 'trailing-characters',
          severity: 'warning',
          message: `Unexpected characters after the closing quote of ${key}: ${truncate(tail)}`,
          line: endLine,
          key,
        });
      }
      if (quote === 'double') {
        value = unescapeDouble(inner);
        if (expand) value = expandValue(value, lookup, (name) => undefinedVar(name));
        else value = value.replace(/\\\$/g, '$');
      } else {
        value = inner;
      }
    } else {
      // Unquoted: an inline comment needs whitespace before '#'.
      const hash = after.search(/\s#/);
      if (hash !== -1) {
        inlineComment = after.slice(hash).trim().slice(1).trim();
        after = after.slice(0, hash);
      } else if (after.startsWith('#')) {
        inlineComment = after.slice(1).trim();
        after = '';
      }
      raw = after.trim();
      value = raw;
      if (expand) value = expandValue(value, lookup, (name) => undefinedVar(name));
    }

    function undefinedVar(name: string): void {
      problems.push({
        code: 'undefined-variable',
        severity: 'warning',
        message: `${key} references \${${name}}, which is not defined; it expands to an empty string`,
        line: lineNo,
        key,
      });
    }

    const previous = seen.get(key);
    if (previous !== undefined) {
      problems.push({
        code: 'duplicate-key',
        severity: 'warning',
        message: `${key} is defined again (first on line ${previous}); the last value wins`,
        line: lineNo,
        key,
      });
    } else {
      seen.set(key, lineNo);
    }

    values[key] = value;
    const entry: DotenvEntry = { key, value, raw, quote, line: lineNo, endLine, exported, comments };
    if (inlineComment !== undefined) entry.inlineComment = inlineComment;
    entries.push(entry);
    comments = [];
  }

  return { values, entries, problems };
}

/** Index of the closing quote in `s`, honoring backslash escapes for double quotes. */
function findClosingQuote(s: string, quote: string): number {
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (quote === '"' && c === '\\') {
      k++;
      continue;
    }
    if (c === quote) return k;
  }
  return -1;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(.)/gs, (match, c: string) => {
    switch (c) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '$':
        // Kept escaped so expansion leaves it alone; expandValue unescapes it.
        return '\\$';
      default:
        return match;
    }
  });
}

function truncate(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Serializes a value so that `parseDotenv` reads it back unchanged. Values
 * that need it are double quoted with escapes.
 */
export function formatDotenvValue(value: string): string {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(value) && !value.includes('$')) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\$/g, '\\$');
  return `"${escaped}"`;
}
