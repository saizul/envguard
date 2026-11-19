import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { env, generateDeclarations, rawValueType } from '../src/index.js';
import { cli, project } from './helpers.js';

const SCHEMA = {
  PORT: env.port({ default: 3000, description: 'HTTP port' }),
  DATABASE_URL: env.url({ secret: true, protocols: ['postgres'] }),
  LOG_LEVEL: env.enum(['debug', 'info'], { default: 'info' }),
  SENTRY_DSN: env.url({ optional: true }),
  API_KEY: env.string({ aliases: ['LEGACY_API_KEY'] }),
  VITE_API_URL: env.url({ description: 'Public API base URL\nShown to the browser */ careful' }),
};

/** Type-checks `usage` against the declarations and returns the diagnostics. */
function typecheck(declarations: string, usage: string): string[] {
  const dir = project({ 'env.d.ts': declarations, 'usage.ts': usage });
  const program = ts.createProgram([join(dir, 'env.d.ts'), join(dir, 'usage.ts')], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['node'],
    typeRoots: [join(process.cwd(), 'node_modules', '@types')],
    skipLibCheck: true,
  });
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('generateDeclarations', () => {
  it('types process.env with required, optional and enum members', () => {
    const text = generateDeclarations(SCHEMA, { source: 'env.schema.ts' });
    assert.match(text, /^\/\/ Environment variable types created by envguard from env\.schema\.ts\./);
    assert.match(text, /namespace NodeJS \{\n {4}interface ProcessEnv \{/);
    assert.match(text, /\/\*\* HTTP port\n|\* HTTP port\n/);
    assert.match(text, / {6}PORT\?: string;/);
    assert.match(text, / {6}DATABASE_URL: string;/);
    assert.match(text, / {6}LOG_LEVEL\?: "debug" \| "info";/);
    assert.match(text, / {6}SENTRY_DSN\?: string;/);
    assert.match(text, / {6}API_KEY\?: string;/);
    assert.match(text, /@deprecated Alias of API_KEY.*\n {6}LEGACY_API_KEY\?: string;/);
    assert.match(text, /\*\\\/ careful/);
    assert.doesNotMatch(text, /ImportMetaEnv/);
  });

  it('types import.meta.env with only client variables for Vite', () => {
    const vite = generateDeclarations(SCHEMA, { target: 'vite' });
    assert.match(vite, /interface ImportMetaEnv \{\n[\s\S]*readonly VITE_API_URL: string;/);
    assert.doesNotMatch(vite, /DATABASE_URL|ProcessEnv/);
    assert.match(vite, /interface ImportMeta \{\n {4}readonly env: ImportMetaEnv;/);
    const both = generateDeclarations(SCHEMA, { target: 'both', vitePrefix: 'PUBLIC_' });
    assert.match(both, /ProcessEnv/);
    assert.match(both, /interface ImportMetaEnv \{\n {2}\}/);
    assert.throws(() => generateDeclarations(SCHEMA, { target: 'deno' as 'node' }), /target must be/);
  });

  it('quotes names that are not identifiers and sorts on request', () => {
    const text = generateDeclarations({ 'my-var': env.string(), A: env.string() }, { sort: true });
    assert.ok(text.indexOf('A: string') < text.indexOf('"my-var": string'));
  });

  it('keeps raw values as strings except for case-sensitive enums', () => {
    assert.equal(rawValueType(env.port()), 'string');
    assert.equal(rawValueType(env.boolean()), 'string');
    assert.equal(rawValueType(env.enum(['a', 'b'])), '"a" | "b"');
    assert.equal(rawValueType(env.enum(['a', 'b'], { caseInsensitive: true })), 'string');
  });

  it('compiles, and the compiler catches wrong enum values and unchecked optional variables', () => {
    const declarations = generateDeclarations(SCHEMA, { target: 'both' });
    const good = [
      'const url: string = process.env.DATABASE_URL;',
      'const port: string | undefined = process.env.PORT;',
      'const level: "debug" | "info" | undefined = process.env.LOG_LEVEL;',
      'const api: string = import.meta.env.VITE_API_URL;',
      'export { url, port, level, api };',
    ].join('\n');
    assert.deepEqual(typecheck(declarations, good), []);
    const bad = [
      'const level: typeof process.env.LOG_LEVEL = "loud";',
      'const port: string = process.env.PORT;',
      'export { level, port };',
    ].join('\n');
    const errors = typecheck(declarations, bad);
    assert.ok(
      errors.some((e) => e.includes('"loud"')),
      errors.join('\n'),
    );
    assert.ok(
      errors.some((e) => e.includes('undefined')),
      errors.join('\n'),
    );
  });
});

describe('cli: types', () => {
  const schema = JSON.stringify({
    PORT: { type: 'port', default: 3000 },
    DATABASE_URL: { type: 'url', secret: true },
    VITE_TITLE: { type: 'string' },
  });

  it('writes env.d.ts and reports when it is up to date', async () => {
    const cwd = project({ 'env.schema.json': schema });
    const first = await cli(cwd, ['types']);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /wrote env\.d\.ts \(3 variables, target node\)/);
    const text = readFileSync(join(cwd, 'env.d.ts'), 'utf8');
    assert.match(text, /from env\.schema\.json\./);
    assert.match(text, /DATABASE_URL: string;/);
    assert.match((await cli(cwd, ['types'])).stdout, /already up to date/);
    assert.equal((await cli(cwd, ['types', '--check'])).code, 0);
  });

  it('fails --check when the file is missing or stale', async () => {
    const cwd = project({ 'env.schema.json': schema });
    const missing = await cli(cwd, ['types', '--check', '-o', 'src/env.d.ts', '--format', 'github']);
    assert.equal(missing.code, 1);
    assert.match(
      missing.stdout,
      /::error file=src\/env\.d\.ts,title=envguard types-outdated::.*does not exist/,
    );
    await cli(cwd, ['types', '-o', 'src/env.d.ts']);
    writeFileSync(join(cwd, 'src/env.d.ts'), '// old\n');
    const stale = await cli(cwd, ['types', '--check', '-o', 'src/env.d.ts']);
    assert.equal(stale.code, 1);
    assert.match(stale.stdout, /is out of date/);
  });

  it('prints for Vite and rejects a bad target', async () => {
    const cwd = project({ 'env.schema.json': schema });
    const r = await cli(cwd, ['types', '--stdout', '--target', 'vite']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /readonly VITE_TITLE: string;/);
    assert.ok(r.stdout.endsWith('}\n'));
    assert.doesNotMatch(r.stdout, /DATABASE_URL/);
    const bad = await cli(cwd, ['types', '--target', 'bun']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /--target must be one of node, vite, both/);
    assert.match((await cli(cwd, ['types', '--help'])).stdout, /--vite-prefix/);
  });
});
