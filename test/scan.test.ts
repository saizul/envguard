import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { builtinPatterns, entropy, isPlaceholder, preview, scanFiles, scanText } from '../src/index.js';
import { fake, project } from './helpers.js';

const ids = (text: string, options = {}) => scanText(text, 'f', options).map((f) => f.patternId);

describe('scanText: built-in patterns', () => {
  const cases: Array<[string, string]> = [
    ['github-token', `GITHUB_TOKEN=${fake.github()}`],
    ['aws-access-key-id', `AWS_ACCESS_KEY_ID=${fake.aws()}`],
    ['stripe-live-key', `STRIPE_SECRET_KEY=${fake.stripe()}`],
    ['slack-token', `SLACK=${fake.slackToken()}`],
    ['google-api-key', `MAPS=${fake.google()}`],
    ['npm-token', `//registry.npmjs.org/:_authToken=${fake.npm()}`],
    ['private-key', fake.privateKeyHeader()],
    ['jwt', `Authorization: Bearer ${fake.jwt()}`],
    ['url-credentials', `DATABASE_URL=${fake.urlPassword()}`],
    ['generic-secret', `MY_SERVICE_SECRET=${fake.generic()}`],
  ];
  for (const [id, line] of cases) {
    it(`detects ${id}`, () => {
      assert.deepEqual(ids(line), [id]);
    });
  }

  it('every pattern has a unique kebab-case id and a title', () => {
    const seen = new Set<string>();
    for (const p of builtinPatterns) {
      assert.match(p.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(p.title.length > 3);
      assert.ok(!seen.has(p.id), p.id);
      seen.add(p.id);
    }
  });
});

describe('scanText: no false positives on templates', () => {
  const clean = [
    'GITHUB_TOKEN=',
    'GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}',
    'NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}',
    'API_KEY=your-api-key-here',
    'API_KEY=<your key>',
    'API_KEY=xxxxxxxxxxxxxxxxxxxx',
    'API_KEY=changeme',
    'SECRET_KEY=...',
    // The documented placeholder from the AWS docs, assembled at runtime.
    `AWS_ACCESS_KEY_ID=${['AK', 'IAIOSFODNN7', 'EXAMPLE'].join('')}`,
    'DATABASE_URL=postgres://postgres:postgres@localhost:5432/app',
    'DATABASE_URL=postgres://user:password@localhost/app',
    'REDIS_URL=redis://localhost:6379',
    'SESSION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaa',
    'TOKEN_TTL=3600',
    'PUBLIC_KEY_PATH=./keys/public.pem',
    'See https://example.com/docs#token for details',
    'PASSWORD_MIN_LENGTH=12',
  ];
  for (const line of clean) {
    it(`ignores ${line}`, () => {
      assert.deepEqual(ids(line), []);
    });
  }
});

describe('scanText: allowlist', () => {
  const token = fake.github();

  it('inline marker on the same line', () => {
    assert.deepEqual(ids(`T=${token} # envguard-allow`), []);
  });

  it('marker comment on the previous line', () => {
    assert.deepEqual(ids(`# envguard-allow-next-line\nT=${token}\nU=${token}`).length, 1);
  });

  it('literal and regex entries', () => {
    assert.deepEqual(ids(`T=${token}`, { allow: [token.slice(4, 20)] }), []);
    assert.deepEqual(ids(`T=${token}`, { allow: ['/^ghp_R7tQ/'] }), []);
    assert.deepEqual(ids(`T=${token}`, { allow: ['/^nomatch/'] }), ['github-token']);
  });

  it('id: entries and disable turn a pattern off', () => {
    assert.deepEqual(ids(`T=${token}`, { allow: ['id:github-token'] }), []);
    assert.deepEqual(ids(`T=${token}`, { disable: ['github-token'] }), []);
  });

  it('custom patterns', () => {
    const r = scanText('acme_live_0123456789abcdef', 'f', {
      patterns: [{ id: 'acme', title: 'Acme key', regex: /\b(acme_live_[a-f0-9]{16})\b/, severity: 'error' }],
    });
    assert.equal(r[0]!.patternId, 'acme');
  });
});

describe('scanText: output', () => {
  it('reports line and column and masks the value', () => {
    const token = fake.github();
    const [f] = scanText(`# header\nexport GITHUB_TOKEN="${token}"`, '.env.example');
    assert.equal(f!.file, '.env.example');
    assert.equal(f!.line, 2);
    assert.equal(f!.column, 'export GITHUB_TOKEN="'.length + 1);
    assert.ok(!f!.preview.includes(token.slice(6)));
    assert.ok(f!.preview.includes('*'));
  });

  it('reports one finding per value even when patterns overlap', () => {
    // The generic pattern would also match the assignment; the specific one wins.
    assert.deepEqual(ids(`GITHUB_TOKEN=${fake.github()}`), ['github-token']);
  });

  it('helpers', () => {
    assert.ok(entropy('aaaa') < 0.01);
    assert.ok(entropy('abcd') === 2);
    assert.ok(isPlaceholder('your-token'));
    assert.ok(isPlaceholder('${TOKEN}'));
    assert.ok(!isPlaceholder(fake.generic()));
    assert.equal(preview('abcdefghijkl'), 'abc*********');
  });
});

describe('scanFiles', () => {
  it('scans the default committed files and skips others', () => {
    const cwd = project({
      '.env': `GITHUB_TOKEN=${fake.github()}\n`,
      '.env.example': `GITHUB_TOKEN=${fake.github()}\nPORT=3000\n`,
      'README.md': `Run with\n\n    AWS_ACCESS_KEY_ID=${fake.aws()} npm start\n`,
      'docker-compose.yml': `services:\n  db:\n    environment:\n      DATABASE_URL: ${fake.urlPassword()}\n`,
      'src/app.ts': `const t = '${fake.github()}';\n`,
      'node_modules/pkg/README.md': `${fake.github()}\n`,
      'apps/web/.env.example': `STRIPE_SECRET_KEY=${fake.stripe()}\n`,
    });
    const r = scanFiles({ cwd });
    assert.deepEqual(r.files, ['.env.example', 'README.md', 'apps/web/.env.example', 'docker-compose.yml']);
    assert.deepEqual(
      r.findings.map((f) => [f.file, f.patternId, f.line]),
      [
        ['.env.example', 'github-token', 1],
        ['README.md', 'aws-access-key-id', 3],
        ['apps/web/.env.example', 'stripe-live-key', 1],
        ['docker-compose.yml', 'url-credentials', 4],
      ],
    );
  });

  it('accepts explicit files and globs, and exclude', () => {
    const cwd = project({
      'config/a.txt': `${fake.github()}\n`,
      'config/b.txt': `${fake.github()}\n`,
      'notes.md': `${fake.npm()}\n`,
    });
    assert.equal(scanFiles({ cwd, include: ['notes.md'] }).findings.length, 1);
    assert.equal(scanFiles({ cwd, include: ['config/*.txt'] }).findings.length, 2);
    assert.equal(scanFiles({ cwd, include: ['config/*.txt'], exclude: ['config/b.txt'] }).findings.length, 1);
    assert.deepEqual(scanFiles({ cwd, include: ['missing.txt'] }).files, []);
  });
});
