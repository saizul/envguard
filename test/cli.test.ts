import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { VERSION } from '../src/index.js';
import { cli, fake, project } from './helpers.js';

const SCHEMA = JSON.stringify({
  PORT: { type: 'port', default: 3000, description: 'HTTP port' },
  DATABASE_URL: { type: 'url', secret: true, protocols: ['postgres'] },
  DEBUG: { type: 'boolean', default: false },
  LOG_LEVEL: { type: 'enum', values: ['debug', 'info', 'warn'], default: 'info' },
});

describe('cli: general', () => {
  it('prints help and version', async () => {
    const cwd = project({});
    const help = await cli(cwd, ['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage: envguard <command>/);
    assert.equal((await cli(cwd, ['-v'])).stdout, `${VERSION}\n`);
    assert.match((await cli(cwd, ['check', '--help'])).stdout, /--process-env/);
    assert.equal((await cli(cwd, [])).code, 2);
  });

  it('rejects unknown commands and options', async () => {
    const cwd = project({});
    const a = await cli(cwd, ['launch']);
    assert.equal(a.code, 2);
    assert.match(a.stderr, /unknown command "launch"/);
    const b = await cli(cwd, ['check', '--nope']);
    assert.equal(b.code, 2);
    assert.match(b.stderr, /Unknown option/);
    const c = await cli(cwd, ['scan', '--format', 'xml']);
    assert.equal(c.code, 2);
    assert.match(c.stderr, /--format must be/);
  });

  it('reports a bad config file', async () => {
    const cwd = project({ 'envguard.config.json': '{"schemaa": "x"}' });
    const r = await cli(cwd, ['scan']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown option "schemaa"/);
  });
});

describe('cli: check', () => {
  it('passes with valid files', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA, '.env': 'DATABASE_URL=postgres://h/db\n' });
    const r = await cli(cwd, ['check']);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /✔ 4 variables valid \(\.env; schema env\.schema\.json\)/);
  });

  it('reports all problems with locations', async () => {
    const cwd = project({
      'env.schema.json': SCHEMA,
      '.env': 'PORT=99999\nDEBUG=perhaps\nLOG_LEVEL=loud\n',
    });
    const r = await cli(cwd, ['check']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /DATABASE_URL is missing/);
    assert.match(r.stdout, /\s1 {2}error\s+PORT must be between 1 and 65535/);
    assert.match(r.stdout, /\s2 {2}error\s+DEBUG must be true or false/);
    assert.match(r.stdout, /\s3 {2}error\s+LOG_LEVEL must be one of: debug, info, warn/);
    assert.match(r.stdout, /4 errors, 0 warnings/);
  });

  it('emits GitHub annotations', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA, '.env': 'PORT=x\nDATABASE_URL=mysql://h/db\n' });
    const r = await cli(cwd, ['check', '--format', 'github']);
    assert.equal(r.code, 1);
    const lines = r.stdout.trim().split('\n');
    assert.equal(
      lines[0],
      '::error file=.env,line=1,title=envguard invalid::PORT is not a port number; got "x"',
    );
    // Secrets are masked even in annotations.
    assert.match(
      lines[1]!,
      /^::error file=\.env,line=2,title=envguard invalid::DATABASE_URL must use postgres: \(got mysql:\); got "my\*+"/,
    );
    assert.ok(!r.stdout.includes('mysql://h/db'));
  });

  it('prints JSON', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA, '.env': 'PORT=x\n' });
    const r = await cli(cwd, ['check', '--format', 'json']);
    const data = JSON.parse(r.stdout);
    assert.equal(data.command, 'check');
    assert.equal(data.errors, 2);
    assert.deepEqual(
      data.findings.map((f: { rule: string }) => f.rule),
      ['missing', 'invalid'],
    );
  });

  it('validates given files one by one', async () => {
    const cwd = project({
      'env.schema.json': SCHEMA,
      '.env.staging': 'DATABASE_URL=postgres://s/db\n',
      '.env.production': 'PORT=0\n',
    });
    const r = await cli(cwd, ['check', '.env.staging', '.env.production']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /\.env\.production/);
    assert.ok(!/\.env\.staging\n/.test(r.stdout));
  });

  it('uses the mode cascade', async () => {
    const cwd = project({
      'env.schema.json': SCHEMA,
      '.env': 'DATABASE_URL=postgres://h/db\nPORT=1\n',
      '.env.production': 'PORT=bad\n',
    });
    assert.equal((await cli(cwd, ['check'])).code, 0);
    const prod = await cli(cwd, ['check', '--mode', 'production']);
    assert.equal(prod.code, 1);
    assert.match(prod.stdout, /\.env\.production/);
    assert.equal((await cli(cwd, ['check'], { NODE_ENV: 'production' })).code, 1);
  });

  it('validates the process environment', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA });
    const ok = await cli(cwd, ['check', '--no-files', '--process-env'], { DATABASE_URL: 'postgres://ci/db' });
    assert.equal(ok.code, 0, ok.stdout);
    const bad = await cli(cwd, ['check', '--no-files', '--process-env'], {});
    assert.equal(bad.code, 1);
  });

  it('strict mode warns about undeclared keys; --fail-on decides the exit code', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA, '.env': 'DATABASE_URL=postgres://h/db\nSTRAY=1\n' });
    const r = await cli(cwd, ['check', '--strict']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /STRAY is set but not declared/);
    assert.equal((await cli(cwd, ['check', '--strict', '--fail-on', 'warning'])).code, 1);
  });

  it('reports parse problems from the file', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA, '.env': 'DATABASE_URL=postgres://h/db\nA=1\nA=2\n' });
    const r = await cli(cwd, ['check', '--fail-on', 'warning']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /A is defined again/);
  });

  it('loads JavaScript schema files', async () => {
    const cwd = project({
      'env.schema.mjs':
        'export default { NAME: { type: "string", default: "x" }, N: { type: "integer" } };\n',
      '.env': 'N=4\n',
    });
    assert.equal((await cli(cwd, ['check'])).code, 0);
    const cjs = project({
      'env.schema.cjs': 'module.exports = { N: { type: "integer" } };\n',
      '.env': 'N=x\n',
    });
    assert.equal((await cli(cjs, ['check'])).code, 1);
    const named = project({
      'env.schema.mjs': 'export const schema = { N: { type: "integer" } };\n',
      '.env': 'N=1\n',
    });
    assert.equal((await cli(named, ['check'])).code, 0);
  });

  // Node 22.18+ and 23.6+ strip TypeScript types natively.
  const stripsTypes = Boolean((process.features as { typescript?: unknown }).typescript);
  it('loads env.schema.ts when Node can strip types', { skip: !stripsTypes }, async () => {
    const cwd = project({
      'env.schema.ts':
        'const schema: Record<string, { type: string; default?: unknown }> = { PORT: { type: "port", default: 1 } };\nexport default schema;\n',
      '.env': 'PORT=80\n',
    });
    const r = await cli(cwd, ['check']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /schema env\.schema\.ts/);
  });

  it('explains a missing or broken schema', async () => {
    const none = await cli(project({}), ['check']);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /No schema found/);
    const broken = await cli(project({ 'env.schema.json': '{"A":{"type":"nope"}}' }), ['check']);
    assert.equal(broken.code, 2);
    assert.match(broken.stderr, /unknown type "nope"/);
    const json = await cli(project({ 'env.schema.json': '{' }), ['check']);
    assert.match(json.stderr, /not valid JSON/);
  });

  it('respects the config file', async () => {
    const cwd = project({
      'config/env.json': SCHEMA,
      'envguard.config.json': JSON.stringify({ schema: 'config/env.json', files: ['app.env'] }),
      'app.env': 'DATABASE_URL=postgres://h/db\n',
    });
    const r = await cli(cwd, ['check']);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /app\.env; schema config\/env\.json/);
  });
});

describe('cli: example', () => {
  it('writes, then reports up to date, and --check detects drift', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA });
    const first = await cli(cwd, ['example']);
    assert.equal(first.code, 0);
    assert.match(first.stdout, /wrote \.env\.example \(4 variables\)/);
    const text = readFileSync(join(cwd, '.env.example'), 'utf8');
    assert.match(text, /# HTTP port\n# port \(1-65535\), default: 3000\nPORT=3000/);
    assert.match(text, /DATABASE_URL=\n/);
    assert.match((await cli(cwd, ['example'])).stdout, /already up to date/);
    assert.equal((await cli(cwd, ['example', '--check'])).code, 0);

    writeFileSync(
      join(cwd, 'env.schema.json'),
      JSON.stringify({ ...JSON.parse(SCHEMA), NEW_KEY: { type: 'string' } }),
    );
    const drift = await cli(cwd, ['example', '--check', '--format', 'github']);
    assert.equal(drift.code, 1);
    assert.match(
      drift.stdout,
      /::error file=\.env\.example,title=envguard example-outdated::.*missing NEW_KEY/,
    );
  });

  it('prints to stdout and honours --output', async () => {
    const cwd = project({ 'env.schema.json': SCHEMA });
    const r = await cli(cwd, ['example', '--stdout']);
    assert.match(r.stdout, /^# Copy this file/);
    assert.ok(!existsSync(join(cwd, '.env.example')));
    const o = await cli(cwd, ['example', '-o', 'templates/.env.sample']);
    assert.equal(o.code, 0);
    assert.ok(existsSync(join(cwd, 'templates/.env.sample')));
    assert.ok(!existsSync(join(cwd, '.env.example')));
  });
});

describe('cli: diff', () => {
  it('lists missing and extra keys and never prints values', async () => {
    const secret = fake.generic();
    const cwd = project({ '.env': `A=1\nEXTRA=${secret}\n`, '.env.example': 'A=\nB=\n' });
    const r = await cli(cwd, ['diff']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /B is missing \(defined in \.env\.example:2\)/);
    assert.match(r.stdout, /EXTRA is not in \.env\.example/);
    assert.ok(!r.stdout.includes(secret));
  });

  it('exits 0 when only extra keys exist, unless --fail-on warning', async () => {
    const cwd = project({ 'a.env': 'A=1\nB=2\n', 'b.env': 'A=\n' });
    assert.equal((await cli(cwd, ['diff', 'a.env', 'b.env'])).code, 0);
    assert.equal((await cli(cwd, ['diff', 'a.env', 'b.env', '--fail-on', 'warning'])).code, 1);
    assert.match((await cli(cwd, ['diff', 'a.env', 'a.env'])).stdout, /same 2 keys/);
  });

  it('errors on a missing file', async () => {
    const r = await cli(project({}), ['diff']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /File not found: \.env/);
  });
});

describe('cli: scan', () => {
  it('finds secrets, masks them and exits 1', async () => {
    const token = fake.github();
    const cwd = project({ '.env.example': `GITHUB_TOKEN=${token}\n`, 'README.md': '# Demo\n' });
    const r = await cli(cwd, ['scan']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /GitHub token: ghp_\*+/);
    assert.ok(!r.stdout.includes(token));
    assert.match(r.stdout, /1 possible secret in 1 file \(2 files scanned\)/);
    const gh = await cli(cwd, ['scan', '--format', 'github']);
    assert.match(
      gh.stdout,
      /^::error file=\.env\.example,line=1,col=14,title=envguard github-token::GitHub token/,
    );
  });

  it('honours --allow, --disable and config allowlists', async () => {
    const token = fake.github();
    const cwd = project({ '.env.example': `GITHUB_TOKEN=${token}\n` });
    assert.equal((await cli(cwd, ['scan', '--allow', token.slice(0, 12)])).code, 0);
    assert.equal((await cli(cwd, ['scan', '--disable', 'github-token'])).code, 0);
    writeFileSync(
      join(cwd, 'envguard.config.json'),
      JSON.stringify({ scan: { allow: ['id:github-token'] } }),
    );
    assert.equal((await cli(cwd, ['scan'])).code, 0);
  });

  it('scans given paths and lists patterns', async () => {
    const cwd = project({ 'deploy/values.yaml': `key: ${fake.stripe()}\n` });
    assert.equal((await cli(cwd, ['scan'])).code, 0);
    assert.equal((await cli(cwd, ['scan', 'deploy/**/*.yaml'])).code, 1);
    const list = await cli(cwd, ['scan', '--list-patterns']);
    assert.match(list.stdout, /aws-access-key-id\s+error\s+AWS access key ID/);
  });

  it('warnings alone do not fail by default', async () => {
    const cwd = project({ 'README.md': `DATABASE_URL=${fake.urlPassword()}\n` });
    assert.equal((await cli(cwd, ['scan'])).code, 0);
    assert.equal((await cli(cwd, ['scan', '--fail-on', 'warning'])).code, 1);
  });
});

describe('cli: doctor', () => {
  it('prints a checklist and fails on problems', async () => {
    const cwd = project({
      '.gitignore': '.env*\n',
      '.env.example': 'A=\n',
      'env.schema.json': '{"A":{"type":"string"}}',
    });
    const r = await cli(cwd, ['doctor']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /✖ The template is not ignored by git/);
    assert.match(r.stdout, /→ Add "!\.env\.example" to \.gitignore/);
    assert.match(r.stdout, /✔ The schema loads \(env\.schema\.json declares 1 variables\)/);
  });

  it('passes on a healthy project and reports schema errors', async () => {
    const cwd = project({
      '.gitignore': '.env\n.env.*\n!.env.example\n',
      '.env.example': 'A=\n',
      '.env': 'A=1\n',
      'env.schema.json': '{"A":{"type":"string"}}',
    });
    const r = await cli(cwd, ['doctor']);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /everything looks healthy/);
    writeFileSync(join(cwd, 'env.schema.json'), '{"A":{"type":"strin"}}');
    const bad = await cli(cwd, ['doctor', '--format', 'json']);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(bad.stdout).findings[0].rule, 'schema-valid');
  });
});

describe('cli: init', () => {
  it('creates env.schema.json from .env.example and refuses to overwrite', async () => {
    const cwd = project({ '.env.example': '# Port\nPORT=8080\nAPI_TOKEN=\n' });
    const r = await cli(cwd, ['init']);
    assert.equal(r.code, 0);
    assert.match(
      r.stdout,
      /wrote env\.schema\.json with 2 variables from \.env\.example \(1 marked secret\)/,
    );
    const schema = JSON.parse(readFileSync(join(cwd, 'env.schema.json'), 'utf8'));
    assert.deepEqual(schema.PORT, { type: 'port', description: 'Port', default: 8080 });
    const again = await cli(cwd, ['init']);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /already exists/);
    assert.equal((await cli(cwd, ['init', '--force'])).code, 0);
    // The new schema is immediately usable.
    writeFileSync(join(cwd, '.env'), 'API_TOKEN=t\n');
    assert.equal((await cli(cwd, ['check'])).code, 0);
  });

  it('writes TypeScript with --ts', async () => {
    const cwd = project({ '.env.example': 'DEBUG=true\n' });
    await cli(cwd, ['init', '--ts']);
    assert.match(
      readFileSync(join(cwd, 'env.schema.ts'), 'utf8'),
      /DEBUG: env\.boolean\(\{ default: true \}\)/,
    );
  });

  it('needs a source file', async () => {
    const r = await cli(project({}), ['init']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Nothing to read/);
  });
});
