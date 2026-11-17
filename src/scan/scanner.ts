import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findFiles, globToRegExp, isGlob } from '../util/glob.js';
import { builtinPatterns, isPlaceholder, type SecretPattern } from './patterns.js';

/** Files that are committed on purpose and often contain copied values. */
export const DEFAULT_SCAN_GLOBS = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.defaults',
  '**/.env.dist',
  '**/*.env.example',
  '**/README*',
  '**/docker-compose*.yml',
  '**/docker-compose*.yaml',
  '**/compose.yml',
  '**/compose.yaml',
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
];

export interface SecretFinding {
  file: string;
  line: number;
  column: number;
  patternId: string;
  title: string;
  severity: 'error' | 'warning';
  /** The secret with most characters masked. Never the full value. */
  preview: string;
}

export interface ScanOptions {
  /** Directory to resolve files against. Default `process.cwd()`. */
  cwd?: string;
  /** Files or globs. Default `DEFAULT_SCAN_GLOBS`. */
  include?: string[];
  /** Globs to skip. */
  exclude?: string[];
  /**
   * Allowed values: plain strings match a secret exactly or as a substring,
   * `/regex/` strings are regular expressions, and `pattern-id` entries
   * prefixed with `id:` disable a pattern.
   */
  allow?: string[];
  /** Pattern IDs to turn off. */
  disable?: string[];
  /** Extra patterns, checked after the built-in ones. */
  patterns?: SecretPattern[];
  /** Files larger than this are skipped. Default 1 MB. */
  maxFileBytes?: number;
}

export interface ScanResult {
  files: string[];
  findings: SecretFinding[];
}

/** Lines containing one of these markers are never reported. */
const INLINE_ALLOW = /envguard[-:](?:allow|ignore)/;

/** Masks a secret, keeping a short prefix so the type stays recognizable. */
export function preview(secret: string): string {
  const keep = Math.min(4, Math.floor(secret.length / 4));
  return `${secret.slice(0, keep)}${'*'.repeat(Math.max(4, Math.min(12, secret.length - keep)))}`;
}

function compileAllow(allow: string[]): ((s: string) => boolean)[] {
  return allow
    .filter((a) => !a.startsWith('id:'))
    .map((a) => {
      const m = /^\/(.+)\/([a-z]*)$/.exec(a);
      if (m) {
        const re = new RegExp(m[1]!, m[2]!.replace('g', ''));
        return (s: string) => re.test(s);
      }
      return (s: string) => s.includes(a);
    });
}

/** Scans text and returns findings. `file` is only used in the result. */
export function scanText(text: string, file: string, options: ScanOptions = {}): SecretFinding[] {
  const disabled = new Set([
    ...(options.disable ?? []),
    ...(options.allow ?? []).filter((a) => a.startsWith('id:')).map((a) => a.slice(3)),
  ]);
  const patterns = [...builtinPatterns, ...(options.patterns ?? [])].filter((p) => !disabled.has(p.id));
  const allowed = compileAllow(options.allow ?? []);
  const findings: SecretFinding[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let allowNext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const skip = allowNext || INLINE_ALLOW.test(line);
    // A comment line with only the marker allows the next line.
    allowNext = /^\s*(?:#|\/\/|<!--)\s*envguard[-:](?:allow|ignore)(?:-next-line)?\b/.test(line);
    if (skip) continue;
    const taken: Array<[number, number]> = [];
    for (const pattern of patterns) {
      if (pattern.keywords && !pattern.keywords.some((k) => line.includes(k))) continue;
      const re = new RegExp(pattern.regex.source, `${pattern.regex.flags.replace('g', '')}g`);
      for (let m = re.exec(line); m !== null; m = re.exec(line)) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        const secret = m[1] ?? m[0];
        const start = m.index + (m[1] !== undefined ? m[0].indexOf(m[1]) : 0);
        const end = start + secret.length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        if (pattern.id !== 'private-key' && isPlaceholder(secret)) continue;
        if (pattern.verify && !pattern.verify(secret, line)) continue;
        if (allowed.some((f) => f(secret))) continue;
        taken.push([start, end]);
        findings.push({
          file,
          line: i + 1,
          column: start + 1,
          patternId: pattern.id,
          title: pattern.title,
          severity: pattern.severity,
          preview: pattern.id === 'private-key' ? secret : preview(secret),
        });
      }
    }
  }
  return findings;
}

/** Finds the files to scan and scans them. */
export function scanFiles(options: ScanOptions = {}): ScanResult {
  const cwd = options.cwd ?? process.cwd();
  const include = options.include && options.include.length > 0 ? options.include : DEFAULT_SCAN_GLOBS;
  const max = options.maxFileBytes ?? 1_000_000;
  const files = new Set<string>();
  const globs: string[] = [];
  for (const entry of include) {
    if (isGlob(entry)) globs.push(entry);
    else files.add(entry.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  if (globs.length > 0) for (const f of findFiles(cwd, globs, { ignore: options.exclude })) files.add(f);
  const exclude = (options.exclude ?? []).map(globToRegExp);

  const scanned: string[] = [];
  const findings: SecretFinding[] = [];
  for (const file of [...files].sort()) {
    if (exclude.some((r) => r.test(file))) continue;
    const path = join(cwd, file);
    let size: number;
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    if (size > max) continue;
    const content = readFileSync(path, 'utf8');
    if (content.includes('\u0000')) continue;
    scanned.push(file);
    findings.push(...scanText(content, file, options));
  }
  return { files: scanned, findings };
}
