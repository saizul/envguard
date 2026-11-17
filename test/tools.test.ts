import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  diffEnv,
  doctorChecks,
  env,
  exampleValue,
  GitIgnore,
  generateExample,
  globToRegExp,
  inferField,
  inferSchema,
  parseDotenv,
  parseEnv,
  runDoctor,
  schemaToTypeScript,
} from '../src/index.js';
import { fake, project } from './helpers.js';

const entries = (s: string) => parseDotenv(s, { expand: false }).entries;

describe('diffEnv', () => {
  it('finds missing, extra and empty keys', () => {
    const d = diffEnv(entries('A=1\nB=\nEXTRA=1\n'), entries('A=\nB=default\nC=\n'));
    assert.deepEqual(
      d.missing.map((m) => m.key),
      ['C'],
    );
    assert.deepEqual(
      d.extra.map((m) => [m.key, m.line]),
      [['EXTRA', 3]],
    );
    assert.deepEqual(
      d.empty.map((m) => m.key),
      ['B'],
    );
    assert.deepEqual(d.common, ['A', 'B']);
  });
});

describe('generateExample', () => {
  const schema = {
    PORT: env.port({ default: 3000, description: 'HTTP port' }),
    DATABASE_URL: env.url({ secret: true, description: 'Postgres connection string\nUse the pooled URL' }),
    LOG_LEVEL: env.enum(['debug', 'info'], { default: 'info' }),
    TIMEOUT: env.duration({ default: 90_000 }),
    HOSTS: env.list({ default: ['a', 'b'] }),
    FEATURES: env.json({ default: { beta: true } }),
    GREETING: env.string({ example: 'স্বাগতম বন্ধু' }),
    OPTIONAL: env.string({ optional: true }),
    TOKEN: env.string({ secret: true, example: 'never shown' }),
  };

  it('writes descriptions, type lines and safe values', () => {
    const text = generateExample(schema);
    assert.match(text, /^# Copy this file to \.env/);
    assert.match(text, /# HTTP port\n# port \(1-65535\), default: 3000\nPORT=3000\n/);
    assert.match(
      text,
      /# Postgres connection string\n# Use the pooled URL\n# url, required, secret\nDATABASE_URL=\n/,
    );
    assert.match(text, /LOG_LEVEL=info/);
    assert.match(text, /# one of debug \| info, default: info/);
    assert.match(text, /TIMEOUT=1m30s/);
    assert.match(text, /HOSTS=a,b/);
    assert.match(text, /FEATURES="\{\\"beta\\":true\}"/);
    assert.match(text, /GREETING="স্বাগতম বন্ধু"/);
    assert.match(text, /# string, optional\nOPTIONAL=\n/);
    assert.match(text, /TOKEN=\n/);
    assert.ok(!text.includes('never shown'));
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  });

  it('round-trips: the written template validates against the schema except for secrets', () => {
    const parsed = parseDotenv(generateExample(schema)).values;
    const r = parseEnv(schema, parsed);
    assert.deepEqual(
      r.issues.map((i) => i.key),
      ['DATABASE_URL', 'TOKEN'],
    );
    const filled = parseEnv(schema, { ...parsed, DATABASE_URL: 'postgres://h/db', TOKEN: 't' });
    assert.deepEqual(filled.env.FEATURES, { beta: true });
    assert.equal(filled.env.GREETING, 'স্বাগতম বন্ধু');
  });

  it('keeps hand-written values and unknown keys when asked', () => {
    const existing = entries('OPTIONAL=kept\nDATABASE_URL=leaked\nLEGACY=1\n');
    const text = generateExample(schema, { existing, keepUnknown: true, header: null });
    assert.match(text, /^# HTTP port/);
    assert.match(text, /OPTIONAL=kept/);
    assert.match(text, /DATABASE_URL=\n/);
    assert.match(text, /# Not declared in the schema\nLEGACY=1\n$/);
  });

  it('can sort and omit type comments', () => {
    const text = generateExample(
      { B: env.string(), A: env.string() },
      { sort: true, header: null, typeComments: false },
    );
    assert.equal(text, 'A=\n\nB=\n');
  });

  it('exampleValue prefers example over default', () => {
    assert.equal(exampleValue({ type: 'string', default: 'd', example: 'e' }), 'e');
    assert.equal(exampleValue({ type: 'string', default: 'd' }), 'd');
    assert.equal(exampleValue({ type: 'string', secret: true, default: 'd' }), '');
  });
});

describe('init: inferSchema', () => {
  it('guesses types, secrets and defaults', () => {
    const s = inferSchema(
      entries(
        [
          '# HTTP port',
          'PORT=3000',
          'DEBUG=false',
          'WORKERS=4',
          'RATIO=0.5',
          'TIMEOUT=30s',
          'APP_URL=https://example.com',
          'ADMIN_EMAIL=admin@example.com',
          'FLAGS={"a":1}',
          'DATABASE_URL=postgres://localhost/app',
          'JWT_SECRET=',
          'STRIPE_API_KEY=',
          'NEXT_PUBLIC_API_KEY=pk_test',
          'NAME=demo',
          'WEBHOOK_URL=',
        ].join('\n'),
      ),
    );
    assert.deepEqual(s.PORT, { type: 'port', description: 'HTTP port', default: 3000 });
    assert.deepEqual(s.DEBUG, { type: 'boolean', default: false });
    assert.equal(s.WORKERS!.type, 'integer');
    assert.equal(s.RATIO!.type, 'number');
    assert.deepEqual(s.TIMEOUT, { type: 'duration', default: '30s' });
    assert.equal(s.APP_URL!.type, 'url');
    assert.equal(s.ADMIN_EMAIL!.type, 'email');
    assert.equal(s.FLAGS!.type, 'json');
    assert.deepEqual(s.DATABASE_URL, { type: 'url', secret: true });
    assert.deepEqual(s.JWT_SECRET, { type: 'string', secret: true });
    assert.equal(s.STRIPE_API_KEY!.secret, true);
    assert.equal(s.NEXT_PUBLIC_API_KEY!.secret, undefined);
    assert.deepEqual(s.NAME, { type: 'string', default: 'demo' });
    assert.deepEqual(s.WEBHOOK_URL, { type: 'url' });
  });

  it('ignores the type lines written by generateExample', () => {
    const text = generateExample({ PORT: env.port({ default: 1, description: 'Port' }) });
    assert.equal(inferSchema(entries(text)).PORT!.description, 'Port');
  });

  it('inferField on its own', () => {
    assert.equal(inferField('X', 'true').type, 'boolean');
  });

  it('renders TypeScript', () => {
    const ts = schemaToTypeScript({
      PORT: { type: 'port', default: 3000 },
      LEVEL: { type: 'enum', values: ['a', 'b'], default: 'a' },
      TOKEN: { type: 'string', secret: true },
    });
    assert.match(ts, /import \{ defineSchema, env \} from '@saizul\/envguard';/);
    assert.match(ts, /PORT: env\.port\(\{ default: 3000 \}\),/);
    assert.match(ts, /LEVEL: env\.enum\(\["a","b"\], \{ default: "a" \}\),/);
    assert.match(ts, /TOKEN: env\.string\(\{ secret: true \}\),/);
  });
});

describe('GitIgnore', () => {
  it('handles the common env rules', () => {
    const g = new GitIgnore('# deps\nnode_modules/\n.env\n.env.*\n!.env.example\n');
    assert.equal(g.ignores('.env'), true);
    assert.equal(g.ignores('.env.local'), true);
    assert.equal(g.ignores('.env.production.local'), true);
    assert.equal(g.ignores('.env.example'), false);
    assert.equal(g.ignores('apps/web/.env'), true);
    assert.equal(g.ignores('node_modules/x/index.js'), true);
    assert.equal(g.ignores('node_modules'), false);
    assert.equal(g.ignores('node_modules', true), true);
    assert.equal(g.explain('.env.example'), '!.env.example');
  });

  it('anchored patterns only match at the root', () => {
    const g = new GitIgnore('/.env\nconfig/*.local\n');
    assert.equal(g.ignores('.env'), true);
    assert.equal(g.ignores('apps/.env'), false);
    assert.equal(g.ignores('config/a.local'), true);
    assert.equal(g.ignores('x/config/a.local'), false);
  });

  it('a file inside an ignored directory cannot be re-included', () => {
    const g = new GitIgnore('secrets/\n!secrets/.env.example\n');
    assert.equal(g.ignores('secrets/.env.example'), true);
  });

  it('*.env and .env* forms', () => {
    assert.equal(new GitIgnore('*.env').ignores('prod.env'), true);
    assert.equal(new GitIgnore('.env*').ignores('.env.example'), true);
    assert.equal(new GitIgnore('.env*.local').ignores('.env.development.local'), true);
    assert.equal(new GitIgnore('.env*.local').ignores('.env'), false);
  });
});

describe('globToRegExp', () => {
  it('supports **, *, ?, braces and classes', () => {
    assert.ok(globToRegExp('**/README*').test('README.md'));
    assert.ok(globToRegExp('**/README*').test('docs/a/README.md'));
    assert.ok(!globToRegExp('*.md').test('docs/a.md'));
    assert.ok(globToRegExp('docker-compose*.{yml,yaml}').test('docker-compose.prod.yaml'));
    assert.ok(globToRegExp('file?.txt').test('file1.txt'));
    assert.ok(globToRegExp('[ab].txt').test('a.txt'));
    assert.ok(!globToRegExp('[!ab].txt').test('a.txt'));
    assert.ok(globToRegExp('a.b').test('a.b') && !globToRegExp('a.b').test('axb'));
  });
});

describe('runDoctor', () => {
  const status = (report: ReturnType<typeof runDoctor>) =>
    Object.fromEntries(
      report.checks.map((c) => [
        c.id,
        c.results.some((r) => r.status === 'fail')
          ? 'fail'
          : c.results.some((r) => r.status === 'warn')
            ? 'warn'
            : c.results.every((r) => r.status === 'skip')
              ? 'skip'
              : 'pass',
      ]),
    );

  it('passes on a healthy project', () => {
    const schema = { PORT: env.port({ default: 3000 }), TOKEN: env.string({ secret: true }) };
    const cwd = project({
      '.gitignore': '.env\n.env.*\n!.env.example\n',
      '.env': 'PORT=1\nTOKEN=abc\n',
      '.env.example': generateExample(schema),
    });
    const r = runDoctor({ cwd, schema, schemaFile: 'env.schema.json' });
    assert.equal(r.failed, 0);
    assert.equal(r.warned, 0);
    assert.deepEqual(status(r), {
      'env-gitignored': 'pass',
      'example-exists': 'pass',
      'example-committable': 'pass',
      'schema-valid': 'pass',
      'example-in-sync': 'pass',
      'env-complete': 'pass',
      'env-syntax': 'pass',
      'template-no-secrets': 'pass',
    });
  });

  it('finds the usual mistakes', () => {
    const cwd = project({
      '.gitignore': 'node_modules\n.env*\n',
      '.env.production': 'A=1\n',
      '.env.example': `A=\nB=\nGITHUB_TOKEN=${fake.github()}\nBROKEN="x\n`,
    });
    const r = runDoctor({ cwd, schema: { A: env.string(), C: env.string() }, schemaFile: 'env.schema.json' });
    const s = status(r);
    assert.equal(s['env-gitignored'], 'pass');
    assert.equal(s['example-committable'], 'fail');
    assert.equal(s['example-in-sync'], 'warn');
    assert.equal(s['env-complete'], 'skip');
    assert.equal(s['env-syntax'], 'fail');
    assert.equal(s['template-no-secrets'], 'fail');
    const sync = r.checks.find((c) => c.id === 'example-in-sync')!.results.map((x) => x.message);
    assert.ok(sync.some((m) => m.startsWith('C is in the schema')));
    assert.ok(sync.some((m) => m.startsWith('B is in .env.example')));
  });

  it('fails without .gitignore and flags an unignored .env', () => {
    const none = runDoctor({ cwd: project({ '.env': 'A=1\n' }) });
    assert.equal(status(none)['env-gitignored'], 'fail');
    assert.equal(status(none)['schema-valid'], 'warn');
    assert.equal(status(none)['example-exists'], 'warn');
    const partial = runDoctor({ cwd: project({ '.gitignore': 'dist\n', '.env': 'A=1\n' }) });
    const res = partial.checks[0]!.results;
    assert.equal(res[0]!.message, '.env is not ignored by .gitignore');
    assert.equal(res[1]!.status, 'warn');
  });

  it('reports a schema error and accepts custom checks', () => {
    const cwd = project({ '.gitignore': '.env\n' });
    const r = runDoctor({ cwd, schemaError: 'bad schema', schemaFile: 'env.schema.json' });
    assert.equal(status(r)['schema-valid'], 'fail');
    const custom = runDoctor({
      cwd,
      checks: [
        ...doctorChecks.slice(0, 1),
        {
          id: 'boom',
          title: 'Crashes',
          run: () => {
            throw new Error('oops');
          },
        },
      ],
    });
    assert.equal(custom.checks.length, 2);
    assert.match(custom.checks[1]!.results[0]!.message, /check crashed: oops/);
  });
});
