import { type DotenvEntry, formatDotenvValue } from './parser/dotenv.js';
import { isRequired } from './schema/builders.js';
import { formatDuration } from './schema/duration.js';
import { describeField } from './schema/registry.js';
import type { FieldSpec, Schema } from './schema/types.js';

export interface ExampleOptions {
  /** Lines for the top of the file, without `#`. `null` for no header. */
  header?: string[] | null;
  /** Entries of the current `.env.example`; their values are kept for non-secret keys without an example or default. */
  existing?: DotenvEntry[];
  /** Keep keys of the existing file that are not in the schema, in a section at the end. */
  keepUnknown?: boolean;
  /** Add a `# type, default` line under each description. Default `true`. */
  typeComments?: boolean;
  /** Sort keys alphabetically instead of schema order. */
  sort?: boolean;
}

export const DEFAULT_HEADER = [
  'Copy this file to .env and fill in the values.',
  'Keep .env out of version control; this file is safe to commit.',
  'Refresh it with: npx @saizul/envguard example',
];

/** The value written to `.env.example` for a field (empty for secrets). */
export function exampleValue(field: FieldSpec): string {
  if (field.secret === true) return '';
  if (field.example !== undefined) return String(field.example);
  const d = field.default;
  if (d === undefined || d === null) return '';
  if (field.type === 'duration' && typeof d === 'number') return formatDuration(d);
  if (field.type === 'json' && typeof d !== 'string') return JSON.stringify(d);
  if (field.type === 'list' && Array.isArray(d)) {
    const sep = typeof field.separator === 'string' ? field.separator : ',';
    return d.join(sep);
  }
  return String(d);
}

function typeLine(field: FieldSpec): string {
  const parts = [describeField(field)];
  if (field.default !== undefined) {
    const shown =
      field.type === 'duration' && typeof field.default === 'number'
        ? formatDuration(field.default)
        : typeof field.default === 'string'
          ? field.default
          : JSON.stringify(field.default);
    parts.push(`default: ${shown === '' ? '(empty)' : shown}`);
  } else if (isRequired(field)) parts.push('required');
  else parts.push('optional');
  if (field.secret === true) parts.push('secret');
  return parts.join(', ');
}

/** Builds the contents of `.env.example` from a schema. */
export function generateExample(schema: Schema, options: ExampleOptions = {}): string {
  const out: string[] = [];
  const header = options.header === undefined ? DEFAULT_HEADER : options.header;
  if (header && header.length > 0) {
    for (const h of header) out.push(h === '' ? '#' : `# ${h}`);
    out.push('');
  }
  const existing = new Map((options.existing ?? []).map((e) => [e.key, e]));
  const keys = Object.keys(schema);
  if (options.sort) keys.sort();
  for (const key of keys) {
    const field = schema[key]!;
    if (field.description)
      for (const d of String(field.description).split('\n')) out.push(`# ${d}`.trimEnd());
    if (options.typeComments !== false) out.push(`# ${typeLine(field)}`);
    let value = exampleValue(field);
    const prev = existing.get(key);
    if (value === '' && field.secret !== true && prev && prev.value !== '') value = prev.value;
    out.push(`${key}=${formatDotenvValue(value)}`);
    out.push('');
  }
  if (options.keepUnknown) {
    const unknown = (options.existing ?? []).filter((e) => !Object.hasOwn(schema, e.key));
    if (unknown.length > 0) {
      out.push('# Not declared in the schema');
      for (const e of unknown) out.push(`${e.key}=${e.raw}`);
      out.push('');
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return `${out.join('\n')}\n`;
}
