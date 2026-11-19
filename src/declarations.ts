import { isRequired } from './schema/builders.js';
import { describeField } from './schema/registry.js';
import type { FieldSpec, Schema } from './schema/types.js';

/** Which global types to declare: `process.env` (Node), `import.meta.env` (Vite) or both. */
export type DeclarationTarget = 'node' | 'vite' | 'both';

export const DECLARATION_TARGETS: readonly DeclarationTarget[] = ['node', 'vite', 'both'];

export interface DeclarationOptions {
  /** Default `node`. */
  target?: DeclarationTarget;
  /** Only variables with this prefix are exposed to client code by Vite. Default `VITE_`. */
  vitePrefix?: string;
  /** Name of the schema file, shown in the header comment. */
  source?: string;
  /** Sort keys alphabetically instead of schema order. */
  sort?: boolean;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propertyName(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/**
 * The TypeScript type of the raw value. Environment variables are always
 * strings; a case-sensitive enum narrows them to its values.
 */
export function rawValueType(field: FieldSpec): string {
  if (field.type === 'enum' && field.caseInsensitive !== true && Array.isArray(field.values)) {
    const values = field.values.filter((v): v is string => typeof v === 'string');
    if (values.length > 0) return values.map((v) => JSON.stringify(v)).join(' | ');
  }
  return 'string';
}

function docComment(field: FieldSpec, indent: string, aliasOf?: string): string[] {
  const lines: string[] = [];
  if (aliasOf) lines.push(`@deprecated Alias of ${aliasOf}; set ${aliasOf} instead.`);
  else {
    if (field.description) lines.push(...String(field.description).split('\n'));
    const parts = [describeField(field)];
    if (field.default !== undefined) parts.push(`default: ${JSON.stringify(field.default)}`);
    else parts.push(isRequired(field) ? 'required' : 'optional');
    if (field.secret === true) parts.push('secret');
    lines.push(parts.join(', '));
  }
  const safe = lines.map((l) => l.replace(/\*\//g, '*\\/').trimEnd());
  if (safe.length === 1) return [`${indent}/** ${safe[0]} */`];
  return [
    `${indent}/**`,
    ...safe.map((l) => (l === '' ? `${indent} *` : `${indent} * ${l}`)),
    `${indent} */`,
  ];
}

function members(schema: Schema, keys: string[], indent: string, readonly: boolean): string[] {
  const out: string[] = [];
  const declared = new Set(keys);
  const prefix = readonly ? 'readonly ' : '';
  for (const key of keys) {
    const field = schema[key]!;
    const aliases = (field.aliases ?? []).filter((a) => typeof a === 'string');
    // With aliases the value may come from another name, so the main name can be unset.
    const optional = !isRequired(field) || aliases.length > 0;
    out.push(...docComment(field, indent));
    out.push(`${indent}${prefix}${propertyName(key)}${optional ? '?' : ''}: ${rawValueType(field)};`);
    for (const alias of aliases) {
      if (declared.has(alias)) continue;
      declared.add(alias);
      out.push(...docComment(field, indent, key));
      out.push(`${indent}${prefix}${propertyName(alias)}?: ${rawValueType(field)};`);
    }
  }
  return out;
}

/**
 * A TypeScript declaration file (`env.d.ts`) that types `process.env` and/or
 * `import.meta.env` from the schema, so editors complete variable names and
 * the compiler catches typos. Values stay strings, as they are at runtime; use
 * `loadEnv()` for parsed values.
 */
export function generateDeclarations(schema: Schema, options: DeclarationOptions = {}): string {
  const target = options.target ?? 'node';
  if (!DECLARATION_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${DECLARATION_TARGETS.join(', ')}`);
  }
  const keys = Object.keys(schema);
  if (options.sort) keys.sort();
  const source = options.source ? ` from ${options.source}` : '';
  const out = [
    `// Environment variable types created by envguard${source}.`,
    '// Do not edit by hand; run "envguard types" after changing the schema.',
    '',
    'export {};',
    '',
    'declare global {',
  ];
  if (target === 'node' || target === 'both') {
    out.push('  namespace NodeJS {', '    interface ProcessEnv {');
    out.push(...members(schema, keys, '      ', false));
    out.push('    }', '  }');
  }
  if (target === 'vite' || target === 'both') {
    const prefix = options.vitePrefix ?? 'VITE_';
    const clientKeys = keys.filter((k) => k.startsWith(prefix));
    if (target === 'both') out.push('');
    out.push('  interface ImportMetaEnv {');
    out.push(...members(schema, clientKeys, '    ', true));
    out.push('  }', '', '  interface ImportMeta {', '    readonly env: ImportMetaEnv;', '  }');
  }
  out.push('}');
  return `${out.join('\n')}\n`;
}
