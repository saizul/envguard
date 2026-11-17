// Fail the build early when variables are missing, with every problem listed.
import { env, parseEnv, EnvValidationError } from '@saizul/envguard';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const values = loadEnv(mode, process.cwd(), 'VITE_');
  const result = parseEnv({ VITE_API_URL: env.url() }, values);
  if (!result.ok) throw new EnvValidationError(result.issues);
  return {};
});
