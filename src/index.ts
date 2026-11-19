export { type EnvguardConfig, ConfigError, CONFIG_FILE, loadConfig, validateConfig } from './config.js';
export { type EnvDiff, diffEnv } from './diff.js';
export { doctorChecks, TEMPLATE_RE } from './doctor/checks.js';
export { type DoctorOptions, type DoctorReport, runDoctor } from './doctor/index.js';
export type { CheckResult, CheckStatus, DoctorCheck, DoctorContext } from './doctor/types.js';
export {
  DECLARATION_TARGETS,
  type DeclarationOptions,
  type DeclarationTarget,
  generateDeclarations,
  rawValueType,
} from './declarations.js';
export { DEFAULT_HEADER, type ExampleOptions, exampleValue, generateExample } from './example.js';
export {
  defaultEnvFiles,
  type FileProblem,
  type LoadedFiles,
  type LoadFilesOptions,
  loadEnvFiles,
} from './files.js';
export { inferField, inferSchema, schemaToTypeScript } from './init.js';
export { type LoadEnvOptions, loadEnv } from './load.js';
export {
  type DotenvEntry,
  type DotenvProblem,
  type DotenvProblemCode,
  formatDotenvValue,
  type ParseOptions,
  type ParseResult,
  parseDotenv,
  type QuoteStyle,
} from './parser/dotenv.js';
export { expandValue } from './parser/expand.js';
export { annotation, type CommandReport, type Finding, type Severity } from './report/index.js';
export { builtinPatterns, entropy, isPlaceholder, type SecretPattern } from './scan/patterns.js';
export {
  DEFAULT_SCAN_GLOBS,
  preview,
  type ScanOptions,
  type ScanResult,
  type SecretFinding,
  scanFiles,
  scanText,
} from './scan/scanner.js';
export {
  type CommonOptions,
  defineSchema,
  type DurationOptions,
  type EnumOptions,
  env,
  isRequired,
  type ListOptions,
  type NumberOptions,
  type PortOptions,
  type StringOptions,
  type UrlOptions,
} from './schema/builders.js';
export { formatDuration, parseDuration } from './schema/duration.js';
export {
  describeField,
  getType,
  type ParseOutcome,
  registerType,
  type TypeDefinition,
  typeNames,
} from './schema/registry.js';
export type {
  BuiltinType,
  EnvIssue,
  Field,
  FieldSpec,
  InferEnv,
  InferField,
  Schema,
} from './schema/types.js';
export {
  assertValidSchema,
  EnvValidationError,
  formatIssues,
  mask,
  type ParseEnvOptions,
  type ParseEnvResult,
  parseEnv,
  redact,
  SchemaError,
  type ValueOrigin,
} from './schema/validate.js';
export { GitIgnore } from './util/gitignore.js';
export { findFiles, globToRegExp } from './util/glob.js';
export { VERSION } from './version.js';
