# envguard

[![CI](https://github.com/saizul/envguard/actions/workflows/ci.yml/badge.svg)](https://github.com/saizul/envguard/actions/workflows/ci.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-blue)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![TypeScript](https://img.shields.io/badge/types-included-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

Type-safe environment variables and `.env` hygiene for Node.js and
TypeScript projects.

- **A library**: describe your variables once, call `loadEnv(schema)` and get
  a frozen, fully typed object. Every missing or invalid variable is reported
  in one error, with the file and line it came from, and secrets are never
  printed.
- **A CLI**: `check` your `.env` files or CI environment, keep `.env.example`
  in sync with the schema, `diff` two env files, `scan` committed files for
  leaked credentials, and let `doctor` check `.gitignore`, the template and
  the schema together. Output for terminals, JSON and GitHub Actions
  annotations.

Zero runtime dependencies. Ships ESM, CommonJS and type declarations.

```console
$ npx @saizul/envguard check
(environment)
        error    SESSION_SECRET is missing; expected string (Signs session cookies)  missing
        error    ADMIN_EMAIL is missing; expected email. Example: admin@example.com  missing

.env
     1  error    PORT is not a port number; got "abc"  invalid
     2  error    DATABASE_URL must use postgres: or postgresql: (got mysql:); got "my*******"  invalid

✖ 4 errors, 0 warnings (.env; schema env.schema.json)
```

## Contents

- [Why](#why)
- [Features](#features)
- [Quick start](#quick-start)
- [Install](#install)
- [Library usage](#library-usage)
- [Types](#types)
- [CLI](#cli)
- [Configuration](#configuration)
- [The .env parser](#the-env-parser)
- [Framework notes](#framework-notes)
- [API](#api)
- [Examples](#examples)
- [Contributing: add a type, a secret pattern or a doctor check](#contributing-add-a-type-a-secret-pattern-or-a-doctor-check)
- [Roadmap](#roadmap)
- [Limitations](#limitations)

## Why

Environment variables fail late and quietly. `process.env.PORT` is a string,
`process.env.DEBUG === 'false'` is truthy, a typo in a variable name gives
`undefined` at 2 a.m., and the first error message only tells you about the
first problem. Meanwhile `.env.example` drifts away from what the code reads,
somebody pastes a real token into it, and a `.env*` rule in `.gitignore`
silently stops the template from ever being committed.

envguard handles both halves: typed loading in the code, and hygiene checks
that run in CI.

## Features

- **Schema in TypeScript or JSON** with `string`, `number`, `integer`,
  `boolean`, `url`, `email`, `enum`, `port`, `json`, `duration` and `list`
  types, plus your own via `registerType()`.
- **Per-field options**: `default`, `optional`, `secret`, `description`,
  `example`, `aliases`, and type options such as `min`/`max`, `protocols`,
  `pattern` or `separator`.
- **Full type inference**: `env.port({ default: 3000 })` is a `number`,
  `env.enum(['a', 'b'])` is `'a' | 'b'`, optional fields include `undefined`.
- **Aggregated errors**: one `EnvValidationError` lists every problem, with
  the description, an example value and `file:line` where known.
- **Secrets stay secret**: masked in errors, CLI output and annotations, left
  blank in `.env.example`, and `redact()` makes a config safe to log.
- **A careful `.env` parser**: quotes, multiline values, escapes, `export`,
  inline comments, `${VAR}` expansion with fallbacks, duplicates and syntax
  problems reported with line numbers. Tested against tricky cases.
- **The usual cascade**: `.env`, `.env.local`, `.env.<mode>`,
  `.env.<mode>.local`, with `.env.local` skipped in `test` mode.
- **Typed `process.env` and `import.meta.env`**: `envguard types` writes an
  `env.d.ts` from the schema, so editors complete variable names and required
  variables are `string`, not `string | undefined`.
- **CLI commands** `check`, `example`, `types`, `diff`, `scan`, `doctor` and
  `init`, each with `--format pretty|json|github` and exit codes for CI.
- **Secret scanning** with 14 built-in patterns (GitHub, GitLab, AWS, Stripe,
  Slack, Google, npm, SendGrid, Azure, private keys, JWTs, passwords in URLs
  and high-entropy values for secret-like names), placeholder detection and
  an allowlist.
- **Works everywhere**: `parseEnv()` has no file system access, so it runs in
  browsers, edge runtimes and with `import.meta.env`.

## Quick start

envguard is published to GitHub Packages, so npm needs to know where the
`@saizul` scope lives (see [Install](#install)). Then, in a project that
already has a `.env.example`:

```console
$ npx @saizul/envguard init        # guess env.schema.json from .env.example
$ npx @saizul/envguard check       # validate .env against it
$ npx @saizul/envguard doctor      # .gitignore, template and schema in one go
```

Review the guessed types in `env.schema.json`, then load the variables in
your code:

```ts
import { loadEnv } from '@saizul/envguard';
import schema from './env.schema.json' with { type: 'json' };

export const config = loadEnv(schema);
```

For full type inference, write the schema in TypeScript instead
(`npx @saizul/envguard init --ts`):

```ts
// env.schema.ts
import { defineSchema, env } from '@saizul/envguard';

export default defineSchema({
  NODE_ENV: env.enum(['development', 'production', 'test'], { default: 'development' }),
  PORT: env.port({ default: 3000, description: 'Port the HTTP server listens on' }),
  DATABASE_URL: env.url({ protocols: ['postgres', 'postgresql'], secret: true }),
  REDIS_URL: env.url({ optional: true }),
  REQUEST_TIMEOUT: env.duration({ default: '30s' }),
});
```

```ts
// config.ts
import { loadEnv } from '@saizul/envguard';
import schema from './env.schema.js';

export const config = loadEnv(schema);
config.PORT; //            number
config.NODE_ENV; //        'development' | 'production' | 'test'
config.REDIS_URL; //       string | undefined
config.REQUEST_TIMEOUT; // number (milliseconds)
```

## Install

The package is published to GitHub Packages as `@saizul/envguard`. Add this
line to an `.npmrc` in your project (or in your home directory):

```ini
@saizul:registry=https://npm.pkg.github.com
```

GitHub Packages asks for a token even for public packages. Create a personal
access token with the `read:packages` scope and make it available as
`NODE_AUTH_TOKEN`, then reference it from `.npmrc`:

```ini
@saizul:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Install it as a dev dependency for the CLI, or as a regular dependency when
you use `loadEnv()` at runtime:

```console
$ npm install @saizul/envguard
```

In GitHub Actions, `actions/setup-node` with `registry-url:
https://npm.pkg.github.com` and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
is enough; see [examples/github-workflow.yml](examples/github-workflow.yml).

Requires Node 20 or newer.

## Library usage

### Loading

```ts
import { env, loadEnv } from '@saizul/envguard';

const config = loadEnv(
  {
    PORT: env.port({ default: 3000 }),
    DATABASE_URL: env.url({ secret: true, description: 'Postgres connection string' }),
  },
  {
    mode: 'production', // adds .env.production and .env.production.local
    strict: true, //       warn about keys in .env files that the schema lacks
    onError: 'exit', //    print the problems and exit(1) instead of throwing
  },
);
```

`loadEnv()` reads the `.env` cascade from `cwd`, merges it **under**
`process.env` (real environment variables win, as in every major framework),
validates and converts every value, and returns a frozen object. When
anything is wrong it throws an `EnvValidationError` with all problems:

```text
Environment validation failed: 3 problems
  ✖ PORT is not a port number; got "eighty" (.env:2)
  ✖ DATABASE_URL is missing; expected url (postgres) (Postgres connection string)
  ✖ LOG_LEVEL must be one of: debug, info, warn; got "loud"
```

| Option           | Default               | Meaning                                                        |
| ---------------- | --------------------- | -------------------------------------------------------------- |
| `source`         | `process.env`         | Where values come from, e.g. `import.meta.env` or an object    |
| `loadFiles`      | `true` for process.env | Read `.env` files; `false` by default with a custom `source`  |
| `cwd`            | `process.cwd()`       | Directory of the `.env` files                                  |
| `mode`           | `NODE_ENV`            | Adds `.env.<mode>` and `.env.<mode>.local`                     |
| `files`          | the cascade           | Explicit list of files                                         |
| `override`       | `false`               | Let file values override `source`                              |
| `expand`         | `true`                | Expand `${VAR}` references in files                            |
| `strict`         | `false`               | Warn about undeclared keys found in files                      |
| `emptyAsMissing` | `true`                | Treat `KEY=` as missing (so defaults apply)                    |
| `onError`        | `'throw'`             | `'exit'` prints the problems and calls `process.exit(1)`       |

### Validating without throwing

`parseEnv(schema, source)` is the pure core. It never touches the file system
and never throws for bad values:

```ts
import { parseEnv } from '@saizul/envguard';

const result = parseEnv(schema, { PORT: '8080' });
if (!result.ok) {
  for (const issue of result.issues) console.log(issue.key, issue.code, issue.message);
}
result.env.PORT; // 8080
```

Each issue has `key`, `code` (`missing`, `empty`, `invalid` or `unknown`),
`severity`, `message`, and `file`/`line` when the value came from a file.

### Logging a config safely

```ts
import { redact } from '@saizul/envguard';
console.log(redact(schema, config)); // { PORT: 3000, DATABASE_URL: '[secret]' }
```

## Types

Every field accepts `default`, `optional`, `secret`, `description`,
`example` and `aliases` (other names to read the value from, e.g. a
deprecated name). Values are trimmed; an empty value counts as missing.

| Type       | Builder                              | Result     | Options                                   | Accepts                                   |
| ---------- | ------------------------------------ | ---------- | ----------------------------------------- | ----------------------------------------- |
| `string`   | `env.string()`                       | `string`   | `minLength`, `maxLength`, `pattern`, `trim` | anything; length counts Unicode characters |
| `number`   | `env.number()`                       | `number`   | `min`, `max`, `integer`                   | `42`, `-1.5`, `2e3`, `1_000`              |
| `integer`  | `env.integer()`                      | `number`   | `min`, `max`                              | whole numbers                             |
| `boolean`  | `env.boolean()`                      | `boolean`  |                                           | `true/false`, `1/0`, `yes/no`, `on/off`   |
| `url`      | `env.url()`                          | `string`   | `protocols`                               | absolute URLs                             |
| `email`    | `env.email()`                        | `string`   |                                           | `name@domain.tld`, Unicode domains        |
| `enum`     | `env.enum(['a', 'b'])`               | `'a' \| 'b'` | `caseInsensitive`                       | one of the values                         |
| `port`     | `env.port()`                         | `number`   | `allowZero`                               | `1`-`65535`                               |
| `json`     | `env.json<T>()`                      | `T`        |                                           | any JSON                                  |
| `duration` | `env.duration()`                     | `number` (ms) | `min`, `max` (ms)                      | `250ms`, `30s`, `5m`, `1h30m`, `1.5h`, `2d`, `1w`, plain ms |
| `list`     | `env.list()`                         | `string[]` | `separator` (`,`), `minItems`             | `a, b, c`                                 |

In JSON the same fields are plain objects:

```json
{
  "PORT": { "type": "port", "default": 3000 },
  "LOG_LEVEL": { "type": "enum", "values": ["debug", "info"], "default": "info" },
  "API_TOKEN": { "type": "string", "secret": true, "minLength": 20 }
}
```

Schemas are checked when they are used: an unknown type, a misspelled option
(`minLenght`), an invalid `pattern` or a default that does not pass its own
type raise a `SchemaError` that lists every problem.

## CLI

```text
envguard <command> [options]

  check [files...]     Validate .env files (or the process environment) against the schema
  example              Write .env.example from the schema (secrets left blank)
  types                Write env.d.ts: typed process.env / import.meta.env from the schema
  diff [env] [tmpl]    Compare the keys of two env files (default: .env .env.example)
  scan [paths...]      Find real-looking secrets in committed files
  doctor               Check .gitignore, the template and the schema together
  init                 Create env.schema.json (or .ts) from an existing .env.example

  --cwd <dir>  --config <file>  --format pretty|json|github  --fail-on error|warning|none  --no-color
```

Exit codes: `0` no problems, `1` problems found (at or above `--fail-on`),
`2` usage or configuration error. `--format github` prints
[workflow commands](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions)
so problems show up as annotations on the pull request.

The schema is found automatically as the first of `env.schema.ts`,
`env.schema.mts`, `env.schema.js`, `env.schema.mjs`, `env.schema.cjs` and
`env.schema.json`, or set with `--schema` / the config file. TypeScript
schema files load directly on Node 22.18+ and 23.6+ (type stripping); on
Node 20 use `.mjs` or `.json`, or run the CLI through `tsx`.

### check

```console
$ envguard check                         # the cascade, mode from NODE_ENV
$ envguard check --mode production       # .env, .env.local, .env.production, .env.production.local
$ envguard check .env.staging .env.prod  # each file on its own
$ envguard check --no-files --process-env  # CI or containers: validate the real environment
$ envguard check --strict --fail-on warning  # also fail on keys the schema does not declare
```

Parse problems in the files (unterminated quotes, duplicate keys, invalid
names) are reported too.

### example

```console
$ envguard example            # write or refresh .env.example
$ envguard example --check    # CI: exit 1 when it is out of date
$ envguard example --stdout --sort
```

```ini
# Copy this file to .env and fill in the values.
# Keep .env out of version control; this file is safe to commit.
# Refresh it with: npx @saizul/envguard example

# Port the HTTP server listens on
# port (1-65535), default: 3000
PORT=3000

# Postgres connection string
# url (postgres, postgresql), required, secret
DATABASE_URL=
```

Secrets are always blank. Non-secret values come from `example`, then
`default`; a value someone wrote by hand into the template is kept when the
schema has neither. `--keep-unknown` keeps keys the schema does not declare.

### types

```console
$ envguard types                       # write or refresh env.d.ts (process.env)
$ envguard types --target vite -o src/vite-env.d.ts
$ envguard types --target both --check # CI: exit 1 when it is out of date
```

```ts
// Environment variable types created by envguard from env.schema.json.
// Do not edit by hand; run "envguard types" after changing the schema.

export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * Port the HTTP server listens on
       * port (1-65535), default: 3000
       */
      PORT?: string;
      /** url (postgres, postgresql), required, secret */
      DATABASE_URL: string;
    }
  }
}
```

The declarations describe the raw values, which are always strings at
runtime: required variables are `string`, variables with a default, optional
ones and ones with `aliases` are `string | undefined`, and case-sensitive
enums become unions such as `"debug" | "info"`. Use `loadEnv()` for parsed
numbers, booleans and lists. `--target vite` declares `ImportMetaEnv` with
only the client variables (`VITE_*`, or `--vite-prefix`), `--target both`
declares both. Add the file to your `tsconfig.json` `include` if it is
outside the included folders.

### diff

```console
$ envguard diff                       # .env vs .env.example
$ envguard diff .env.production .env.example --fail-on warning
```

Missing keys are errors, extra keys are warnings, keys that are empty locally
but filled in the template are notices. Values are never printed.

### scan

```console
$ envguard scan                       # templates, READMEs, compose files, workflows
$ envguard scan 'deploy/**/*.yaml' docs/setup.md
$ envguard scan --allow 'id:jwt' --allow '/^pk_test_/' --exclude 'fixtures/**'
$ envguard scan --list-patterns
```

By default it looks at the files that are committed on purpose and often
receive pasted values: `.env.example`, `.env.sample`, `.env.template`,
`.env.defaults`, `.env.dist`, `README*`, `docker-compose*.yml`,
`compose.yml` and `.github/workflows/*.yml`, in every folder except
`node_modules`, build output and `.git`. Findings are masked
(`ghp_************`).

| ID                   | Severity | Detects                                             |
| -------------------- | -------- | --------------------------------------------------- |
| `private-key`        | error    | `-----BEGIN ... PRIVATE KEY-----` blocks             |
| `aws-access-key-id`  | error    | AWS access key IDs                                  |
| `github-token`       | error    | GitHub personal, OAuth, app and fine-grained tokens |
| `gitlab-token`       | error    | GitLab personal access tokens                       |
| `slack-token`        | error    | Slack bot, user and app tokens                      |
| `slack-webhook`      | error    | Slack incoming webhook URLs                         |
| `stripe-live-key`    | error    | Stripe live secret and restricted keys              |
| `google-api-key`     | error    | Google API keys                                     |
| `npm-token`          | error    | npm access tokens                                   |
| `sendgrid-api-key`   | error    | SendGrid API keys                                   |
| `azure-storage-key`  | error    | Azure storage account keys in connection strings    |
| `jwt`                | warning  | JSON Web Tokens                                     |
| `url-credentials`    | warning  | Passwords in URLs (`postgres://user:pass@host`)     |
| `generic-secret`     | warning  | High-entropy values assigned to `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_API_KEY` ... |

Not reported: placeholders such as `your-token-here`, `<secret>`, `xxxx`,
`changeme`, `${VAR}` and `${{ secrets.X }}`, values containing `example`,
and common local passwords in URLs (`postgres:postgres@localhost`).

To allow a finding: add `envguard-allow` to the line (or put
`# envguard-allow-next-line` above it), pass `--allow <value>`,
`--allow /regex/` or `--allow id:<pattern>`, or list it under `scan.allow` in
the config.

### doctor

```console
$ envguard doctor
✔ .env files are ignored by git (.env, .env.local ignored)
✔ A template file exists (.env.example found)
✖ The template is not ignored by git
    .env.example is ignored by git (rule ".env*"), so it never reaches the repository
    → Add "!.env.example" to .gitignore after that rule
✔ The schema loads (env.schema.json declares 11 variables)
⚠ The template matches the schema
    REDIS_URL is in the schema but not in .env.example
    → Run "envguard example" to refresh the template
✔ Local .env has every key of the template (no missing keys)
✔ .env files parse cleanly (3 files parsed)
✔ Committed templates contain no secrets (.env.example clean)

✖ 1 problem, 1 warning
```

| ID                    | Checks                                                              |
| --------------------- | ------------------------------------------------------------------- |
| `env-gitignored`      | `.gitignore` exists and ignores `.env`, `.env.local` and other local env files |
| `example-exists`      | `.env.example` (or `.sample` / `.template`) exists                   |
| `example-committable` | the template is **not** ignored (the classic `.env*` mistake)       |
| `schema-valid`        | the schema file loads and is valid                                  |
| `example-in-sync`     | template and schema declare the same keys                           |
| `env-complete`        | local `.env` has every key of the template                          |
| `env-syntax`          | every `.env*` file parses without problems                          |
| `template-no-secrets` | committed templates contain no credentials                          |

### init

```console
$ envguard init               # env.schema.json from .env.example (or .env)
$ envguard init --ts          # env.schema.ts using the builders
$ envguard init --from .env.production --force
```

It guesses ports (`*_PORT`), booleans, integers, numbers, durations, URLs,
emails and JSON from the values, uses comments as descriptions, and marks
names like `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_API_KEY` and
`DATABASE_URL` as secrets (except public prefixes such as `NEXT_PUBLIC_` and
`VITE_`). Always review the result.

## Configuration

Optional. `envguard.config.json` in the project root, or an `"envguard"` key
in `package.json`. CLI flags win over the config.

```json
{
  "schema": "config/env.schema.json",
  "example": ".env.example",
  "files": [".env", ".env.local"],
  "strict": true,
  "scan": {
    "include": ["**/.env.example", "**/README*", "deploy/**/*.yaml"],
    "exclude": ["fixtures/**"],
    "allow": ["id:jwt", "/^pk_test_/"],
    "disable": ["generic-secret"]
  }
}
```

| Key            | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| `schema`       | Schema file path                                                      |
| `example`      | Template file for `example`, `diff` and `doctor`                      |
| `files`        | Files `check` reads instead of the cascade                            |
| `strict`       | Report undeclared keys in `check`                                     |
| `scan.include` | Files or globs to scan instead of the defaults                        |
| `scan.exclude` | Globs to skip                                                         |
| `scan.allow`   | Allowed values, `/regex/` or `id:<pattern>`                           |
| `scan.disable` | Pattern IDs to turn off                                               |

Unknown keys are an error, so typos do not go unnoticed.

## The .env parser

`parseDotenv(text)` returns `{ values, entries, problems }` and never throws.

```ini
# Comments on their own line, attached to the next entry as its description
export NODE_ENV=production          # `export` prefix and inline comments
SPACED = value                      # spaces around = are fine
HASH=a#b                            # `#` needs whitespace before it to start a comment
SINGLE='literal $HOME \n'           # single quotes: no escapes, no expansion
DOUBLE="tab\there \"quoted\" \$5"   # double quotes: \n \r \t \" \\ \$
BACKTICK=`it's "both"`              # backticks: literal, either quote inside
PEM="-----BEGIN CERTIFICATE-----
MIIB...
-----END CERTIFICATE-----"          # multiline values in any quotes
URL=postgres://${DB_HOST}:${DB_PORT:-5432}/app   # expansion with fallbacks
```

| Expansion          | Result                                     |
| ------------------ | ------------------------------------------ |
| `${VAR}` / `$VAR`  | value of `VAR`, empty (with a warning) when undefined |
| `${VAR:-fallback}` | `fallback` when `VAR` is unset or empty    |
| `${VAR-fallback}`  | `fallback` when `VAR` is unset             |
| `${VAR:+alt}`      | `alt` when `VAR` is set and not empty      |
| `\$VAR`            | the literal text `$VAR`                    |

Variables resolve from the process environment first, then from earlier
lines and earlier files of the cascade. CRLF line endings and a byte order
mark are handled. Problems have a `code` (`invalid-key`, `invalid-line`,
`missing-equals`, `unterminated-quote`, `trailing-characters`,
`duplicate-key`, `undefined-variable`), a severity and a line number.

## Framework notes

### Node.js

Call `loadEnv()` once, in a module that the rest of the app imports, so the
process fails at startup instead of on the first request:

```ts
// src/config.ts
import { loadEnv } from '@saizul/envguard';
import schema from '../env.schema.js';

export const config = loadEnv(schema, { onError: 'exit' });
```

No `dotenv` needed; envguard reads the files itself. If you already use
`node --env-file=.env`, pass `{ loadFiles: false }`.

### Next.js

Next.js loads `.env*` files itself, so pass `loadFiles: false`. Public
variables are inlined at build time only when they are written out in full,
so list them explicitly and validate them with `parseEnv()`. See
[examples/nextjs/env.ts](examples/nextjs/env.ts).

```ts
export const serverEnv = loadEnv(serverSchema, { loadFiles: false });

const client = parseEnv(clientSchema, {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
```

Never mark a `NEXT_PUBLIC_*` variable as a secret: it ends up in the browser.

### Vite

Vite exposes `VITE_*` variables (plus `MODE`, `DEV`, `PROD`) on
`import.meta.env`; booleans arrive as real booleans, which `parseEnv()`
accepts. Validate in the app, and optionally in `vite.config.ts` to fail the
build early. See [examples/vite](examples/vite).

```ts
import { env, EnvValidationError, parseEnv } from '@saizul/envguard';

const result = parseEnv({ VITE_API_URL: env.url() }, import.meta.env);
if (!result.ok) throw new EnvValidationError(result.issues);
export const appEnv = result.env;
```

`envguard types --target vite -o src/vite-env.d.ts` types `import.meta.env`
from the same schema.

### Docker and Docker Compose

Keep real values in a git-ignored `.env` and reference them with `env_file`
or `${VAR}`. Validate inside the container before the app starts:

```yaml
command: sh -c "npx @saizul/envguard check --no-files --process-env && node server.js"
```

`envguard scan` checks `docker-compose*.yml` and `compose.yml` for
credentials written inline. See [examples/docker-compose.yml](examples/docker-compose.yml).

### GitHub Actions

```yaml
- run: npx envguard example --check --format github
- run: npx envguard scan --format github
- run: npx envguard doctor --format github
- run: npx envguard check --no-files --process-env --format github
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Problems become annotations on the pull request, with file and line. The
complete workflow, including installing from GitHub Packages, is in
[examples/github-workflow.yml](examples/github-workflow.yml).

## API

| Export                                   | Description                                                          |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `env.<type>(options)`                    | Field builders with type inference                                   |
| `defineSchema(schema)`                   | Identity helper that keeps literal types                             |
| `loadEnv(schema, options)`               | Load files, validate, convert; throws `EnvValidationError`           |
| `parseEnv(schema, source, options)`      | Validate a plain object; returns `{ ok, env, issues }`               |
| `assertValidSchema(schema)`              | Throws `SchemaError` for an unusable schema                          |
| `registerType(definition)`               | Add a custom type                                                    |
| `redact(schema, values)`                 | Copy with secrets replaced by `'[secret]'`                           |
| `formatIssues(issues)`                   | The multi-line message used by `EnvValidationError`                  |
| `parseDotenv(text, options)`             | Parse `.env` text into `values`, `entries` and `problems`            |
| `formatDotenvValue(value)`               | Quote a value so that `parseDotenv` reads it back unchanged          |
| `expandValue(text, lookup)`              | `${VAR}` expansion on its own                                        |
| `loadEnvFiles(options)`                  | Read and merge the cascade; values, origins and problems             |
| `defaultEnvFiles(mode)`                  | The cascade file names                                               |
| `generateExample(schema, options)`       | `.env.example` contents                                              |
| `generateDeclarations(schema, options)`  | `env.d.ts` contents (`target`: `node`, `vite` or `both`)             |
| `diffEnv(actual, template)`              | Missing, extra and empty keys                                        |
| `scanText(text, file, options)`          | Secret findings in a string                                          |
| `scanFiles(options)`                     | Find files and scan them                                             |
| `builtinPatterns`                        | The built-in `SecretPattern` list                                    |
| `runDoctor(options)` / `doctorChecks`    | Run the hygiene checks / the default check list                      |
| `inferSchema(entries)` / `schemaToTypeScript(schema)` | What `envguard init` uses                               |
| `parseDuration(text)` / `formatDuration(ms)` | Duration helpers                                                 |
| `GitIgnore`                              | Small `.gitignore` matcher                                           |
| `InferEnv<S>`, `FieldSpec`, `Schema`, `EnvIssue`, ... | Types                                                   |

## Examples

| File                                                         | Shows                                                |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| [examples/env.schema.ts](examples/env.schema.ts)             | A typed schema using every common type               |
| [examples/env.schema.json](examples/env.schema.json)         | The same schema in JSON                              |
| [examples/.env.example](examples/.env.example)               | The template `envguard example` writes for it        |
| [examples/config.ts](examples/config.ts)                     | Loading once at startup                              |
| [examples/basic.mjs](examples/basic.mjs)                     | Runnable: loading, errors, redaction, the parser     |
| [examples/commonjs.cjs](examples/commonjs.cjs)               | `require()` usage                                    |
| [examples/nextjs/env.ts](examples/nextjs/env.ts)             | Server and public variables in Next.js               |
| [examples/vite](examples/vite)                               | `import.meta.env` and a build-time check             |
| [examples/docker-compose.yml](examples/docker-compose.yml)   | Validating inside a container                        |
| [examples/github-workflow.yml](examples/github-workflow.yml) | CI with annotations                                  |
| [examples/envguard.config.json](examples/envguard.config.json) | A config file                                      |

```console
$ npm run build
$ node examples/basic.mjs
$ node dist/esm/cli.js doctor --cwd examples
```

## Contributing: add a type, a secret pattern or a doctor check

envguard is built from small registries, so most contributions touch one
file plus a test. See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup.

### A new type

Types live in [src/schema/registry.ts](src/schema/registry.ts). A type is a
name, a `parse` function and optionally a label and option checks:

```ts
const semver: TypeDefinition = {
  name: 'semver',
  describe: () => 'semantic version (1.2.3)',
  parse(raw) {
    const s = raw.trim();
    return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(s) ? { ok: true, value: s } : { ok: false, reason: 'is not a semantic version' };
  },
};
```

Add it to the `registry` list, add a builder to `env` in
[src/schema/builders.ts](src/schema/builders.ts), map its result type in
`TypeOfSpec` in [src/schema/types.ts](src/schema/types.ts), and add tests to
`test/schema.test.ts` (valid values, invalid values, options). Users can
register their own types at runtime with `registerType()` without a release.

### A new secret pattern

Patterns live in [src/scan/patterns.ts](src/scan/patterns.ts):

```ts
{
  id: 'acme-api-key',            // stable kebab-case ID
  title: 'Acme API key',
  regex: /\b(acme_[A-Za-z0-9]{32})\b/,  // group 1 is the secret
  severity: 'error',             // 'warning' for heuristics
  keywords: ['acme_'],           // cheap prefilter
},
```

Rules of thumb: anchor on a documented prefix, prefer a specific length,
and add a `verify` function when a regex alone would be noisy. In the tests,
build the fake token from pieces at runtime (see `fake` in
[test/helpers.ts](test/helpers.ts)) so that this repository never contains a
literal that secret scanners flag, and add a "no false positive" case.

### A new doctor check

Checks live in [src/doctor/checks.ts](src/doctor/checks.ts) and get a
`DoctorContext` with the parsed template, the `.gitignore` matcher, the
schema and cached file access:

```ts
export const sortedExampleCheck: DoctorCheck = {
  id: 'example-sorted',
  title: 'The template is sorted',
  run(ctx) {
    const keys = ctx.example.map((e) => e.key);
    const sorted = [...keys].sort();
    return keys.join() === sorted.join()
      ? [{ status: 'pass', message: 'sorted' }]
      : [{ status: 'warn', message: `${ctx.exampleFile} is not sorted`, hint: 'Run "envguard example --sort"' }];
  },
};
```

Add it to `doctorChecks`, add a passing and a failing case to
`test/tools.test.ts`, and a row to the doctor table above.

Issues labelled **good first issue** are a good place to start: new secret
patterns, framework examples and doctor checks are usually small and
self-contained.

## Roadmap

- `envguard check --watch` for development servers
- Detect `.env` files that are already tracked by git (reading the index)
- Schema export to JSON Schema
- More secret patterns (Twilio, Mailgun, Discord, Hugging Face, Shopify)
- Monorepo mode: run `doctor` and `scan` for every workspace package
- Plugins loaded from the config file (custom types, patterns and checks)

## Limitations

- `loadEnv()` reads files synchronously at startup by design; it is not meant
  for hot paths.
- TypeScript schema files need Node 22.18+ / 23.6+ or a loader such as `tsx`.
  Only erasable TypeScript syntax is supported natively (no enums or
  namespaces).
- The `.env` parser follows the common dotenv conventions. Shell features
  such as command substitution `$(...)` are not supported, by design.
- Values in `.env.example` are never compared with `.env`; only keys are.
- The secret scanner is a safety net for files that should not contain
  secrets, not a replacement for a full history scanner such as gitleaks or
  GitHub secret scanning. It does not look at git history.
- The `.gitignore` matcher covers the root `.gitignore` and the common rules;
  nested `.gitignore` files, `.git/info/exclude` and global excludes are not
  read.

## License

[MIT](LICENSE) © 2026 Saizul Amin
