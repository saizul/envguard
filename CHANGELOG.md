# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `envguard types` writes a TypeScript declaration file (default `env.d.ts`) from the schema that types
  `process.env` (`NodeJS.ProcessEnv`), `import.meta.env` (`ImportMetaEnv`, only `VITE_*` variables or
  `--vite-prefix`) or both (`--target node|vite|both`). Required variables are `string`, variables with a default,
  optional ones and ones with aliases are optional, case-sensitive enums become string unions, aliases are
  declared as deprecated, and descriptions become doc comments. `--check` fails CI when the file is out of date
  (`types-outdated`), `--stdout` prints it and `--sort` sorts the keys.
- Library: `generateDeclarations()`, `rawValueType()`, `DECLARATION_TARGETS` and the `DeclarationOptions` /
  `DeclarationTarget` types.

### Fixed

- `envguard example --stdout` printed its summary line after the template on stdout, so
  `envguard example --stdout > .env.example` wrote it into the file. With `--stdout` the summary now goes to stderr.

## [0.1.0] - 2026-11-17

### Added

- Schema builders `env.string`, `number`, `integer`, `boolean`, `url`,
  `email`, `enum`, `port`, `json`, `duration`, `list` and `custom`, with
  `default`, `optional`, `secret`, `description`, `example` and `aliases`,
  and full TypeScript inference through `InferEnv`.
- `loadEnv()` with the `.env`, `.env.local`, `.env.<mode>`,
  `.env.<mode>.local` cascade, aggregated `EnvValidationError` messages with
  file and line, masked secrets and `onError: 'exit'`.
- `parseEnv()` for browsers, edge runtimes and `import.meta.env`;
  `redact()`, `registerType()` and `assertValidSchema()`.
- A `.env` parser with `export`, single, double and backtick quotes,
  multiline values, escapes, inline comments, `${VAR}`, `${VAR:-x}`,
  `${VAR-x}`, `${VAR:+x}` expansion and line-numbered problems.
- CLI commands `check`, `example`, `diff`, `scan`, `doctor` and `init`, with
  `--format pretty|json|github`, `--fail-on` and exit codes 0, 1 and 2.
- Secret scanning with 14 built-in patterns, placeholder detection, inline
  and config allowlists.
- Doctor checks for `.gitignore`, the template, the schema, `.env`
  completeness, syntax and secrets in templates.
- `envguard.config.json` or `package.json#envguard` configuration.
- ESM and CommonJS builds with type declarations; no runtime dependencies.

[Unreleased]: https://github.com/saizul/envguard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/saizul/envguard/releases/tag/v0.1.0
