# Contributing

Thanks for helping improve envguard. Bug reports, new secret patterns, new
types, doctor checks, framework examples and documentation fixes are all
welcome. If you are new to open source, look for issues labelled
**good first issue**; they are small and come with pointers.

## Reporting a bug

Open an issue with:

- the command or code you ran and the output you expected
- the smallest `.env`, schema or file that reproduces the problem
- your envguard and Node versions (`node --version`)

**Never paste real secrets.** Replace values with placeholders; for a scanner
false negative, describe the token format and link to the provider's
documentation instead.

## Development setup

You need Node 20 or newer.

```console
$ git clone https://github.com/saizul/envguard.git
$ cd envguard
$ npm ci
$ npm test              # builds ESM + CJS, compiles the tests and runs node:test
$ npm run lint          # biome lint + tsc --noEmit
$ npm run format        # biome format --write
$ npm run format:check  # what CI runs
```

Try the CLI from the build with `node dist/esm/cli.js doctor --cwd examples`.

## Guidelines

- **Zero runtime dependencies.** Only the Node standard library. Development
  tools go in `devDependencies`.
- **No real credentials, anywhere.** Test tokens are assembled from pieces at
  runtime (`fake` in `test/helpers.ts`), so the repository contains no
  literal that secret scanners flag. Fixture projects are written to a
  temporary directory by `project()` in the same file.
- **Never print a secret.** Messages show masked values (`mask()`,
  `preview()`); add a test that the raw value is absent from the output.
- **IDs are public API.** Type names, pattern IDs and doctor check IDs are
  used in configs and allowlists, so do not rename them outside a major
  release.
- Every change comes with a test and a line in the `Unreleased` section of
  `CHANGELOG.md`. The README explains how to add a type, a secret pattern or
  a doctor check.

## Project layout

```text
src/
  parser/          .env parser and ${VAR} expansion
  schema/          builders, types registry, validation, duration, schema files
  load.ts          loadEnv()
  files.ts         the .env cascade
  example.ts       .env.example generation
  diff.ts          key diff between two env files
  init.ts          schema inference for `envguard init`
  scan/            secret patterns and the scanner
  doctor/          hygiene checks and the runner
  report/          pretty, JSON and GitHub annotation output
  util/            glob and .gitignore matching
  cli.ts, cli/     command-line interface
test/              node:test suites and helpers
examples/          schemas, framework snippets, workflow and compose files
```

## Pull requests

Keep them focused: one fix or feature per pull request. Describe what
changed and how you tested it; the template has a short checklist. CI runs
lint, format check and the tests on Node 20 and 22 on Linux, and Node 22 on
Windows and macOS.
