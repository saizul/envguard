// Compile-time checks: `npm run build:test` fails if inference breaks.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineSchema, env, type InferEnv, loadEnv } from '../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(_: T) => {};

const schema = defineSchema({
  PORT: env.port({ default: 3000 }),
  NODE_ENV: env.enum(['development', 'production'], { default: 'development' }),
  DATABASE_URL: env.url({ secret: true }),
  SENTRY_DSN: env.url({ optional: true }),
  TAGS: env.list(),
  DEBUG: env.boolean({ default: false }),
  TIMEOUT: env.duration({ default: '5s' }),
  FEATURES: env.json<{ beta: boolean }>(),
  RAW_PORT: { type: 'port' },
  RAW_OPTIONAL: { type: 'integer', optional: true },
  RAW_ENUM: { type: 'enum', values: ['a', 'b'] },
  RAW_STRING: { type: 'string', default: 'x' },
});

type Env = InferEnv<typeof schema>;
expectType<Equal<Env['PORT'], number>>(true);
expectType<Equal<Env['NODE_ENV'], 'development' | 'production'>>(true);
expectType<Equal<Env['DATABASE_URL'], string>>(true);
expectType<Equal<Env['SENTRY_DSN'], string | undefined>>(true);
expectType<Equal<Env['TAGS'], string[]>>(true);
expectType<Equal<Env['DEBUG'], boolean>>(true);
expectType<Equal<Env['TIMEOUT'], number>>(true);
expectType<Equal<Env['FEATURES'], { beta: boolean }>>(true);
expectType<Equal<Env['RAW_PORT'], number>>(true);
expectType<Equal<Env['RAW_OPTIONAL'], number | undefined>>(true);
expectType<Equal<Env['RAW_ENUM'], 'a' | 'b'>>(true);
expectType<Equal<Env['RAW_STRING'], string>>(true);

describe('types', () => {
  it('loadEnv returns the inferred, read-only object', () => {
    const config = loadEnv(
      { PORT: env.port({ default: 3000 }), NAME: env.string({ optional: true }) },
      { source: { PORT: '8080' } },
    );
    expectType<Equal<typeof config.PORT, number>>(true);
    expectType<Equal<typeof config.NAME, string | undefined>>(true);
    assert.throws(() => {
      // @ts-expect-error the result is read-only
      config.PORT = 1;
    }, TypeError);
    assert.equal(config.PORT, 8080);
  });
});
