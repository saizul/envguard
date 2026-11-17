/** Built-in variable types. */
export type BuiltinType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'url'
  | 'email'
  | 'enum'
  | 'port'
  | 'json'
  | 'duration'
  | 'list';

/**
 * The description of one variable. Builders such as `env.port()` return it,
 * and the same shape is used in `env.schema.json`.
 */
export interface FieldSpec {
  /** A built-in type or one added with `registerType()`. */
  type: string;
  /** Used when the variable is missing or empty. Makes the variable non-required. */
  default?: unknown;
  /** When true a missing variable is `undefined` instead of an error. */
  optional?: boolean;
  /** Secrets are masked in messages and left blank in `.env.example`. */
  secret?: boolean;
  /** Human description; becomes a comment in `.env.example`. */
  description?: string;
  /** Example value for `.env.example` and error messages. */
  example?: string;
  /** Other names to read the value from, in order, when the main name is unset. */
  aliases?: string[];
  /** Type-specific options, for example `min`, `values` or `protocols`. */
  [option: string]: unknown;
}

/** A record of variable name to field. */
export type Schema = Record<string, FieldSpec>;

declare const OUTPUT: unique symbol;

/** A field produced by a builder. It carries its parsed TypeScript type. */
export type Field<T> = FieldSpec & { readonly [OUTPUT]?: [T] };

type Duration = number;

/** Maps a plain `{ type: '...' }` spec (for example from JSON) to its value type. */
type TypeOfSpec<F> = F extends { type: 'number' | 'integer' | 'port' }
  ? number
  : F extends { type: 'duration' }
    ? Duration
    : F extends { type: 'boolean' }
      ? boolean
      : F extends { type: 'list' }
        ? string[]
        : F extends { type: 'json' }
          ? unknown
          : F extends { type: 'enum'; values: readonly (infer V)[] }
            ? V
            : string;

type HasDefault<F> = F extends { default: infer D } ? (undefined extends D ? false : true) : false;

type BaseOf<F> = F extends { readonly [OUTPUT]?: [infer T] } ? T : TypeOfSpec<F>;

/** The value type of one field, including `undefined` for optional fields. */
export type InferField<F> =
  HasDefault<F> extends true ? BaseOf<F> : F extends { optional: true } ? BaseOf<F> | undefined : BaseOf<F>;

/** The typed object `loadEnv(schema)` returns. */
export type InferEnv<S> = { readonly [K in keyof S]: InferField<S[K]> };

/** One problem found while validating the environment. */
export interface EnvIssue {
  key: string;
  code: 'missing' | 'invalid' | 'empty' | 'unknown';
  message: string;
  /** The offending value, masked when the field is a secret. */
  value?: string;
  /** Where the value came from, when it came from a file. */
  file?: string;
  line?: number;
  severity: 'error' | 'warning';
}
