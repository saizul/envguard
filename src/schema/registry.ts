import { parseDuration } from './duration.js';
import type { FieldSpec } from './types.js';

/** The result of parsing one raw string. */
export type ParseOutcome = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * A variable type. `parse` turns the raw string into a value or explains why
 * it cannot. `describe` is a short human label used in `.env.example` and in
 * messages, for example `port (1-65535)`.
 */
export interface TypeDefinition {
  name: string;
  parse(raw: string, field: FieldSpec): ParseOutcome;
  describe?(field: FieldSpec): string;
  /** Validates the options of a field when a schema file is loaded. */
  checkOptions?(field: FieldSpec): string | undefined;
  /** Options the type understands, besides the common ones. Used to flag typos. */
  options?: readonly string[];
}

const ok = (value: unknown): ParseOutcome => ({ ok: true, value });
const fail = (reason: string): ParseOutcome => ({ ok: false, reason });

function num(field: FieldSpec, key: string): number | undefined {
  const v = field[key];
  return typeof v === 'number' ? v : undefined;
}

function checkRange(n: number, field: FieldSpec, unit = ''): ParseOutcome | undefined {
  const min = num(field, 'min');
  const max = num(field, 'max');
  if (min !== undefined && n < min) return fail(`must be at least ${min}${unit}`);
  if (max !== undefined && n > max) return fail(`must be at most ${max}${unit}`);
  return undefined;
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

const string: TypeDefinition = {
  name: 'string',
  options: ['minLength', 'maxLength', 'pattern', 'trim'],
  parse(raw, field) {
    const value = field.trim === false ? raw : raw.trim();
    const minLength = num(field, 'minLength');
    const maxLength = num(field, 'maxLength');
    const length = [...value].length;
    if (minLength !== undefined && length < minLength)
      return fail(`must be at least ${minLength} characters (got ${length})`);
    if (maxLength !== undefined && length > maxLength)
      return fail(`must be at most ${maxLength} characters (got ${length})`);
    if (typeof field.pattern === 'string' && !new RegExp(field.pattern, 'u').test(value))
      return fail(`must match /${field.pattern}/`);
    return ok(value);
  },
  checkOptions(field) {
    if (field.pattern !== undefined) {
      if (typeof field.pattern !== 'string') return '"pattern" must be a string';
      try {
        new RegExp(field.pattern, 'u');
      } catch {
        return `"pattern" is not a valid regular expression: ${field.pattern}`;
      }
    }
    return undefined;
  },
};

const number: TypeDefinition = {
  name: 'number',
  options: ['min', 'max', 'integer'],
  describe: (f) => describeRange(f.integer === true ? 'integer' : 'number', f),
  parse(raw, field) {
    const s = raw.trim().replace(/_/g, '');
    if (!NUMBER_RE.test(s)) return fail('is not a number');
    const n = Number(s);
    if (!Number.isFinite(n)) return fail('is not a finite number');
    if (field.integer === true && !Number.isInteger(n)) return fail('must be a whole number');
    return checkRange(n, field) ?? ok(n);
  },
};

const integer: TypeDefinition = {
  name: 'integer',
  options: ['min', 'max'],
  describe: (f) => describeRange('integer', f),
  parse(raw, field) {
    const s = raw.trim().replace(/_/g, '');
    if (!/^[+-]?\d+$/.test(s)) return fail('is not a whole number');
    const n = Number(s);
    if (!Number.isSafeInteger(n)) return fail('is too large');
    return checkRange(n, field) ?? ok(n);
  },
};

const TRUE = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE = new Set(['false', '0', 'no', 'n', 'off']);

const boolean: TypeDefinition = {
  name: 'boolean',
  describe: () => 'boolean (true/false)',
  parse(raw) {
    const s = raw.trim().toLowerCase();
    if (TRUE.has(s)) return ok(true);
    if (FALSE.has(s)) return ok(false);
    return fail('must be true or false (also accepted: 1/0, yes/no, on/off)');
  },
};

const url: TypeDefinition = {
  name: 'url',
  options: ['protocols'],
  describe: (f) => (Array.isArray(f.protocols) ? `url (${f.protocols.join(', ')})` : 'url'),
  parse(raw, field) {
    const s = raw.trim();
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      return fail('is not a valid absolute URL');
    }
    const protocols = Array.isArray(field.protocols) ? (field.protocols as string[]) : undefined;
    const scheme = parsed.protocol.replace(/:$/, '');
    if (protocols && !protocols.includes(scheme))
      return fail(`must use ${protocols.map((p) => `${p}:`).join(' or ')} (got ${scheme}:)`);
    return ok(s);
  },
};

// Pragmatic: one @, no spaces, a dot in the domain, sane label characters.
const EMAIL_RE =
  /^[^\s@"<>()[\],;:]+@(?:[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?\.)+[\p{L}\p{M}]{2,}$/u;

const email: TypeDefinition = {
  name: 'email',
  parse(raw) {
    const s = raw.trim();
    return EMAIL_RE.test(s) ? ok(s) : fail('is not a valid email address');
  },
};

const enumType: TypeDefinition = {
  name: 'enum',
  options: ['values', 'caseInsensitive'],
  describe: (f) => `one of ${valuesOf(f).join(' | ')}`,
  parse(raw, field) {
    const s = raw.trim();
    const values = valuesOf(field);
    if (values.includes(s)) return ok(s);
    if (field.caseInsensitive === true) {
      const hit = values.find((v) => v.toLowerCase() === s.toLowerCase());
      if (hit !== undefined) return ok(hit);
    }
    return fail(`must be one of: ${values.join(', ')}`);
  },
  checkOptions(field) {
    const v = field.values;
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string'))
      return '"values" must be a non-empty array of strings';
    return undefined;
  },
};

const port: TypeDefinition = {
  name: 'port',
  options: ['allowZero'],
  describe: () => 'port (1-65535)',
  parse(raw, field) {
    const s = raw.trim();
    if (!/^\d+$/.test(s)) return fail('is not a port number');
    const n = Number(s);
    const min = field.allowZero === true ? 0 : 1;
    if (n < min || n > 65535) return fail(`must be between ${min} and 65535`);
    return ok(n);
  },
};

const json: TypeDefinition = {
  name: 'json',
  parse(raw) {
    try {
      return ok(JSON.parse(raw));
    } catch (err) {
      return fail(`is not valid JSON (${(err as Error).message})`);
    }
  },
};

const duration: TypeDefinition = {
  name: 'duration',
  options: ['min', 'max'],
  describe: () => 'duration (e.g. 500ms, 30s, 5m, 1h30m)',
  parse(raw, field) {
    const ms = parseDuration(raw);
    if (ms === undefined) return fail('is not a duration (examples: 250ms, 30s, 5m, 1h30m, 2d)');
    return checkRange(ms, field, ' ms') ?? ok(ms);
  },
};

const list: TypeDefinition = {
  name: 'list',
  options: ['separator', 'minItems'],
  describe: (f) => `list separated by "${typeof f.separator === 'string' ? f.separator : ','}"`,
  parse(raw, field) {
    const sep = typeof field.separator === 'string' ? field.separator : ',';
    const items = raw
      .split(sep)
      .map((s) => s.trim())
      .filter((s) => s !== '');
    const minItems = num(field, 'minItems');
    if (minItems !== undefined && items.length < minItems)
      return fail(`must have at least ${minItems} item${minItems === 1 ? '' : 's'}`);
    return ok(items);
  },
};

function valuesOf(field: FieldSpec): string[] {
  return Array.isArray(field.values) ? (field.values as string[]) : [];
}

function describeRange(label: string, f: FieldSpec): string {
  const min = num(f, 'min');
  const max = num(f, 'max');
  if (min !== undefined && max !== undefined) return `${label} (${min}-${max})`;
  if (min !== undefined) return `${label} (>= ${min})`;
  if (max !== undefined) return `${label} (<= ${max})`;
  return label;
}

const registry = new Map<string, TypeDefinition>(
  [string, number, integer, boolean, url, email, enumType, port, json, duration, list].map((t) => [
    t.name,
    t,
  ]),
);

/** Adds a custom type, or replaces a built-in one. */
export function registerType(definition: TypeDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.name))
    throw new TypeError(`Type names must be lowercase kebab-case: "${definition.name}"`);
  registry.set(definition.name, definition);
}

export function getType(name: string): TypeDefinition | undefined {
  return registry.get(name);
}

/** Names of all registered types. */
export function typeNames(): string[] {
  return [...registry.keys()];
}

export function describeField(field: FieldSpec): string {
  const def = registry.get(field.type);
  return def?.describe?.(field) ?? field.type;
}
