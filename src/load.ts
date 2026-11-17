import { type LoadFilesOptions, loadEnvFiles } from './files.js';
import type { InferEnv, Schema } from './schema/types.js';
import { EnvValidationError, parseEnv } from './schema/validate.js';

export interface LoadEnvOptions extends Omit<LoadFilesOptions, 'env'> {
  /**
   * Where values come from. Default `process.env`. Pass `import.meta.env`
   * in Vite, or any plain object.
   */
  source?: Record<string, string | boolean | number | undefined>;
  /**
   * Read .env files before validating. Default `true` when `source` is
   * `process.env` (the default), `false` when a custom `source` is given.
   */
  loadFiles?: boolean;
  /** Let values from files override `source`. Default `false`. */
  override?: boolean;
  /** Warn about keys set in .env files that the schema does not declare. */
  strict?: boolean;
  /** Treat empty strings as missing. Default `true`. */
  emptyAsMissing?: boolean;
  /**
   * What to do when validation fails: `throw` an `EnvValidationError`
   * (default), or print the problems and `exit(1)` for a cleaner startup
   * message in servers.
   */
  onError?: 'throw' | 'exit';
}

/**
 * Loads, validates and converts environment variables. Returns a frozen,
 * fully typed object. Every problem is collected first and reported together.
 *
 * ```ts
 * import { env, loadEnv } from 'envguard';
 * export const config = loadEnv({
 *   PORT: env.port({ default: 3000 }),
 *   DATABASE_URL: env.url({ secret: true }),
 * });
 * config.PORT; // number
 * ```
 */
export function loadEnv<const S extends Schema>(schema: S, options: LoadEnvOptions = {}): InferEnv<S> {
  const customSource = options.source !== undefined;
  const source = options.source ?? process.env;
  const loadFiles = options.loadFiles ?? !customSource;
  let merged: Record<string, string | boolean | number | undefined> = { ...source };
  let origins = {};
  let definedKeys: string[] = [];

  if (loadFiles) {
    const files = loadEnvFiles({
      ...options,
      env: stringRecord(source),
    });
    origins = files.origins;
    definedKeys = Object.keys(files.values);
    merged = options.override ? { ...source, ...files.values } : { ...files.values, ...source };
  }

  const result = parseEnv(schema, merged, {
    origins,
    definedKeys,
    strict: options.strict,
    emptyAsMissing: options.emptyAsMissing,
  });
  for (const w of result.issues.filter((i) => i.severity === 'warning')) {
    process.emitWarning?.(w.message, 'EnvguardWarning');
  }
  if (!result.ok) {
    const error = new EnvValidationError(result.issues);
    if (options.onError === 'exit') {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  return result.env;
}

function stringRecord(source: Record<string, string | boolean | number | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined) out[k] = String(v);
  return out;
}
