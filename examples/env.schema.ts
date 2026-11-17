// The same schema written in TypeScript. With the builders, loadEnv() infers
// the type of every variable. The CLI loads this file on Node 22.18+ (or
// through tsx); on older Node versions use env.schema.json or .mjs.
import { defineSchema, env } from '@saizul/envguard';

export default defineSchema({
  NODE_ENV: env.enum(['development', 'production', 'test'], { default: 'development' }),
  PORT: env.port({ default: 3000, description: 'Port the HTTP server listens on' }),
  DATABASE_URL: env.url({
    protocols: ['postgres', 'postgresql'],
    secret: true,
    description: 'Postgres connection string',
    aliases: ['POSTGRES_URL'],
  }),
  REDIS_URL: env.url({ optional: true, example: 'redis://localhost:6379' }),
  SESSION_SECRET: env.string({ secret: true, minLength: 32, description: 'Signs session cookies' }),
  ADMIN_EMAIL: env.email({ example: 'admin@example.com' }),
  REQUEST_TIMEOUT: env.duration({ default: '30s' }),
  ALLOWED_ORIGINS: env.list({ default: ['http://localhost:3000'] }),
  FEATURE_FLAGS: env.json<Record<string, boolean>>({ default: {} }),
  LOG_LEVEL: env.enum(['debug', 'info', 'warn', 'error'], { default: 'info' }),
  ENABLE_SIGNUPS: env.boolean({ default: true }),
});
