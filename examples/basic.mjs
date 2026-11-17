// Runs against the local build: npm run build && node examples/basic.mjs
import { env, EnvValidationError, loadEnv, parseDotenv, redact } from '../dist/esm/index.js';

const schema = {
  PORT: env.port({ default: 3000 }),
  DATABASE_URL: env.url({ protocols: ['postgres'], secret: true }),
  LOG_LEVEL: env.enum(['debug', 'info', 'warn'], { default: 'info' }),
  TIMEOUT: env.duration({ default: '5s' }),
};

// A source object instead of process.env keeps the example self-contained.
const config = loadEnv(schema, {
  source: { DATABASE_URL: 'postgres://localhost/app', TIMEOUT: '1m30s' },
});
console.log(redact(schema, config));

try {
  loadEnv(schema, { source: { PORT: 'eighty', LOG_LEVEL: 'loud' } });
} catch (err) {
  if (err instanceof EnvValidationError) console.log(err.message);
  else throw err;
}

const { values, problems } = parseDotenv('export A="multi\nline"\nB=${A:-unused} # comment\nC');
console.log(
  values,
  problems.map((p) => p.message),
);
