import type { DotenvEntry } from './parser/dotenv.js';
import { parseDuration } from './schema/duration.js';
import type { FieldSpec, Schema } from './schema/types.js';

const SECRET_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PASS$|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_KEY|AUTH|SALT|DSN|_KEY$)/i;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_|GATSBY_)/;
const DB_URL_NAME = /(DATABASE|DB|REDIS|MONGO|POSTGRES|MYSQL|AMQP|RABBIT)_?(URL|URI|DSN)$/i;

/** Guesses a field from a variable name and a sample value. */
export function inferField(key: string, value: string, comments: string[] = []): FieldSpec {
  const v = value.trim();
  const field: FieldSpec = { type: 'string' };
  const secret = (SECRET_NAME.test(key) || DB_URL_NAME.test(key)) && !PUBLIC_PREFIX.test(key);

  if (/PORT$/i.test(key) && /^\d{1,5}$/.test(v) && Number(v) <= 65535) field.type = 'port';
  else if (/^(true|false)$/i.test(v)) field.type = 'boolean';
  else if (/^[+-]?\d+$/.test(v) && v.length < 16) field.type = 'integer';
  else if (/^[+-]?\d*\.\d+$/.test(v)) field.type = 'number';
  else if (/^\d+(\.\d+)?(ms|s|m|h|d)$/.test(v) && parseDuration(v) !== undefined) field.type = 'duration';
  else if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)) field.type = 'url';
  else if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) field.type = 'email';
  else if (/^[[{]/.test(v) && isJson(v)) field.type = 'json';
  else if (v === '' && /PORT$/i.test(key)) field.type = 'port';
  else if (v === '' && /(_URL|_URI|_ENDPOINT)$/i.test(key)) field.type = 'url';

  const description = comments
    .map((c) => c.trim())
    .filter((c) => c !== '' && !/(^|,\s*)(required|optional|default: )/i.test(c))
    .join(' ');
  if (description) field.description = description;

  if (secret) field.secret = true;
  else if (v !== '') field.default = coerceDefault(field.type, v);
  return stripUndefined(field);
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

function coerceDefault(type: string, v: string): unknown {
  switch (type) {
    case 'port':
    case 'integer':
    case 'number':
      return Number(v);
    case 'boolean':
      return v.toLowerCase() === 'true';
    default:
      return v;
  }
}

function stripUndefined(f: FieldSpec): FieldSpec {
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return f;
}

/** Builds a starting schema from the entries of an existing env file. */
export function inferSchema(entries: DotenvEntry[]): Schema {
  const schema: Schema = {};
  for (const e of entries) schema[e.key] = inferField(e.key, e.value, e.comments);
  return schema;
}

/** Renders a schema as an `env.schema.ts` module that uses the builders. */
export function schemaToTypeScript(schema: Schema, importFrom = '@saizul/envguard'): string {
  const lines = [`import { defineSchema, env } from '${importFrom}';`, '', 'export default defineSchema({'];
  for (const [key, field] of Object.entries(schema)) {
    const { type, ...rest } = field;
    const opts = Object.keys(rest).length > 0 ? tsObject(rest) : '';
    if (type === 'enum') {
      const { values, ...others } = rest as { values?: string[] };
      const more = Object.keys(others).length > 0 ? `, ${tsObject(others)}` : '';
      lines.push(`  ${key}: env.enum(${JSON.stringify(values ?? [])}${more}),`);
    } else lines.push(`  ${key}: env.${type}(${opts}),`);
  }
  lines.push('});', '');
  return lines.join('\n');
}

function tsObject(o: Record<string, unknown>): string {
  const parts = Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `{ ${parts.join(', ')} }`;
}
