import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Schema } from './types.js';
import { assertValidSchema, SchemaError } from './validate.js';

/** Schema file names looked up, in order. */
export const SCHEMA_FILES = [
  'env.schema.ts',
  'env.schema.mts',
  'env.schema.js',
  'env.schema.mjs',
  'env.schema.cjs',
  'env.schema.json',
];

/** The first schema file that exists in `cwd`, if any. */
export function findSchemaFile(cwd: string): string | undefined {
  return SCHEMA_FILES.find((f) => existsSync(join(cwd, f)));
}

/**
 * Loads a schema from a `.json` file or a JavaScript/TypeScript module that
 * exports it as `default` or as `schema`. TypeScript files need a Node
 * version that strips types (22.18+ or 23.6+), or a loader such as tsx.
 */
export async function loadSchemaFile(file: string, cwd = process.cwd()): Promise<Schema> {
  const path = isAbsolute(file) ? file : join(cwd, file);
  if (!existsSync(path)) throw new SchemaError(`Schema file not found: ${file}`);
  let data: unknown;
  if (path.endsWith('.json')) {
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new SchemaError(`${file} is not valid JSON: ${(err as Error).message}`);
    }
    if (data && typeof data === 'object' && '$schema' in data) {
      const { $schema: _ignored, ...rest } = data as Record<string, unknown>;
      data = rest;
    }
  } else {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (
        /\.[cm]?ts$/.test(path) &&
        (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(e.message))
      ) {
        throw new SchemaError(
          `Node ${process.versions.node} cannot load ${file} directly. Use Node 22.18 or newer, run the CLI through tsx (npx tsx node_modules/.bin/envguard ...), or use env.schema.mjs / env.schema.json.`,
        );
      }
      throw new SchemaError(`Could not load ${file}: ${e.message}`);
    }
    data = mod.default ?? mod.schema;
    // A CommonJS module imported from ESM puts module.exports on default.
    if (data && typeof data === 'object' && 'schema' in data && !('type' in (data as object))) {
      const inner = (data as Record<string, unknown>).schema;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) data = inner;
    }
    if (data === undefined) throw new SchemaError(`${file} must export the schema as default or as "schema"`);
  }
  assertValidSchema(data);
  return data;
}
