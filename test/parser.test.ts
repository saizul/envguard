import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandValue, formatDotenvValue, parseDotenv } from '../src/index.js';

const values = (s: string, env: Record<string, string> = {}) => parseDotenv(s, { env }).values;

describe('parseDotenv: basics', () => {
  it('reads simple assignments, comments and blank lines', () => {
    const r = parseDotenv('# comment\nA=1\n\nB=two\n   # indented comment\nC=\n');
    assert.deepEqual(r.values, { A: '1', B: 'two', C: '' });
    assert.equal(r.problems.length, 0);
    assert.deepEqual(
      r.entries.map((e) => [e.key, e.line]),
      [
        ['A', 2],
        ['B', 4],
        ['C', 6],
      ],
    );
  });

  it('accepts export prefixes and spaces around =', () => {
    const r = parseDotenv('export A=1\nexport   B = 2\n  C  =  three  \n');
    assert.deepEqual(r.values, { A: '1', B: '2', C: 'three' });
    assert.equal(r.entries[0]!.exported, true);
    assert.equal(r.entries[2]!.exported, false);
  });

  it('a key named export still works', () => {
    assert.deepEqual(values('export=1\n'), { export: '1' });
  });

  it('keeps comments attached to the following entry', () => {
    const r = parseDotenv('# Port to listen on\n# (default 3000)\nPORT=3000\n\n# orphan\n\nX=1');
    assert.deepEqual(r.entries[0]!.comments, ['Port to listen on', '(default 3000)']);
    assert.deepEqual(r.entries[1]!.comments, []);
  });

  it('handles CRLF line endings and a byte order mark', () => {
    assert.deepEqual(values('\uFEFFA=1\r\nB="x\r\ny"\r\n'), { A: '1', B: 'x\ny' });
  });

  it('accepts dots and dashes in keys', () => {
    assert.deepEqual(values('spring.datasource.url=jdbc\nmy-key=1'), {
      'spring.datasource.url': 'jdbc',
      'my-key': '1',
    });
  });
});

describe('parseDotenv: unquoted values', () => {
  it('strips inline comments that follow whitespace', () => {
    assert.deepEqual(values('A=value # comment\nB=value\t#tab comment'), { A: 'value', B: 'value' });
  });

  it('keeps # without preceding whitespace', () => {
    assert.deepEqual(values('COLOR=#ff0000\nURL=https://x.test/#anchor\nP=a#b'), {
      COLOR: '',
      URL: 'https://x.test/#anchor',
      P: 'a#b',
    });
    // `#ff0000` right after `=` is a comment, like in shells and dotenv.
    const r = parseDotenv('COLOR=#ff0000');
    assert.equal(r.entries[0]!.inlineComment, 'ff0000');
  });

  it('keeps = signs inside values', () => {
    assert.deepEqual(values('Q=a=b=c\nB64=YWJj=='), { Q: 'a=b=c', B64: 'YWJj==' });
  });

  it('trims surrounding whitespace but keeps inner spaces', () => {
    assert.deepEqual(values('A=  hello world  '), { A: 'hello world' });
  });

  it('does not treat a lone quote inside a value as quoting', () => {
    assert.deepEqual(values(`A=it's\nB=say "hi"`), { A: "it's", B: 'say "hi"' });
  });
});

describe('parseDotenv: quoted values', () => {
  it('single quotes are literal', () => {
    assert.deepEqual(values("A='$HOME \\n # not a comment'", { HOME: '/root' }), {
      A: '$HOME \\n # not a comment',
    });
  });

  it('double quotes process escapes', () => {
    assert.deepEqual(values('A="line1\\nline2\\ttab \\"q\\" back\\\\slash"'), {
      A: 'line1\nline2\ttab "q" back\\slash',
    });
  });

  it('unknown escapes in double quotes are kept', () => {
    assert.deepEqual(values('A="C:\\path\\x"'), { A: 'C:\\path\\x' });
  });

  it('backticks are literal and may contain both quotes', () => {
    assert.deepEqual(values('A=`it\'s "quoted"`'), { A: 'it\'s "quoted"' });
  });

  it('allows a comment after the closing quote', () => {
    const r = parseDotenv('A="v # inside" # outside');
    assert.deepEqual(r.values, { A: 'v # inside' });
    assert.equal(r.entries[0]!.inlineComment, 'outside');
  });

  it('warns about characters after the closing quote', () => {
    const r = parseDotenv('A="v"junk');
    assert.equal(r.values.A, 'v');
    assert.equal(r.problems[0]!.code, 'trailing-characters');
  });

  it('empty quotes give an empty string', () => {
    assert.deepEqual(values(`A=""\nB=''\nC=\`\``), { A: '', B: '', C: '' });
  });
});

describe('parseDotenv: multiline values', () => {
  it('reads double-quoted values over several lines', () => {
    const r = parseDotenv('A="first\nsecond\n  third"\nB=after');
    assert.deepEqual(r.values, { A: 'first\nsecond\n  third', B: 'after' });
    assert.equal(r.entries[0]!.line, 1);
    assert.equal(r.entries[0]!.endLine, 3);
    assert.equal(r.entries[1]!.line, 4);
  });

  it('reads a PEM block in single quotes', () => {
    const body = ['-----BEGIN CERTIFICATE-----', 'MIIBszCCAVmgAwIBAgIU', '-----END CERTIFICATE-----'];
    const r = parseDotenv(`CERT='${body.join('\n')}'\nNEXT=1`);
    assert.equal(r.values.CERT, body.join('\n'));
    assert.equal(r.values.NEXT, '1');
  });

  it('an escaped quote does not close a double-quoted value', () => {
    assert.deepEqual(values('A="a\\"\nb"'), { A: 'a"\nb' });
  });

  it('reports an unterminated quote and stops', () => {
    const r = parseDotenv('A=1\nB="never closed\nC=3\n');
    assert.deepEqual(r.values, { A: '1' });
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0]!.code, 'unterminated-quote');
    assert.equal(r.problems[0]!.line, 2);
  });
});

describe('parseDotenv: expansion', () => {
  it('expands ${VAR} and $VAR from earlier lines', () => {
    assert.deepEqual(values('HOST=db\nPORT=5432\nURL=postgres://${HOST}:$PORT/app'), {
      HOST: 'db',
      PORT: '5432',
      URL: 'postgres://db:5432/app',
    });
  });

  it('expands inside double quotes but not single quotes', () => {
    assert.deepEqual(values(`A=x\nB="\${A}y"\nC='\${A}y'`), { A: 'x', B: 'xy', C: '${A}y' });
  });

  it('supports fallbacks', () => {
    const v = values('EMPTY=\nA=${MISSING:-fallback}\nB=${EMPTY:-used}\nC=${EMPTY-kept}\nD=${MISSING-dash}');
    assert.equal(v.A, 'fallback');
    assert.equal(v.B, 'used');
    assert.equal(v.C, '');
    assert.equal(v.D, 'dash');
  });

  it('supports nested references in fallbacks', () => {
    assert.equal(values('HOST=h\nA=${URL:-http://${HOST}:80}').A, 'http://h:80');
  });

  it('supports the :+ alternative form', () => {
    const v = values('SET=1\nA=${SET:+yes}\nB=${UNSET:+yes}');
    assert.equal(v.A, 'yes');
    assert.equal(v.B, '');
  });

  it('escaped dollars stay literal', () => {
    assert.deepEqual(values('A=\\$HOME\nB="cost \\$5"', { HOME: '/root' }), { A: '$HOME', B: 'cost $5' });
  });

  it('process env wins over file values by default', () => {
    assert.equal(values('A=file\nB=${A}', { A: 'env' }).B, 'env');
    assert.equal(parseDotenv('A=file\nB=${A}', { env: { A: 'env' }, envFirst: false }).values.B, 'file');
  });

  it('reports undefined variables', () => {
    const r = parseDotenv('A=${NOPE}/x');
    assert.equal(r.values.A, '/x');
    assert.equal(r.problems[0]!.code, 'undefined-variable');
  });

  it('can be turned off', () => {
    assert.equal(parseDotenv('A=1\nB=${A}', { expand: false }).values.B, '${A}');
  });

  it('a lone or trailing $ is kept', () => {
    assert.deepEqual(values('A=$\nB=5$\nC=$1'), { A: '$', B: '5$', C: '$1' });
  });

  it('expandValue works on its own', () => {
    const env: Record<string, string> = { USER: 'saizul' };
    assert.equal(
      expandValue('/home/${USER}/$USER', (n) => env[n]),
      '/home/saizul/saizul',
    );
  });
});

describe('parseDotenv: problems', () => {
  it('reports invalid keys and lines without =', () => {
    const r = parseDotenv('1BAD=x\nJUSTKEY\nhello world\nOK=1');
    assert.deepEqual(r.values, { OK: '1' });
    assert.deepEqual(
      r.problems.map((p) => [p.code, p.line]),
      [
        ['invalid-key', 1],
        ['missing-equals', 2],
        ['invalid-line', 3],
      ],
    );
  });

  it('reports duplicates and keeps the last value', () => {
    const r = parseDotenv('A=1\nB=2\nA=3');
    assert.equal(r.values.A, '3');
    assert.equal(r.entries.length, 3);
    assert.equal(r.problems[0]!.code, 'duplicate-key');
    assert.match(r.problems[0]!.message, /first on line 1/);
  });

  it('handles Unicode values', () => {
    assert.deepEqual(values('GREETING="স্বাগতম 👋"\nNAME=সাইজুল'), { GREETING: 'স্বাগতম 👋', NAME: 'সাইজুল' });
  });
});

describe('formatDotenvValue', () => {
  const roundTrip = (v: string) => parseDotenv(`K=${formatDotenvValue(v)}`).values.K;

  it('leaves simple values unquoted', () => {
    assert.equal(formatDotenvValue('abc-123'), 'abc-123');
    assert.equal(formatDotenvValue('https://x.test/a?b=c'), '"https://x.test/a?b=c"');
    assert.equal(formatDotenvValue(''), '');
  });

  for (const v of [
    'hello world',
    'a # b',
    'multi\nline',
    'quote " inside',
    'cost $5 ${X}',
    'tab\there',
    "it's",
    '\\',
  ]) {
    it(`round-trips ${JSON.stringify(v)}`, () => {
      assert.equal(roundTrip(v), v);
    });
  }
});
