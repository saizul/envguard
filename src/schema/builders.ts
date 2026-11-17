import type { Field, FieldSpec, Schema } from './types.js';

/** Options every field accepts. */
export interface CommonOptions<T> {
  default?: T;
  optional?: boolean;
  secret?: boolean;
  description?: string;
  example?: string;
  aliases?: string[];
}

export interface StringOptions extends CommonOptions<string> {
  minLength?: number;
  maxLength?: number;
  /** A regular expression source the value must match (Unicode mode). */
  pattern?: string;
  /** Trim surrounding whitespace. Default `true`. */
  trim?: boolean;
}

export interface NumberOptions extends CommonOptions<number> {
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface UrlOptions extends CommonOptions<string> {
  /** Allowed schemes without the colon, e.g. `['https']` or `['postgres', 'postgresql']`. */
  protocols?: string[];
}

export interface EnumOptions<V extends string> extends CommonOptions<V> {
  caseInsensitive?: boolean;
}

export interface PortOptions extends CommonOptions<number> {
  allowZero?: boolean;
}

export interface DurationOptions extends Omit<CommonOptions<number>, 'default'> {
  /** Milliseconds, or a duration string such as `'30s'`. */
  default?: number | string;
  min?: number;
  max?: number;
}

export interface ListOptions extends CommonOptions<string[]> {
  separator?: string;
  minItems?: number;
}

/** The options type used when a builder is called without options. */
export type NoOptions = Record<never, never>;

type Built<T, O> = Field<T> & O & { type: string };

function make<T, O extends object>(type: string, options: O | undefined, extra?: object): Built<T, O> {
  return { ...(extra ?? {}), ...(options ?? {}), type } as unknown as Built<T, O>;
}

/**
 * Field builders. Each returns a plain object that also carries the parsed
 * TypeScript type, so `loadEnv()` can infer the result:
 *
 * ```ts
 * const schema = {
 *   PORT: env.port({ default: 3000 }),
 *   NODE_ENV: env.enum(['development', 'production', 'test'], { default: 'development' }),
 *   DATABASE_URL: env.url({ protocols: ['postgres', 'postgresql'], secret: true }),
 * };
 * ```
 */
export const env = {
  string: <const O extends StringOptions = NoOptions>(options?: O) => make<string, O>('string', options),
  number: <const O extends NumberOptions = NoOptions>(options?: O) => make<number, O>('number', options),
  integer: <const O extends Omit<NumberOptions, 'integer'> = NoOptions>(options?: O) =>
    make<number, O>('integer', options),
  boolean: <const O extends CommonOptions<boolean> = NoOptions>(options?: O) =>
    make<boolean, O>('boolean', options),
  url: <const O extends UrlOptions = NoOptions>(options?: O) => make<string, O>('url', options),
  email: <const O extends CommonOptions<string> = NoOptions>(options?: O) =>
    make<string, O>('email', options),
  port: <const O extends PortOptions = NoOptions>(options?: O) => make<number, O>('port', options),
  duration: <const O extends DurationOptions = NoOptions>(options?: O) =>
    make<number, O>('duration', options),
  list: <const O extends ListOptions = NoOptions>(options?: O) => make<string[], O>('list', options),
  json: <T = unknown, const O extends CommonOptions<T> = NoOptions>(options?: O) =>
    make<T, O>('json', options),
  enum: <const V extends string, const O extends EnumOptions<V> = NoOptions>(
    values: readonly V[],
    options?: O,
  ) => make<V, O>('enum', options, { values: [...values] }),
  /** A field of a type added with `registerType()`. */
  custom: <T = string, const O extends CommonOptions<T> & Record<string, unknown> = NoOptions>(
    type: string,
    options?: O,
  ) => make<T, O>(type, options),
};

/** Identity helper that keeps literal types; handy in `env.schema.ts`. */
export function defineSchema<const S extends Schema>(schema: S): S {
  return schema;
}

/** True when the field has to be present (no default, not optional). */
export function isRequired(field: FieldSpec): boolean {
  return field.default === undefined && field.optional !== true;
}
