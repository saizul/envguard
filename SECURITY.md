# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's
private vulnerability reporting ("Report a vulnerability" under the
repository's **Security** tab). You will get an answer within a week.

## Scope

envguard handles configuration that often contains credentials. Reports in
these areas are especially welcome:

- **Secret disclosure.** Values of fields marked `secret` must never appear
  in error messages, CLI output, JSON output, annotations or `.env.example`.
  Scanner findings must be masked. Any path that prints a full secret is a
  vulnerability.
- **Parser behaviour.** Input that makes the `.env` parser, the expansion or
  the glob matcher take far more than linear time, or read files outside the
  given directory.
- **Schema files are code.** `env.schema.ts`, `.js`, `.mjs` and `.cjs` files
  are imported and executed by the CLI, like any config file. Only run the
  CLI on projects you trust, or use `env.schema.json`.

## What envguard is not

The `scan` command is a safety net for files that are meant to be
committed. It does not scan git history and it cannot prove that a
repository is free of secrets. If a credential was ever committed, rotate it:
removing it from the latest commit is not enough.
