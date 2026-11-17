import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Contents of `envguard.config.json` (or the `"envguard"` key of package.json). */
export interface EnvguardConfig {
  /** Path to the schema file. Default: the first `env.schema.*` found. */
  schema?: string;
  /** The template file. Default `.env.example`. */
  example?: string;
  /** Files `check` reads instead of the default cascade. */
  files?: string[];
  /** Report keys in .env files that the schema does not declare. */
  strict?: boolean;
  scan?: {
    include?: string[];
    exclude?: string[];
    allow?: string[];
    disable?: string[];
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export const CONFIG_FILE = 'envguard.config.json';

const KEYS = new Set(['$schema', 'schema', 'example', 'files', 'strict', 'scan']);
const SCAN_KEYS = new Set(['include', 'exclude', 'allow', 'disable']);

/** Loads the config from an explicit path, `envguard.config.json`, or package.json. */
export function loadConfig(cwd: string, explicit?: string): { config: EnvguardConfig; file?: string } {
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : join(cwd, explicit);
    if (!existsSync(path)) throw new ConfigError(`Config file not found: ${explicit}`);
    return { config: validateConfig(readJson(path, explicit), explicit), file: explicit };
  }
  const path = join(cwd, CONFIG_FILE);
  if (existsSync(path))
    return { config: validateConfig(readJson(path, CONFIG_FILE), CONFIG_FILE), file: CONFIG_FILE };
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath, 'package.json') as Record<string, unknown>;
    if (pkg && typeof pkg === 'object' && pkg.envguard !== undefined) {
      return { config: validateConfig(pkg.envguard, 'package.json#envguard'), file: 'package.json' };
    }
  }
  return { config: {} };
}

function readJson(path: string, name: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${name} is not valid JSON: ${(err as Error).message}`);
  }
}

function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function validateConfig(data: unknown, name = 'config'): EnvguardConfig {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new ConfigError(`${name} must be an object`);
  const c = data as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(c)) if (!KEYS.has(k)) problems.push(`unknown option "${k}"`);
  if (c.schema !== undefined && typeof c.schema !== 'string') problems.push('"schema" must be a string');
  if (c.example !== undefined && typeof c.example !== 'string') problems.push('"example" must be a string');
  if (c.files !== undefined && !strings(c.files)) problems.push('"files" must be an array of strings');
  if (c.strict !== undefined && typeof c.strict !== 'boolean')
    problems.push('"strict" must be true or false');
  if (c.scan !== undefined) {
    if (!c.scan || typeof c.scan !== 'object' || Array.isArray(c.scan))
      problems.push('"scan" must be an object');
    else {
      for (const [k, v] of Object.entries(c.scan)) {
        if (!SCAN_KEYS.has(k)) problems.push(`unknown option "scan.${k}"`);
        else if (!strings(v)) problems.push(`"scan.${k}" must be an array of strings`);
      }
    }
  }
  if (problems.length > 0) throw new ConfigError(`${name}: ${problems.join('; ')}`);
  const { $schema: _s, ...rest } = c;
  return rest as EnvguardConfig;
}
