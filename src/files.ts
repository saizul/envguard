import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { type DotenvProblem, parseDotenv } from './parser/dotenv.js';
import type { ValueOrigin } from './schema/validate.js';

export interface LoadFilesOptions {
  /** Directory the files are looked up in. Default `process.cwd()`. */
  cwd?: string;
  /**
   * Mode such as `development`, `production` or `test`. Adds `.env.<mode>`
   * and `.env.<mode>.local`. Default: `NODE_ENV` from `env`.
   */
  mode?: string;
  /** Explicit list of files instead of the default cascade. */
  files?: string[];
  /** Used for `${VAR}` expansion and the default mode. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** Expand `${VAR}` references. Default `true`. */
  expand?: boolean;
}

export interface FileProblem extends DotenvProblem {
  file: string;
}

export interface LoadedFiles {
  /** Merged values; later files win. */
  values: Record<string, string>;
  /** File and line that set each key. */
  origins: Record<string, ValueOrigin>;
  /** Files that existed and were read, relative to `cwd`. */
  files: string[];
  problems: FileProblem[];
}

/**
 * The default cascade, lowest precedence first: `.env`, `.env.local`,
 * `.env.<mode>`, `.env.<mode>.local`. `.env.local` is skipped in the `test`
 * mode so that tests are reproducible, the same rule Next.js and Vite use.
 */
export function defaultEnvFiles(mode?: string): string[] {
  const files = ['.env'];
  if (mode !== 'test') files.push('.env.local');
  if (mode) files.push(`.env.${mode}`, `.env.${mode}.local`);
  return files;
}

/** Reads and merges .env files. Missing files are skipped silently. */
export function loadEnvFiles(options: LoadFilesOptions = {}): LoadedFiles {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const mode = options.mode ?? env.NODE_ENV;
  const list = options.files ?? defaultEnvFiles(mode);
  const values: Record<string, string> = {};
  const origins: Record<string, ValueOrigin> = {};
  const files: string[] = [];
  const problems: FileProblem[] = [];

  for (const name of list) {
    const path = isAbsolute(name) ? name : join(cwd, name);
    if (!existsSync(path)) continue;
    const display = relative(cwd, path) || name;
    files.push(display);
    const parsed = parseDotenv(readFileSync(path, 'utf8'), {
      env: { ...values, ...env },
      expand: options.expand,
    });
    for (const p of parsed.problems) problems.push({ ...p, file: display });
    for (const entry of parsed.entries) {
      values[entry.key] = entry.value;
      origins[entry.key] = { file: display, line: entry.line };
    }
  }
  return { values, origins, files, problems };
}
