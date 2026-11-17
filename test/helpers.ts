import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { run } from '../src/cli/run.js';

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/**
 * Creates a temporary project with the given files. Fixtures are written at
 * runtime so that env files are not committed and fake credentials never
 * appear as literals in the repository.
 */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'envguard-test-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

export async function cli(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd,
    env,
    isTTY: false,
  });
  return { code, stdout, stderr };
}

/**
 * Fake credentials in the shape of real ones, assembled from pieces so the
 * source of this repository contains no matchable token.
 */
export const fake = {
  github: () => ['gh', 'p_', 'R7tQ2mWv9KzL'.repeat(3)].join(''),
  aws: () => ['AK', 'IA', 'Q3ZT7WRL2M4N6P5V'].join(''),
  stripe: () => ['sk', '_live_', 'Zq81Lm2Nb7Vc4Xr9Tt6Yp3Ww'].join(''),
  slackToken: () => ['xo', 'xb-', '2741-90813-Hq7LmZ3rT9w'].join(''),
  google: () => ['AI', 'za', 'Sy3Q9t1Kx8Lm2Np7Qr4Vb6Wc0Ze5Hj2Gf4D'].join(''),
  npm: () => ['np', 'm_', 'k7Q2mW9vLz3Rt8Yp4Nb6Xc1Df5Gh0Js2KaQw'].join(''),
  privateKeyHeader: () => ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
  jwt: () =>
    [
      ['ey', 'JhbGciOiJIUzI1NiJ9'].join(''),
      ['ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0'].join(''),
      'q7Lm2Np8Xr4Vb6Wc0Ze5',
    ].join('.'),
  generic: () => ['Hq7Lm', 'Z3rT9w', 'Kx81Vb', '4Nc2'].join(''),
  urlPassword: () => ['postgres://app:', 'Tr7mQ2xLp9Vz', '@db.internal:5432/app'].join(''),
};
