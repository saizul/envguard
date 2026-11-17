/**
 * A detector for one kind of credential. Patterns are deliberately specific:
 * a finding should almost always be worth a look.
 */
export interface SecretPattern {
  /** Stable kebab-case ID, used in output, `--disable` and allowlists. */
  id: string;
  /** Human name, e.g. "GitHub token". */
  title: string;
  /**
   * Regular expression without the `g` flag; the scanner adds it. When the
   * expression has a capture group, group 1 is the secret itself.
   */
  regex: RegExp;
  /** `error` for well-known token formats, `warning` for heuristics. */
  severity: 'error' | 'warning';
  /** Cheap substrings; a line is only tested when it contains one. */
  keywords?: string[];
  /** Extra check on the secret; return false to drop the match. */
  verify?(secret: string, line: string): boolean;
}

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER_RE =
  /example|sample|placeholder|changeme|change[-_]me|replace[-_]?me|your[-_]|dummy|fake|redacted|xxxx|\*\*\*\*|\.\.\.|<[^>]*>|\$\{|\{\{|^(.)\1+$/i;

/** True for values that are obviously not real: `your-token-here`, `xxxx`, `${TOKEN}`, `<secret>`. */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value);
}

/** Passwords commonly used for local development databases in compose files. */
const DEV_PASSWORDS = new Set([
  'password',
  'pass',
  'secret',
  'postgres',
  'mysql',
  'root',
  'admin',
  'user',
  'test',
  'dev',
  'local',
  'guest',
  'mongo',
  'redis',
  'changeme',
]);

export const builtinPatterns: SecretPattern[] = [
  {
    id: 'private-key',
    title: 'Private key',
    regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
    severity: 'error',
    keywords: ['PRIVATE KEY'],
  },
  {
    id: 'aws-access-key-id',
    title: 'AWS access key ID',
    regex: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/,
    severity: 'error',
    keywords: ['AKIA', 'ASIA', 'ABIA', 'ACCA'],
  },
  {
    id: 'github-token',
    title: 'GitHub token',
    regex: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/,
    severity: 'error',
    keywords: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
  },
  {
    id: 'gitlab-token',
    title: 'GitLab token',
    regex: /\b(glpat-[A-Za-z0-9_-]{20,})\b/,
    severity: 'error',
    keywords: ['glpat-'],
  },
  {
    id: 'slack-token',
    title: 'Slack token',
    regex: /\b(xox[abposr]-[A-Za-z0-9-]{10,})\b/,
    severity: 'error',
    keywords: ['xox'],
  },
  {
    id: 'slack-webhook',
    title: 'Slack webhook URL',
    regex: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,})/,
    severity: 'error',
    keywords: ['hooks.slack.com'],
  },
  {
    id: 'stripe-live-key',
    title: 'Stripe live secret key',
    regex: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})\b/,
    severity: 'error',
    keywords: ['_live_'],
  },
  {
    id: 'google-api-key',
    title: 'Google API key',
    regex: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/,
    severity: 'error',
    keywords: ['AIza'],
  },
  {
    id: 'npm-token',
    title: 'npm access token',
    regex: /\b(npm_[A-Za-z0-9]{36})\b/,
    severity: 'error',
    keywords: ['npm_'],
  },
  {
    id: 'sendgrid-api-key',
    title: 'SendGrid API key',
    regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/,
    severity: 'error',
    keywords: ['SG.'],
  },
  {
    id: 'azure-storage-key',
    title: 'Azure storage account key',
    regex: /AccountKey=([A-Za-z0-9+/]{86}==)/,
    severity: 'error',
    keywords: ['AccountKey='],
  },
  {
    id: 'jwt',
    title: 'JSON Web Token',
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
    severity: 'warning',
    keywords: ['eyJ'],
  },
  {
    id: 'url-credentials',
    title: 'Password in a URL',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s/@'"]+)@[^\s/'"]+/i,
    severity: 'warning',
    keywords: ['://'],
    verify: (secret) => !DEV_PASSWORDS.has(secret.toLowerCase()) && secret.length >= 6,
  },
  {
    id: 'generic-secret',
    title: 'High-entropy value assigned to a secret-like name',
    regex:
      /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|AUTH_KEY|CLIENT_SECRET)[A-Z0-9_]*["']?\s*[:=]\s*["']?([^\s"'#]{16,})/i,
    severity: 'warning',
    keywords: ['SECRET', 'TOKEN', 'PASSW', 'KEY', 'secret', 'token', 'passw', 'key'],
    verify: (secret) => entropy(secret) >= 3.5 && /[A-Za-z]/.test(secret) && /\d/.test(secret),
  },
];
