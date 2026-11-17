// Validate once at startup and import `config` everywhere else.
import { loadEnv } from '@saizul/envguard';
import schema from './env.schema.js';

export const config = loadEnv(schema, { onError: 'exit' });

// config.PORT is a number, config.LOG_LEVEL is 'debug' | 'info' | 'warn' | 'error',
// config.REDIS_URL is string | undefined, config.REQUEST_TIMEOUT is milliseconds.
