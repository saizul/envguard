// Vite: validate import.meta.env in the browser bundle. Only VITE_* variables
// (and MODE, DEV, PROD, SSR, BASE_URL) are exposed by Vite.
import { env, EnvValidationError, parseEnv } from '@saizul/envguard';

const result = parseEnv(
  {
    VITE_API_URL: env.url(),
    VITE_SENTRY_DSN: env.url({ optional: true }),
    VITE_ITEMS_PER_PAGE: env.integer({ default: 20, min: 1, max: 100 }),
    MODE: env.enum(['development', 'production', 'staging'], { default: 'development' }),
  },
  import.meta.env,
);
if (!result.ok) throw new EnvValidationError(result.issues);

export const appEnv = result.env;
