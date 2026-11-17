import type { DotenvEntry, DotenvProblem } from '../parser/dotenv.js';
import type { Schema } from '../schema/types.js';
import type { GitIgnore } from '../util/gitignore.js';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  status: CheckStatus;
  message: string;
  /** What to do about it. */
  hint?: string;
  file?: string;
  line?: number;
}

/** Everything a doctor check may look at. Files are read once and shared. */
export interface DoctorContext {
  cwd: string;
  /** `.gitignore` of `cwd`, if present. */
  gitignore?: GitIgnore;
  /** Every `.env*` file in `cwd`, sorted. */
  envFiles: string[];
  /** The template, normally `.env.example`. */
  exampleFile: string;
  exampleExists: boolean;
  /** Parsed template entries (empty when it does not exist). */
  example: DotenvEntry[];
  schema?: Schema;
  schemaFile?: string;
  /** Set when the schema file exists but failed to load. */
  schemaError?: string;
  /** Parses a file of `cwd`; cached. */
  parse(file: string): { entries: DotenvEntry[]; problems: DotenvProblem[] } | undefined;
  /** Reads a file of `cwd`; cached. */
  read(file: string): string | undefined;
  /** Allowlist for the secret scan. */
  allow: string[];
}

/**
 * One doctor check. `run` returns one or more results; return a single
 * `pass` result when everything is fine so the output lists the check.
 */
export interface DoctorCheck {
  /** Stable kebab-case ID. */
  id: string;
  /** Short title shown in the report. */
  title: string;
  run(ctx: DoctorContext): CheckResult[];
}
