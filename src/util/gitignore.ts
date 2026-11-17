import { globToRegExp } from './glob.js';

interface Rule {
  negate: boolean;
  dirOnly: boolean;
  re: RegExp;
  source: string;
}

/**
 * A small `.gitignore` matcher covering the rules that matter for env files:
 * comments, `!` negation, anchored (`/x`, `a/b`) and unanchored patterns,
 * trailing `/` for directories, `*`, `?`, `**` and escaped `\#` / `\!`.
 */
export class GitIgnore {
  private readonly rules: Rule[] = [];

  constructor(content: string) {
    for (let line of content.replace(/\r\n?/g, '\n').split('\n')) {
      line = line.replace(/(?<!\\)\s+$/, '');
      if (line === '' || line.startsWith('#')) continue;
      let negate = false;
      if (line.startsWith('!')) {
        negate = true;
        line = line.slice(1);
      } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
        line = line.slice(1);
      }
      let dirOnly = false;
      if (line.endsWith('/')) {
        dirOnly = true;
        line = line.slice(0, -1);
      }
      const anchored = line.includes('/');
      const body = line.replace(/^\//, '');
      const glob = anchored ? body : `**/${body}`;
      this.rules.push({ negate, dirOnly, re: globToRegExp(glob), source: line });
    }
  }

  /** Whether a path (relative to the repository root, forward slashes) is ignored. */
  ignores(path: string, isDir = false): boolean {
    const parts = path.split('/').filter(Boolean);
    // A file inside an ignored directory is ignored, and cannot be re-included.
    for (let i = 1; i < parts.length; i++) {
      if (this.match(parts.slice(0, i).join('/'), true)) return true;
    }
    return this.match(parts.join('/'), isDir);
  }

  /** The last rule that decides the path, for messages. */
  explain(path: string, isDir = false): string | undefined {
    let hit: string | undefined;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(path)) hit = `${rule.negate ? '!' : ''}${rule.source}${rule.dirOnly ? '/' : ''}`;
    }
    return hit;
  }

  private match(path: string, isDir: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(path)) ignored = !rule.negate;
    }
    return ignored;
  }
}
