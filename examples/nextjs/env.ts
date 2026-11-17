// Next.js: validate server variables on the server, and list public ones
// explicitly so Next can inline them into the client bundle.
import { env, loadEnv, parseEnv, EnvValidationError } from '@saizul/envguard';

// Server-only. Next.js has already loaded .env* files into process.env.
export const serverEnv = loadEnv(
  {
    DATABASE_URL: env.url({ secret: true }),
    NEXTAUTH_SECRET: env.string({ secret: true, minLength: 32 }),
    NODE_ENV: env.enum(['development', 'production', 'test'], { default: 'development' }),
  },
  { loadFiles: false },
);

// Public. Each NEXT_PUBLIC_* variable has to be written out in full, because
// Next.js replaces `process.env.NEXT_PUBLIC_X` at build time.
const client = parseEnv(
  {
    NEXT_PUBLIC_API_URL: env.url(),
    NEXT_PUBLIC_ANALYTICS: env.boolean({ default: false }),
  },
  {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ANALYTICS: process.env.NEXT_PUBLIC_ANALYTICS,
  },
);
if (!client.ok) throw new EnvValidationError(client.issues);
export const clientEnv = client.env;
