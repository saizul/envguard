import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, type EnvguardConfig, loadConfig } from '../config.js';
import { diffEnv } from '../diff.js';
import { runDoctor } from '../doctor/index.js';
import { generateExample } from '../example.js';
import { defaultEnvFiles, loadEnvFiles } from '../files.js';
import { inferSchema, schemaToTypeScript } from '../init.js';
import { parseDotenv } from '../parser/dotenv.js';
import {
  type CommandReport,
  type Colors,
  colors,
  count,
  exitCodeFor,
  type FailOn,
  type Finding,
  type Format,
  formatReport,
} from '../report/index.js';
import { builtinPatterns } from '../scan/patterns.js';
import { DEFAULT_SCAN_GLOBS, scanFiles } from '../scan/scanner.js';
import { findSchemaFile, loadSchemaFile } from '../schema/file.js';
import type { Schema } from '../schema/types.js';
import { parseEnv, SchemaError } from '../schema/validate.js';
import { VERSION } from '../version.js';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd?: string;
  env?: Record<string, string | undefined>;
  isTTY?: boolean;
}

class UsageError extends Error {}

const HELP = `envguard ${VERSION}
Type-safe environment variables and .env hygiene.

Usage: envguard <command> [options]

Commands:
  check [files...]     Validate .env files (or the process environment) against the schema
  example              Write .env.example from the schema (secrets left blank)
  diff [env] [tmpl]    Compare the keys of two env files (default: .env .env.example)
  scan [paths...]      Find real-looking secrets in committed files
  doctor               Check .gitignore, the template and the schema together
  init                 Create env.schema.json (or .ts) from an existing .env.example

Global options:
  --cwd <dir>          Run in another directory
  --config <file>      Config file (default: envguard.config.json or package.json#envguard)
  --format <f>         pretty (default), json or github (workflow annotations)
  --fail-on <level>    error (default), warning or none
  --no-color           Disable colors (NO_COLOR is respected too)
  -h, --help           Show help; "envguard <command> --help" for command options
  -v, --version        Show the version

Exit codes: 0 no problems, 1 problems found, 2 usage or configuration error.
`;

const COMMAND_HELP: Record<string, string> = {
  check: `Usage: envguard check [files...] [options]

Validates environment values against env.schema.(ts|js|json). Without files it
loads the cascade .env, .env.local, .env.<mode>, .env.<mode>.local; each file
given as an argument is validated on its own.

  --schema <file>      Schema file (default: first env.schema.* found)
  --mode <mode>        Mode for the cascade (default: NODE_ENV)
  --process-env        Validate process.env (merged over the files)
  --no-files           Do not read any .env file (use with --process-env)
  --strict             Report keys that the schema does not declare
`,
  example: `Usage: envguard example [options]

Writes the template from the schema. Secrets are left blank, descriptions
become comments. Values already in the template are kept for keys that have
no example or default.

  --schema <file>      Schema file
  -o, --output <file>  Output file (default: .env.example)
  --check              Do not write; exit 1 when the file is out of date (for CI)
  --stdout             Print instead of writing
  --keep-unknown       Keep keys that are not in the schema
  --sort               Sort keys alphabetically
`,
  diff: `Usage: envguard diff [env] [template] [options]

Lists keys missing from the env file (errors) and keys the template does not
know (warnings). Values are never printed. Defaults: .env .env.example
`,
  scan: `Usage: envguard scan [paths or globs...] [options]

Looks for credentials in files that are meant to be committed: templates,
READMEs, compose files and workflows by default.

  --allow <value>      Allow a value, a /regex/ or id:<pattern-id> (repeatable)
  --disable <id>       Turn a pattern off (repeatable)
  --exclude <glob>     Skip files (repeatable)
  --list-patterns      Print the built-in patterns

Mark a line with "envguard-allow" to skip it, or put "# envguard-allow-next-line"
above it.
`,
  doctor: `Usage: envguard doctor [options]

  --schema <file>      Schema file
  --example <file>     Template file (default: .env.example)
`,
  init: `Usage: envguard init [options]

Guesses a schema from an existing template: ports, booleans, numbers, URLs,
emails, durations and JSON; names like *_SECRET, *_TOKEN or DATABASE_URL are
marked secret.

  --from <file>        Source file (default: .env.example, else .env)
  -o, --output <file>  Output (default: env.schema.json, or env.schema.ts with --ts)
  --ts                 Write a TypeScript module that uses the builders
  --force              Overwrite an existing schema file
`,
};

const GLOBAL_OPTIONS = {
  cwd: { type: 'string' },
  config: { type: 'string' },
  format: { type: 'string' },
  'fail-on': { type: 'string' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

const COMMAND_OPTIONS = {
  check: {
    schema: { type: 'string' },
    mode: { type: 'string' },
    'process-env': { type: 'boolean' },
    'no-files': { type: 'boolean' },
    strict: { type: 'boolean' },
  },
  example: {
    schema: { type: 'string' },
    output: { type: 'string', short: 'o' },
    check: { type: 'boolean' },
    stdout: { type: 'boolean' },
    'keep-unknown': { type: 'boolean' },
    sort: { type: 'boolean' },
  },
  diff: {},
  scan: {
    allow: { type: 'string', multiple: true },
    disable: { type: 'string', multiple: true },
    exclude: { type: 'string', multiple: true },
    'list-patterns': { type: 'boolean' },
  },
  doctor: {
    schema: { type: 'string' },
    example: { type: 'string' },
  },
  init: {
    from: { type: 'string' },
    output: { type: 'string', short: 'o' },
    ts: { type: 'boolean' },
    force: { type: 'boolean' },
  },
} as const;

type CommandName = keyof typeof COMMAND_OPTIONS;
type Values = Record<string, string | boolean | string[] | undefined>;

interface Context {
  cwd: string;
  env: Record<string, string | undefined>;
  config: EnvguardConfig;
  values: Values;
  positionals: string[];
  c: Colors;
  io: CliIO;
}

/** Runs the CLI and resolves to the exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  const env = io.env ?? process.env;
  const first = argv.find((a) => !a.startsWith('-'));
  const command = first && first in COMMAND_OPTIONS ? (first as CommandName) : undefined;

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...(command ? COMMAND_OPTIONS[command] : {}) },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    io.stderr(`envguard: ${(err as Error).message}\nRun "envguard --help" for usage.\n`);
    return 2;
  }
  const values = parsed.values as Values;
  const positionals = parsed.positionals.slice();

  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (!command) {
    if (values.help || positionals.length === 0) {
      io.stdout(HELP);
      return values.help ? 0 : 2;
    }
    io.stderr(`envguard: unknown command "${positionals[0]}"\nRun "envguard --help" for usage.\n`);
    return 2;
  }
  if (values.help) {
    io.stdout(COMMAND_HELP[command] ?? HELP);
    return 0;
  }
  positionals.splice(positionals.indexOf(command), 1);

  const baseCwd = io.cwd ?? process.cwd();
  const cwd = typeof values.cwd === 'string' ? resolvePath(baseCwd, values.cwd) : baseCwd;
  const color = !values['no-color'] && env.NO_COLOR === undefined && io.isTTY === true;
  const c = colors(color);

  try {
    const format = parseFormat(values.format);
    const failOn = parseFailOn(values['fail-on']);
    const { config } = loadConfig(cwd, typeof values.config === 'string' ? values.config : undefined);
    const ctx: Context = { cwd, env, config, values, positionals, c, io };
    const report = await COMMANDS[command](ctx);
    if (report.findings.length > 0 || report.lines || format !== 'github')
      io.stdout(formatReport(report, format, c));
    return exitCodeFor(report.findings, failOn);
  } catch (err) {
    if (err instanceof UsageError || err instanceof ConfigError || err instanceof SchemaError) {
      io.stderr(`envguard: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

function resolvePath(cwd: string, p: string): string {
  return isAbsolute(p) ? p : join(cwd, p);
}

function parseFormat(v: unknown): Format {
  if (v === undefined) return 'pretty';
  if (v === 'pretty' || v === 'json' || v === 'github') return v;
  throw new UsageError(`--format must be pretty, json or github (got "${String(v)}")`);
}

function parseFailOn(v: unknown): FailOn {
  if (v === undefined) return 'error';
  if (v === 'error' || v === 'warning' || v === 'none') return v;
  throw new UsageError(`--fail-on must be error, warning or none (got "${String(v)}")`);
}

async function requireSchema(ctx: Context): Promise<{ schema: Schema; file: string }> {
  const explicit = typeof ctx.values.schema === 'string' ? ctx.values.schema : ctx.config.schema;
  const file = explicit ?? findSchemaFile(ctx.cwd);
  if (!file) {
    throw new UsageError(
      'No schema found. Create env.schema.json (try "envguard init"), or pass --schema <file>.',
    );
  }
  return { schema: await loadSchemaFile(file, ctx.cwd), file };
}

function read(ctx: Context, file: string): string {
  const path = resolvePath(ctx.cwd, file);
  if (!existsSync(path)) throw new UsageError(`File not found: ${file}`);
  return readFileSync(path, 'utf8');
}

const COMMANDS: Record<CommandName, (ctx: Context) => Promise<CommandReport>> = {
  async check(ctx) {
    const { schema, file: schemaFile } = await requireSchema(ctx);
    const strict = ctx.values.strict === true || ctx.config.strict === true;
    const findings: Finding[] = [];
    const checked: string[] = [];
    const targets: Array<{ label: string; files: string[] | null }> = [];

    if (ctx.positionals.length > 0) {
      for (const f of ctx.positionals) {
        if (!existsSync(resolvePath(ctx.cwd, f))) throw new UsageError(`File not found: ${f}`);
        targets.push({ label: f, files: [f] });
      }
    } else if (ctx.values['no-files']) {
      targets.push({ label: 'process environment', files: null });
    } else {
      const mode = typeof ctx.values.mode === 'string' ? ctx.values.mode : ctx.env.NODE_ENV;
      targets.push({ label: 'environment', files: ctx.config.files ?? defaultEnvFiles(mode) });
    }

    for (const target of targets) {
      let source: Record<string, string | undefined> = {};
      let origins = {};
      let definedKeys: string[] = [];
      if (target.files) {
        const loaded = loadEnvFiles({
          cwd: ctx.cwd,
          files: target.files,
          env: ctx.values['process-env'] ? ctx.env : {},
        });
        checked.push(...loaded.files);
        for (const p of loaded.problems)
          findings.push({
            severity: p.severity,
            message: p.message,
            rule: p.code,
            file: p.file,
            line: p.line,
          });
        source = loaded.values;
        origins = loaded.origins;
        definedKeys = Object.keys(loaded.values);
      }
      if (ctx.values['process-env']) {
        source = { ...source, ...ctx.env };
        checked.push('process.env');
      }
      const result = parseEnv(schema, source, { origins, definedKeys, strict });
      for (const issue of result.issues) {
        const f: Finding = {
          severity: issue.severity,
          message: issue.message,
          rule: issue.code,
        };
        if (issue.file) f.file = issue.file;
        else if (target.files && target.files.length === 1) f.file = target.files[0];
        if (issue.line) f.line = issue.line;
        findings.push(f);
      }
    }
    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    const where = checked.length > 0 ? checked.join(', ') : 'no .env files found';
    const keys = Object.keys(schema).length;
    const summary =
      errors + warnings === 0
        ? `${count(keys, 'variable')} valid (${where}; schema ${schemaFile})`
        : `${count(errors, 'error')}, ${count(warnings, 'warning')} (${where}; schema ${schemaFile})`;
    return { command: 'check', findings, summary, data: { schema: schemaFile, files: checked } };
  },

  async example(ctx) {
    const { schema, file: schemaFile } = await requireSchema(ctx);
    const output =
      typeof ctx.values.output === 'string' ? ctx.values.output : (ctx.config.example ?? '.env.example');
    const path = resolvePath(ctx.cwd, output);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    const existing = current !== undefined ? parseDotenv(current, { expand: false }).entries : [];
    const text = generateExample(schema, {
      existing,
      keepUnknown: ctx.values['keep-unknown'] === true,
      sort: ctx.values.sort === true,
    });
    if (ctx.values.stdout) {
      ctx.io.stdout(text);
      return { command: 'example', findings: [], summary: `built from ${schemaFile}`, lines: [] };
    }
    if (ctx.values.check) {
      if (current === text) return { command: 'example', findings: [], summary: `${output} is up to date` };
      const before = new Set(existing.map((e) => e.key));
      const missing = Object.keys(schema).filter((k) => !before.has(k));
      const detail = missing.length > 0 ? `; missing ${missing.join(', ')}` : '';
      return {
        command: 'example',
        findings: [
          {
            severity: 'error',
            rule: 'example-outdated',
            file: output,
            message: `${output} ${current === undefined ? 'does not exist' : 'is out of date'}${detail}. Run "envguard example".`,
          },
        ],
        summary: `${output} needs to be regenerated from ${schemaFile}`,
      };
    }
    const changed = current !== text;
    if (changed) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    return {
      command: 'example',
      findings: [],
      summary: changed
        ? `wrote ${output} (${count(Object.keys(schema).length, 'variable')})`
        : `${output} is already up to date`,
      data: { output, changed },
    };
  },

  async diff(ctx) {
    const [a = '.env', b = ctx.config.example ?? '.env.example'] = ctx.positionals;
    const actual = parseDotenv(read(ctx, a), { expand: false });
    const template = parseDotenv(read(ctx, b), { expand: false });
    const d = diffEnv(actual.entries, template.entries);
    const findings: Finding[] = [
      ...d.missing.map(
        (m): Finding => ({
          severity: 'error',
          rule: 'missing',
          file: a,
          message: `${m.key} is missing (defined in ${b}:${m.line})`,
        }),
      ),
      ...d.extra.map(
        (m): Finding => ({
          severity: 'warning',
          rule: 'extra',
          file: a,
          line: m.line,
          message: `${m.key} is not in ${b}`,
        }),
      ),
      ...d.empty.map(
        (m): Finding => ({
          severity: 'notice',
          rule: 'empty',
          file: a,
          line: m.line,
          message: `${m.key} is empty, while ${b} has a value`,
        }),
      ),
    ];
    const summary =
      d.missing.length + d.extra.length === 0
        ? `${a} and ${b} have the same ${count(d.common.length, 'key')}`
        : `${count(d.missing.length, 'missing key')}, ${count(d.extra.length, 'extra key')} (${a} vs ${b})`;
    return { command: 'diff', findings, summary, data: d };
  },

  async scan(ctx) {
    if (ctx.values['list-patterns']) {
      const lines = builtinPatterns.map((p) => `${p.id.padEnd(20)} ${p.severity.padEnd(8)} ${p.title}`);
      return { command: 'scan', findings: [], summary: `${builtinPatterns.length} built-in patterns`, lines };
    }
    const scan = ctx.config.scan ?? {};
    const result = scanFiles({
      cwd: ctx.cwd,
      include: ctx.positionals.length > 0 ? ctx.positionals : (scan.include ?? DEFAULT_SCAN_GLOBS),
      exclude: [...(scan.exclude ?? []), ...strings(ctx.values.exclude)],
      allow: [...(scan.allow ?? []), ...strings(ctx.values.allow)],
      disable: [...(scan.disable ?? []), ...strings(ctx.values.disable)],
    });
    const findings = result.findings.map(
      (f): Finding => ({
        severity: f.severity,
        rule: f.patternId,
        file: f.file,
        line: f.line,
        column: f.column,
        message: `${f.title}: ${f.preview}`,
      }),
    );
    const summary =
      findings.length === 0
        ? `no secrets found in ${count(result.files.length, 'file')}`
        : `${count(findings.length, 'possible secret')} in ${count(new Set(findings.map((f) => f.file)).size, 'file')} (${count(result.files.length, 'file')} scanned)`;
    return { command: 'scan', findings, summary, data: { files: result.files } };
  },

  async doctor(ctx) {
    let schema: Schema | undefined;
    let schemaFile: string | undefined;
    let schemaError: string | undefined;
    const explicit = typeof ctx.values.schema === 'string' ? ctx.values.schema : ctx.config.schema;
    schemaFile = explicit ?? findSchemaFile(ctx.cwd);
    if (schemaFile) {
      try {
        schema = await loadSchemaFile(schemaFile, ctx.cwd);
      } catch (err) {
        schemaError = (err as Error).message;
      }
    }
    const report = runDoctor({
      cwd: ctx.cwd,
      exampleFile: typeof ctx.values.example === 'string' ? ctx.values.example : ctx.config.example,
      schema,
      schemaFile,
      schemaError,
      allow: ctx.config.scan?.allow ?? [],
    });
    const { c } = ctx;
    const findings: Finding[] = [];
    const lines: string[] = [];
    const icon = { pass: c.green('✔'), warn: c.yellow('⚠'), fail: c.red('✖'), skip: c.dim('–') };
    for (const check of report.checks) {
      const worst = check.results.some((r) => r.status === 'fail')
        ? 'fail'
        : check.results.some((r) => r.status === 'warn')
          ? 'warn'
          : check.results.every((r) => r.status === 'skip')
            ? 'skip'
            : 'pass';
      const single = check.results.length === 1 ? check.results[0] : undefined;
      const tail = single && (worst === 'pass' || worst === 'skip') ? c.dim(` (${single.message})`) : '';
      lines.push(`${icon[worst]} ${check.title}${tail}`);
      for (const r of check.results) {
        if (r.status !== 'fail' && r.status !== 'warn') continue;
        lines.push(`    ${r.message}${r.file && r.line ? c.dim(` ${r.file}:${r.line}`) : ''}`);
        if (r.hint) lines.push(c.dim(`    → ${r.hint}`));
        const f: Finding = {
          severity: r.status === 'fail' ? 'error' : 'warning',
          rule: check.id,
          message: r.message,
        };
        if (r.file) f.file = r.file;
        if (r.line) f.line = r.line;
        findings.push(f);
      }
    }
    const summary =
      report.failed + report.warned === 0
        ? 'everything looks healthy'
        : `${count(report.failed, 'problem')}, ${count(report.warned, 'warning')}`;
    return { command: 'doctor', findings, summary, lines, data: report };
  },

  async init(ctx) {
    const from =
      typeof ctx.values.from === 'string'
        ? ctx.values.from
        : ['.env.example', '.env.sample', '.env.template', '.env'].find((f) =>
            existsSync(resolvePath(ctx.cwd, f)),
          );
    if (!from) throw new UsageError('Nothing to read: create .env.example first or pass --from <file>');
    const ts = ctx.values.ts === true;
    const output =
      typeof ctx.values.output === 'string' ? ctx.values.output : ts ? 'env.schema.ts' : 'env.schema.json';
    const path = resolvePath(ctx.cwd, output);
    if (existsSync(path) && !ctx.values.force)
      throw new UsageError(`${output} already exists (use --force to overwrite)`);
    const entries = parseDotenv(read(ctx, from), { expand: false }).entries;
    const schema = inferSchema(entries);
    writeFileSync(path, ts ? schemaToTypeScript(schema) : `${JSON.stringify(schema, null, 2)}\n`);
    const secrets = Object.values(schema).filter((f) => f.secret).length;
    return {
      command: 'init',
      findings: [],
      summary: `wrote ${output} with ${count(entries.length, 'variable')} from ${from} (${secrets} marked secret); review the guessed types`,
      data: { output, schema },
    };
  },
};

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' ? [v] : [];
}
