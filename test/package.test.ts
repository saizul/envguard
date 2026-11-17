import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import * as esm from '../src/index.js';

const require = createRequire(import.meta.url);

describe('package', () => {
  it('the CommonJS build exposes the same API', () => {
    const cjs = require('../cjs/index.js') as typeof esm;
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
    const r = cjs.parseEnv({ PORT: cjs.env.port({ default: 1 }) }, {});
    assert.equal(r.env.PORT, 1);
  });

  it('the CommonJS folder is marked as commonjs', () => {
    const pkg = JSON.parse(readFileSync(new URL('../cjs/package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.type, 'commonjs');
  });

  it('has no runtime dependencies and versions agree', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.version, esm.VERSION);
    assert.equal(pkg.bin.envguard, './dist/esm/cli.js');
  });

  it('the CLI entry starts with a shebang', () => {
    const cli = readFileSync(new URL('../esm/cli.js', import.meta.url), 'utf8');
    assert.ok(cli.startsWith('#!/usr/bin/env node'));
  });

  it('the README documents every secret pattern and doctor check', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    for (const p of esm.builtinPatterns) assert.ok(readme.includes(`| \`${p.id}\``), p.id);
    for (const c of esm.doctorChecks) assert.ok(readme.includes(`| \`${c.id}\``), c.id);
    for (const t of esm.typeNames()) assert.ok(readme.includes(`| \`${t}\``), t);
  });
});
