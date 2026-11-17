import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertValidSchema,
  EnvValidationError,
  env,
  formatDuration,
  loadEnv,
  mask,
  parseDuration,
  parseEnv,
  redact,
  registerType,
  SchemaError,
} from '../src/index.js';
import { project } from './helpers.js';

describe('types', () => {
  const one = (field: Parameters<typeof parseEnv>[0][string], raw: string) =>
    parseEnv({ V: field }, { V: raw });

  it('string with length and pattern', () => {
    assert.equal(one(env.string(), '  hi  ').env.V, 'hi');
    assert.equal(one(env.string({ trim: false }), ' hi ').env.V, ' hi ');
    assert.match(one(env.string({ minLength: 3 }), 'ab').issues[0]!.message, /at least 3 characters/);
    assert.match(one(env.string({ maxLength: 2 }), 'abc').issues[0]!.message, /at most 2/);
    assert.equal(one(env.string({ pattern: '^[a-z]+$' }), 'abc').ok, true);
    assert.match(one(env.string({ pattern: '^[a-z]+$' }), 'ab1').issues[0]!.message, /must match/);
    // Length counts code points, so Bangla and emoji are not over-counted.
    assert.equal(one(env.string({ maxLength: 2 }), '👋👋').ok, true);
  });

  it('number and integer', () => {
    assert.equal(one(env.number(), '3.5').env.V, 3.5);
    assert.equal(one(env.number(), '1_000').env.V, 1000);
    assert.equal(one(env.number(), '-2e3').env.V, -2000);
    assert.equal(one(env.number(), '12abc').ok, false);
    assert.equal(one(env.number(), 'Infinity').ok, false);
    assert.match(one(env.number({ min: 1, max: 5 }), '9').issues[0]!.message, /at most 5/);
    assert.match(one(env.number({ integer: true }), '1.5').issues[0]!.message, /whole number/);
    assert.equal(one(env.integer(), '42').env.V, 42);
    assert.equal(one(env.integer(), '4.2').ok, false);
    assert.equal(one(env.integer({ min: 0 }), '-1').ok, false);
  });

  it('boolean accepts common spellings', () => {
    for (const t of ['true', 'TRUE', '1', 'yes', 'on', 'y'])
      assert.equal(one(env.boolean(), t).env.V, true, t);
    for (const f of ['false', '0', 'no', 'off', 'N']) assert.equal(one(env.boolean(), f).env.V, false, f);
    assert.equal(one(env.boolean(), 'maybe').ok, false);
  });

  it('url with protocols', () => {
    assert.equal(one(env.url(), 'https://example.com/x').env.V, 'https://example.com/x');
    assert.equal(one(env.url(), 'example.com').ok, false);
    const pg = env.url({ protocols: ['postgres', 'postgresql'] });
    assert.equal(one(pg, 'postgresql://u@h/db').ok, true);
    assert.match(one(pg, 'mysql://u@h/db').issues[0]!.message, /must use postgres: or postgresql:/);
  });

  it('email', () => {
    assert.equal(one(env.email(), 'saizul@example.com').ok, true);
    assert.equal(one(env.email(), 'user@ডোমেইন.বাংলা').ok, true);
    for (const bad of ['nope', 'a@b', 'a b@c.com', '@x.com'])
      assert.equal(one(env.email(), bad).ok, false, bad);
  });

  it('enum, with and without case folding', () => {
    const e = env.enum(['debug', 'info', 'warn'] as const);
    assert.equal(one(e, 'info').env.V, 'info');
    assert.match(one(e, 'INFO').issues[0]!.message, /one of: debug, info, warn/);
    assert.equal(one(env.enum(['debug', 'info'], { caseInsensitive: true }), 'INFO').env.V, 'info');
  });

  it('port', () => {
    assert.equal(one(env.port(), '8080').env.V, 8080);
    assert.equal(one(env.port(), '0').ok, false);
    assert.equal(one(env.port({ allowZero: true }), '0').env.V, 0);
    assert.equal(one(env.port(), '70000').ok, false);
    assert.equal(one(env.port(), '80.5').ok, false);
  });

  it('json', () => {
    assert.deepEqual(one(env.json(), '{"a":[1,2]}').env.V, { a: [1, 2] });
    assert.match(one(env.json(), '{a:1}').issues[0]!.message, /not valid JSON/);
  });

  it('duration', () => {
    assert.equal(one(env.duration(), '1h30m').env.V, 5_400_000);
    assert.equal(one(env.duration(), '250').env.V, 250);
    assert.equal(one(env.duration({ max: 1000 }), '2s').ok, false);
    assert.equal(one(env.duration(), 'soon').ok, false);
  });

  it('list', () => {
    assert.deepEqual(one(env.list(), 'a, b,,c ').env.V, ['a', 'b', 'c']);
    assert.deepEqual(one(env.list({ separator: ';' }), 'x;y').env.V, ['x', 'y']);
    assert.equal(one(env.list({ minItems: 2 }), 'x').ok, false);
  });
});

describe('parseDuration / formatDuration', () => {
  it('parses units and combinations', () => {
    assert.equal(parseDuration('500ms'), 500);
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('5m'), 300_000);
    assert.equal(parseDuration('5min'), 300_000);
    assert.equal(parseDuration('1.5h'), 5_400_000);
    assert.equal(parseDuration('2d'), 172_800_000);
    assert.equal(parseDuration('1w'), 604_800_000);
    assert.equal(parseDuration('1h 30m'), 5_400_000);
    assert.equal(parseDuration('10x'), undefined);
    assert.equal(parseDuration('m5'), undefined);
    assert.equal(parseDuration(''), undefined);
  });

  it('formats', () => {
    assert.equal(formatDuration(90_000), '1m30s');
    assert.equal(formatDuration(1500), '1s500ms');
    assert.equal(formatDuration(0), '0ms');
    assert.equal(formatDuration(86_400_000), '1d');
  });
});

describe('parseEnv', () => {
  const schema = {
    PORT: env.port({ default: 3000 }),
    NODE_ENV: env.enum(['development', 'production', 'test'], { default: 'development' }),
    DATABASE_URL: env.url({ secret: true, description: 'Main database' }),
    SENTRY_DSN: env.url({ optional: true }),
    TIMEOUT: env.duration({ default: '30s' }),
    TAGS: env.list({ default: ['a'] }),
    API_KEY: env.string({ secret: true, minLength: 20 }),
    ADMIN: env.email({ example: 'admin@example.com' }),
  };

  it('collects every problem at once', () => {
    const r = parseEnv(schema, { PORT: 'abc', API_KEY: 'short-but-secret' });
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.issues.map((i) => [i.key, i.code]),
      [
        ['PORT', 'invalid'],
        ['DATABASE_URL', 'missing'],
        ['API_KEY', 'invalid'],
        ['ADMIN', 'missing'],
      ],
    );
    const err = new EnvValidationError(r.issues);
    assert.match(err.message, /4 problems/);
    assert.match(err.message, /DATABASE_URL is missing; expected url \(Main database\)/);
    assert.match(err.message, /Example: admin@example.com/);
  });

  it('never prints a secret value', () => {
    const secret = ['Zq81', 'Lm2N'].join('');
    const r = parseEnv(schema, { API_KEY: secret });
    const issue = r.issues.find((i) => i.key === 'API_KEY')!;
    assert.ok(!issue.message.includes(secret));
    assert.equal(issue.value, mask(secret));
  });

  it('applies defaults and returns typed values', () => {
    const r = parseEnv(schema, { DATABASE_URL: 'postgres://h/db', API_KEY: 'x'.repeat(20), ADMIN: 'a@b.co' });
    assert.equal(r.ok, true);
    assert.equal(r.env.PORT, 3000);
    assert.equal(r.env.NODE_ENV, 'development');
    assert.equal(r.env.SENTRY_DSN, undefined);
    assert.equal(r.env.TIMEOUT, 30_000);
    assert.deepEqual(r.env.TAGS, ['a']);
    assert.ok(Object.isFrozen(r.env));
  });

  it('treats empty strings as missing unless told otherwise', () => {
    const s = { A: env.string() };
    assert.equal(parseEnv(s, { A: '' }).issues[0]!.code, 'empty');
    assert.equal(parseEnv(s, { A: '' }, { emptyAsMissing: false }).ok, true);
    assert.equal(parseEnv({ P: env.port({ default: 1 }) }, { P: '' }).env.P, 1);
  });

  it('reads aliases in order', () => {
    const s = { DATABASE_URL: env.url({ aliases: ['POSTGRES_URL', 'PG_URL'] }) };
    assert.equal(
      parseEnv(s, { PG_URL: 'postgres://b', POSTGRES_URL: 'postgres://a' }).env.DATABASE_URL,
      'postgres://a',
    );
    assert.match(parseEnv(s, { PG_URL: 'nope' }).issues[0]!.message, /read from PG_URL/);
  });

  it('accepts booleans and numbers in the source (import.meta.env)', () => {
    const r = parseEnv({ DEV: env.boolean(), N: env.number() }, { DEV: true, N: 2 });
    assert.deepEqual({ ...r.env }, { DEV: true, N: 2 });
  });

  it('reports unknown keys in strict mode as warnings', () => {
    const r = parseEnv(
      { A: env.string({ aliases: ['A_OLD'] }) },
      { A: '1', B: '2', A_OLD: '3' },
      {
        strict: true,
        definedKeys: ['A', 'B', 'A_OLD'],
        origins: { B: { file: '.env', line: 2 } },
      },
    );
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.issues.map((i) => [i.key, i.severity, i.file, i.line]),
      [['B', 'warning', '.env', 2]],
    );
  });

  it('plain JSON-style specs work like builders', () => {
    const r = parseEnv(
      { PORT: { type: 'port', default: 8080 }, MODE: { type: 'enum', values: ['a', 'b'] } },
      { MODE: 'b' },
    );
    assert.equal(r.env.PORT, 8080);
    assert.equal(r.env.MODE, 'b');
  });

  it('redact hides secrets', () => {
    const r = parseEnv(schema, { DATABASE_URL: 'postgres://h/db', API_KEY: 'x'.repeat(20), ADMIN: 'a@b.co' });
    const safe = redact(schema, r.env);
    assert.equal(safe.DATABASE_URL, '[secret]');
    assert.equal(safe.PORT, 3000);
  });
});

describe('assertValidSchema', () => {
  it('lists every schema problem', () => {
    assert.throws(
      () =>
        assertValidSchema({
          A: { type: 'strng' },
          B: { type: 'enum' },
          C: { type: 'port', default: 'abc' },
          D: { type: 'string', minLenght: 3 },
          'bad key': { type: 'string' },
          E: 'string',
          F: { type: 'string', pattern: '(' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SchemaError);
        const m = (err as Error).message;
        assert.match(m, /A: unknown type "strng"/);
        assert.match(m, /B: "values" must be a non-empty array/);
        assert.match(m, /C: the default "abc" is not a port number/);
        assert.match(m, /D: unknown option "minLenght"/);
        assert.match(m, /bad key: not a valid variable name/);
        assert.match(m, /E: must be an object/);
        assert.match(m, /F: "pattern" is not a valid regular expression/);
        return true;
      },
    );
  });

  it('rejects non-objects', () => {
    assert.throws(() => assertValidSchema([]), SchemaError);
    assert.throws(() => assertValidSchema(null), SchemaError);
  });
});

describe('registerType', () => {
  it('adds a custom type usable from builders and JSON', () => {
    registerType({
      name: 'hex-color',
      describe: () => 'hex color (#rrggbb)',
      parse: (raw) =>
        /^#[0-9a-f]{6}$/i.test(raw.trim())
          ? { ok: true, value: raw.trim().toLowerCase() }
          : { ok: false, reason: 'is not a hex color' },
    });
    const s = { BRAND: env.custom<string>('hex-color'), OTHER: { type: 'hex-color', default: '#000000' } };
    const r = parseEnv(s, { BRAND: '#FFAA00' });
    assert.equal(r.env.BRAND, '#ffaa00');
    assert.equal(r.env.OTHER, '#000000');
    assert.equal(parseEnv(s, { BRAND: 'red' }).ok, false);
  });

  it('rejects bad names', () => {
    assert.throws(() => registerType({ name: 'Bad Name', parse: () => ({ ok: true, value: 1 }) }), TypeError);
  });
});

describe('loadEnv', () => {
  it('loads the .env cascade with mode files and lets the source win', () => {
    const cwd = project({
      '.env': 'PORT=1000\nNAME=base\nHOST=base-host\nURL=http://${HOST}:${PORT}\n',
      '.env.local': 'NAME=local\n',
      '.env.production': 'PORT=2000\n',
      '.env.production.local': 'HOST=prod-host\n',
    });
    const config = loadEnv(
      { PORT: env.port(), NAME: env.string(), HOST: env.string(), URL: env.url() },
      { cwd, mode: 'production', source: { NAME: 'from-env' }, loadFiles: true },
    );
    assert.equal(config.PORT, 2000);
    assert.equal(config.NAME, 'from-env');
    assert.equal(config.HOST, 'prod-host');
    // Expansion runs file by file, so .env sees its own HOST and PORT.
    assert.equal(config.URL, 'http://base-host:1000');
  });

  it('skips .env.local in test mode', () => {
    const cwd = project({ '.env': 'A=base\n', '.env.local': 'A=local\n' });
    assert.equal(loadEnv({ A: env.string() }, { cwd, mode: 'test', source: {}, loadFiles: true }).A, 'base');
    assert.equal(
      loadEnv({ A: env.string() }, { cwd, mode: 'development', source: {}, loadFiles: true }).A,
      'local',
    );
  });

  it('override lets files win over the source', () => {
    const cwd = project({ '.env': 'A=file\n' });
    const r = loadEnv({ A: env.string() }, { cwd, source: { A: 'env' }, loadFiles: true, override: true });
    assert.equal(r.A, 'file');
  });

  it('a custom source alone does not read files', () => {
    const cwd = project({ '.env': 'A=file\n' });
    assert.equal(loadEnv({ A: env.string({ optional: true }) }, { cwd, source: {} }).A, undefined);
  });

  it('throws EnvValidationError with file locations', () => {
    const cwd = project({ '.env': '# x\nPORT=nope\n' });
    assert.throws(
      () => loadEnv({ PORT: env.port() }, { cwd, source: {}, loadFiles: true }),
      (err: unknown) => {
        assert.ok(err instanceof EnvValidationError);
        assert.equal(err.issues[0]!.file, '.env');
        assert.equal(err.issues[0]!.line, 2);
        assert.match(err.message, /\(\.env:2\)/);
        return true;
      },
    );
  });
});
