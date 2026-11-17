import { parseDuration } from './duration.js';
import { describeField, getType, typeNames } from './registry.js';
import type { EnvIssue, FieldSpec, InferEnv, Schema } from './types.js';

/** Where a value came from, for messages and annotations. */
export interface ValueOrigin {
  file: string;
  line: number;
}

export interface ParseEnvOptions {
  /** File and line of each key, when the values came from .env files. */
  origins?: Record<string, ValueOrigin>;
  /**
   * Keys that were defined in files. With `strict`, keys in this list that
   * are not in the schema are reported as unknown.
   */
  definedKeys?: string[];
  /** Report keys that are not in the schema (only the ones in `definedKeys`). */
  strict?: boolean;
  /** Treat empty strings as missing. Default `true`. */
  emptyAsMissing?: boolean;
}

export interface ParseEnvResult<S extends Schema> {
  ok: boolean;
  /** The parsed values. Only complete when `ok` is true. */
  env: InferEnv<S>;
  issues: EnvIssue[];
}

/** Thrown for a schema that cannot be used, for example an unknown type. */
export class SchemaError extends Error {
  override name = 'SchemaError';
}

/** Thrown by `loadEnv()` when one or more variables are missing or invalid. */
export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
  readonly issues: EnvIssue[];
  constructor(issues: EnvIssue[]) {
    super(formatIssues(issues));
    this.issues = issues;
  }
}

const COMMON_OPTIONS = new Set([
  'type',
  'default',
  'optional',
  'secret',
  'description',
  'example',
  'aliases',
]);

/**
 * Checks that a schema only uses known types and valid options. Throws a
 * `SchemaError` that lists every problem.
 */
export function assertValidSchema(schema: unknown): asserts schema is Schema {
  const problems: string[] = [];
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new SchemaError('The schema must be an object of variable name to field');
  }
  for (const [key, field] of Object.entries(schema as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) problems.push(`${key}: not a valid variable name`);
    if (field === null || typeof field !== 'object' || Array.isArray(field)) {
      problems.push(`${key}: must be an object like { "type": "string" }`);
      continue;
    }
    const f = field as FieldSpec;
    const def = typeof f.type === 'string' ? getType(f.type) : undefined;
    if (!def) {
      problems.push(`${key}: unknown type ${JSON.stringify(f.type)} (known: ${typeNames().join(', ')})`);
      continue;
    }
    const known = new Set([
      ...COMMON_OPTIONS,
      ...(def.options ?? []),
      ...(f.type === 'enum' ? ['values'] : []),
    ]);
    for (const option of Object.keys(f)) {
      if (!known.has(option)) problems.push(`${key}: unknown option "${option}" for type ${f.type}`);
    }
    const optionProblem = def.checkOptions?.(f);
    if (optionProblem) problems.push(`${key}: ${optionProblem}`);
    if (
      f.aliases !== undefined &&
      (!Array.isArray(f.aliases) || !f.aliases.every((a) => typeof a === 'string'))
    )
      problems.push(`${key}: "aliases" must be an array of strings`);
    if (f.default !== undefined && typeof f.default === 'string') {
      const parsed = def.parse(f.default, f);
      if (!parsed.ok) problems.push(`${key}: the default ${JSON.stringify(f.default)} ${parsed.reason}`);
    }
  }
  if (problems.length > 0) {
    throw new SchemaError(`Invalid schema:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/**
 * Validates and converts raw values against a schema without touching the
 * file system or `process.env`. Works in browsers and edge runtimes, for
 * example with `import.meta.env`. Never throws for bad values; check `ok`.
 */
export function parseEnv<const S extends Schema>(
  schema: S,
  source: Record<string, string | boolean | number | undefined>,
  options: ParseEnvOptions = {},
): ParseEnvResult<S> {
  assertValidSchema(schema);
  const emptyAsMissing = options.emptyAsMissing !== false;
  const issues: EnvIssue[] = [];
  const out: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema)) {
    const def = getType(field.type)!;
    let usedKey = key;
    let raw = stringify(source[key]);
    if ((raw === undefined || (emptyAsMissing && raw === '')) && field.aliases) {
      for (const alias of field.aliases) {
        const v = stringify(source[alias]);
        if (v !== undefined && !(emptyAsMissing && v === '')) {
          raw = v;
          usedKey = alias;
          break;
        }
      }
    }
    const origin = options.origins?.[usedKey];
    const missing = raw === undefined || (emptyAsMissing && raw === '');

    if (missing) {
      if (field.default !== undefined) {
        out[key] = defaultValue(field);
        continue;
      }
      if (field.optional === true) {
        out[key] = undefined;
        continue;
      }
      const issue: EnvIssue = {
        key,
        code: raw === '' ? 'empty' : 'missing',
        severity: 'error',
        message: missingMessage(key, field, raw === ''),
      };
      if (origin) {
        issue.file = origin.file;
        issue.line = origin.line;
      }
      issues.push(issue);
      continue;
    }

    const parsed = def.parse(raw as string, field);
    if (parsed.ok) {
      out[key] = parsed.value;
      continue;
    }
    const shown = field.secret === true ? mask(raw as string) : truncate(raw as string);
    const issue: EnvIssue = {
      key,
      code: 'invalid',
      severity: 'error',
      value: shown,
      message: `${key}${usedKey !== key ? ` (read from ${usedKey})` : ''} ${parsed.reason}; got ${JSON.stringify(shown)}${hint(field)}`,
    };
    if (origin) {
      issue.file = origin.file;
      issue.line = origin.line;
    }
    issues.push(issue);
  }

  if (options.strict && options.definedKeys) {
    const known = new Set<string>();
    for (const [key, field] of Object.entries(schema)) {
      known.add(key);
      for (const a of field.aliases ?? []) known.add(a);
    }
    for (const key of options.definedKeys) {
      if (known.has(key)) continue;
      const issue: EnvIssue = {
        key,
        code: 'unknown',
        severity: 'warning',
        message: `${key} is set but not declared in the schema`,
      };
      const origin = options.origins?.[key];
      if (origin) {
        issue.file = origin.file;
        issue.line = origin.line;
      }
      issues.push(issue);
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    env: Object.freeze(out) as InferEnv<S>,
    issues,
  };
}

function stringify(v: string | boolean | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : String(v);
}

function defaultValue(field: FieldSpec): unknown {
  const d = field.default;
  if (typeof d === 'string') {
    if (field.type === 'duration') return parseDuration(d);
    const def = getType(field.type)!;
    const parsed = def.parse(d, field);
    return parsed.ok ? parsed.value : d;
  }
  return Array.isArray(d) ? [...d] : d;
}

function missingMessage(key: string, field: FieldSpec, empty: boolean): string {
  const what = empty ? 'is empty' : 'is missing';
  const desc = field.description ? ` (${field.description})` : '';
  return `${key} ${what}; expected ${describeField(field)}${desc}${hint(field)}`;
}

function hint(field: FieldSpec): string {
  if (field.example && field.secret !== true) return `. Example: ${field.example}`;
  return '';
}

/** Masks a secret for display: keeps at most the first 2 characters. */
export function mask(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(8, value.length - 2))}`;
}

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A readable multi-line summary of all issues. */
export function formatIssues(issues: EnvIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error');
  const count = errors.length || issues.length;
  const head = `Environment validation failed: ${count} problem${count === 1 ? '' : 's'}`;
  const lines = (errors.length > 0 ? errors : issues).map((i) => {
    const where = i.file ? ` (${i.file}${i.line ? `:${i.line}` : ''})` : '';
    return `  ✖ ${i.message}${where}`;
  });
  return [head, ...lines].join('\n');
}

/**
 * Returns a copy of parsed values with secrets replaced by `'[secret]'`, safe
 * to log.
 */
export function redact<S extends Schema>(schema: S, values: InferEnv<S>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    out[key] = schema[key]?.secret === true && value !== undefined ? '[secret]' : value;
  }
  return out;
}
