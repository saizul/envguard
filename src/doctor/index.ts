import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DotenvEntry, type DotenvProblem, parseDotenv } from '../parser/dotenv.js';
import type { Schema } from '../schema/types.js';
import { GitIgnore } from '../util/gitignore.js';
import { doctorChecks } from './checks.js';
import type { CheckResult, DoctorCheck, DoctorContext } from './types.js';

export interface DoctorOptions {
  cwd?: string;
  exampleFile?: string;
  schema?: Schema;
  schemaFile?: string;
  schemaError?: string;
  allow?: string[];
  /** Replace the default checks. */
  checks?: DoctorCheck[];
}

export interface DoctorReport {
  checks: Array<{ id: string; title: string; results: CheckResult[] }>;
  failed: number;
  warned: number;
}

/** Runs the hygiene checks on a project directory. */
export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const gitignorePath = join(cwd, '.gitignore');
  const envFiles = readdirSync(cwd, { withFileTypes: true })
    .filter((e) => e.isFile() && /^\.env(\.|$)/.test(e.name))
    .map((e) => e.name)
    .sort();
  const texts = new Map<string, string | undefined>();
  const read = (file: string) => {
    if (!texts.has(file)) {
      const path = join(cwd, file);
      texts.set(file, existsSync(path) ? readFileSync(path, 'utf8') : undefined);
    }
    return texts.get(file);
  };
  const cache = new Map<string, { entries: DotenvEntry[]; problems: DotenvProblem[] } | undefined>();
  const parse = (file: string) => {
    if (!cache.has(file)) {
      const text = read(file);
      cache.set(file, text === undefined ? undefined : parseDotenv(text, { expand: false }));
    }
    return cache.get(file);
  };
  const exampleFile =
    options.exampleFile ??
    ['.env.example', '.env.sample', '.env.template'].find((f) => envFiles.includes(f)) ??
    '.env.example';
  const exampleExists = existsSync(join(cwd, exampleFile));
  const ctx: DoctorContext = {
    cwd,
    envFiles,
    exampleFile,
    exampleExists,
    example: exampleExists ? (parse(exampleFile)?.entries ?? []) : [],
    parse,
    read,
    allow: options.allow ?? [],
  };
  if (existsSync(gitignorePath)) ctx.gitignore = new GitIgnore(readFileSync(gitignorePath, 'utf8'));
  if (options.schema) ctx.schema = options.schema;
  if (options.schemaFile) ctx.schemaFile = options.schemaFile;
  if (options.schemaError) ctx.schemaError = options.schemaError;

  const report: DoctorReport = { checks: [], failed: 0, warned: 0 };
  for (const check of options.checks ?? doctorChecks) {
    let results: CheckResult[];
    try {
      results = check.run(ctx);
    } catch (err) {
      results = [{ status: 'fail', message: `check crashed: ${(err as Error).message}` }];
    }
    report.checks.push({ id: check.id, title: check.title, results });
    for (const r of results) {
      if (r.status === 'fail') report.failed++;
      else if (r.status === 'warn') report.warned++;
    }
  }
  return report;
}
