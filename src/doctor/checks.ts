import { diffEnv } from '../diff.js';
import { scanText } from '../scan/scanner.js';
import type { CheckResult, DoctorCheck } from './types.js';

/** Template files that are meant to be committed. */
export const TEMPLATE_RE = /^\.env\.(example|sample|template|defaults|dist)$/;

const pass = (message: string): CheckResult[] => [{ status: 'pass', message }];

export const gitignoreCheck: DoctorCheck = {
  id: 'env-gitignored',
  title: '.env files are ignored by git',
  run(ctx) {
    if (!ctx.gitignore) {
      return [
        {
          status: 'fail',
          message: 'No .gitignore found, so .env files can be committed by accident',
          hint: 'Create .gitignore with the lines ".env", ".env.*" and "!.env.example"',
        },
      ];
    }
    const results: CheckResult[] = [];
    const locals = ctx.envFiles.filter((f) => !TEMPLATE_RE.test(f));
    const probe = locals.length > 0 ? locals : ['.env'];
    for (const file of probe) {
      if (!ctx.gitignore.ignores(file)) {
        results.push({
          status: 'fail',
          file,
          message:
            locals.length > 0
              ? `${file} is not ignored by .gitignore`
              : '.gitignore does not ignore .env; a future .env would be committable',
          hint: `Add "${file === '.env' ? '.env' : '.env.*'}" to .gitignore`,
        });
      }
    }
    if (!ctx.gitignore.ignores('.env.local')) {
      results.push({
        status: 'warn',
        message: '.gitignore does not ignore .env.local / .env.*.local',
        hint: 'Add ".env.*" (and "!.env.example") or ".env*.local" to .gitignore',
      });
    }
    return results.length > 0 ? results : pass(`${probe.join(', ')} ignored`);
  },
};

export const exampleExistsCheck: DoctorCheck = {
  id: 'example-exists',
  title: 'A template file exists',
  run(ctx) {
    if (ctx.exampleExists) return pass(`${ctx.exampleFile} found`);
    return [
      {
        status: 'warn',
        message: `${ctx.exampleFile} is missing; new contributors cannot tell which variables to set`,
        hint: ctx.schema
          ? 'Run "envguard example" to create it from the schema'
          : 'Create it with every key and no real values',
      },
    ];
  },
};

export const exampleNotIgnoredCheck: DoctorCheck = {
  id: 'example-committable',
  title: 'The template is not ignored by git',
  run(ctx) {
    if (!ctx.exampleExists || !ctx.gitignore) return [{ status: 'skip', message: 'nothing to check' }];
    if (!ctx.gitignore.ignores(ctx.exampleFile)) return pass(`${ctx.exampleFile} can be committed`);
    const rule = ctx.gitignore.explain(ctx.exampleFile);
    return [
      {
        status: 'fail',
        file: ctx.exampleFile,
        message: `${ctx.exampleFile} is ignored by git${rule ? ` (rule "${rule}")` : ''}, so it never reaches the repository`,
        hint: `Add "!${ctx.exampleFile}" to .gitignore after that rule`,
      },
    ];
  },
};

export const schemaCheck: DoctorCheck = {
  id: 'schema-valid',
  title: 'The schema loads',
  run(ctx) {
    if (ctx.schemaError) return [{ status: 'fail', file: ctx.schemaFile, message: ctx.schemaError }];
    if (!ctx.schema)
      return [
        {
          status: 'warn',
          message: 'No env.schema.* file; variables are not validated',
          hint: 'Run "envguard init" to create env.schema.json from your template',
        },
      ];
    return pass(`${ctx.schemaFile} declares ${Object.keys(ctx.schema).length} variables`);
  },
};

export const exampleSyncCheck: DoctorCheck = {
  id: 'example-in-sync',
  title: 'The template matches the schema',
  run(ctx) {
    if (!ctx.schema || !ctx.exampleExists)
      return [{ status: 'skip', message: 'needs a schema and a template' }];
    const inExample = new Set(ctx.example.map((e) => e.key));
    const results: CheckResult[] = [];
    for (const key of Object.keys(ctx.schema)) {
      if (!inExample.has(key))
        results.push({
          status: 'warn',
          file: ctx.exampleFile,
          message: `${key} is in the schema but not in ${ctx.exampleFile}`,
          hint: 'Run "envguard example" to refresh the template',
        });
    }
    for (const e of ctx.example) {
      if (!Object.hasOwn(ctx.schema, e.key))
        results.push({
          status: 'warn',
          file: ctx.exampleFile,
          line: e.line,
          message: `${e.key} is in ${ctx.exampleFile} but not in the schema`,
          hint: 'Declare it in the schema or remove it from the template',
        });
    }
    return results.length > 0 ? results : pass('same keys');
  },
};

export const envMatchesExampleCheck: DoctorCheck = {
  id: 'env-complete',
  title: 'Local .env has every key of the template',
  run(ctx) {
    if (!ctx.exampleExists || !ctx.envFiles.includes('.env'))
      return [{ status: 'skip', message: 'needs .env and a template' }];
    const env = ctx.parse('.env');
    if (!env) return [{ status: 'skip', message: '.env could not be read' }];
    const d = diffEnv(env.entries, ctx.example);
    if (d.missing.length === 0) return pass('no missing keys');
    return [
      {
        status: 'warn',
        file: '.env',
        message: `.env lacks ${d.missing.length} key${d.missing.length === 1 ? '' : 's'} of ${ctx.exampleFile}: ${d.missing.map((m) => m.key).join(', ')}`,
        hint: `Copy them from ${ctx.exampleFile}`,
      },
    ];
  },
};

export const parseCheck: DoctorCheck = {
  id: 'env-syntax',
  title: '.env files parse cleanly',
  run(ctx) {
    const results: CheckResult[] = [];
    for (const file of ctx.envFiles) {
      const parsed = ctx.parse(file);
      for (const p of parsed?.problems ?? []) {
        results.push({
          status: p.severity === 'error' ? 'fail' : 'warn',
          file,
          line: p.line,
          message: p.message,
        });
      }
    }
    if (ctx.envFiles.length === 0) return [{ status: 'skip', message: 'no .env files' }];
    return results.length > 0
      ? results
      : pass(`${ctx.envFiles.length} file${ctx.envFiles.length === 1 ? '' : 's'} parsed`);
  },
};

export const templateSecretsCheck: DoctorCheck = {
  id: 'template-no-secrets',
  title: 'Committed templates contain no secrets',
  run(ctx) {
    const templates = ctx.envFiles.filter((f) => TEMPLATE_RE.test(f));
    if (templates.length === 0) return [{ status: 'skip', message: 'no template files' }];
    const results: CheckResult[] = [];
    for (const file of templates) {
      const text = ctx.read(file);
      if (text === undefined) continue;
      for (const f of scanText(text, file, { allow: ctx.allow })) {
        results.push({
          status: f.severity === 'error' ? 'fail' : 'warn',
          file,
          line: f.line,
          message: `${f.title}: ${f.preview}`,
          hint: 'Replace it with a placeholder and rotate the credential if it was ever committed',
        });
      }
    }
    return results.length > 0 ? results : pass(`${templates.join(', ')} clean`);
  },
};

/** The checks `envguard doctor` runs, in order. */
export const doctorChecks: DoctorCheck[] = [
  gitignoreCheck,
  exampleExistsCheck,
  exampleNotIgnoredCheck,
  schemaCheck,
  exampleSyncCheck,
  envMatchesExampleCheck,
  parseCheck,
  templateSecretsCheck,
];
