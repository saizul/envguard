export type Severity = 'error' | 'warning' | 'notice';

/** One reportable problem, shared by every command. */
export interface Finding {
  severity: Severity;
  message: string;
  /** Short rule or check ID, e.g. `missing` or `github-token`. */
  rule?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CommandReport {
  command: string;
  findings: Finding[];
  /** One-line result, e.g. "3 errors in .env". */
  summary: string;
  /** Pretty output body; when absent the findings are listed. */
  lines?: string[];
  /** Machine-readable details for `--format json`. */
  data?: unknown;
}

export type Format = 'pretty' | 'json' | 'github';

export interface Colors {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  cyan(s: string): string;
}

export function colors(enabled: boolean): Colors {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Escapes data for a GitHub Actions workflow command. */
export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** A workflow command such as `::error file=.env,line=3,title=missing::PORT is missing`. */
export function annotation(f: Finding, prefix = 'envguard'): string {
  const props: string[] = [];
  if (f.file) props.push(`file=${escapeProperty(f.file)}`);
  if (f.line) props.push(`line=${f.line}`);
  if (f.column) props.push(`col=${f.column}`);
  props.push(`title=${escapeProperty(f.rule ? `${prefix} ${f.rule}` : prefix)}`);
  return `::${f.severity} ${props.join(',')}::${escapeData(f.message)}`;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0),
  );
}

export function formatReport(report: CommandReport, format: Format, c: Colors): string {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        command: report.command,
        summary: report.summary,
        errors: report.findings.filter((f) => f.severity === 'error').length,
        warnings: report.findings.filter((f) => f.severity === 'warning').length,
        findings: sortFindings(report.findings),
        data: report.data,
      },
      null,
      2,
    )}\n`;
  }
  if (format === 'github') {
    const lines = sortFindings(report.findings).map((f) => annotation(f));
    lines.push(report.summary);
    return `${lines.join('\n')}\n`;
  }
  const out: string[] = [];
  if (report.lines) out.push(...report.lines);
  else {
    let lastFile: string | null | undefined = null;
    for (const f of sortFindings(report.findings)) {
      if (f.file !== lastFile) {
        if (out.length > 0) out.push('');
        out.push(c.bold(f.file ?? '(environment)'));
        lastFile = f.file;
      }
      const sev =
        f.severity === 'error'
          ? c.red('error  ')
          : f.severity === 'warning'
            ? c.yellow('warning')
            : c.cyan('notice ');
      const loc = f.line
        ? c.dim(`${String(f.line).padStart(4)}${f.column ? `:${f.column}` : ''}  `)
        : '      ';
      out.push(`  ${loc}${sev}  ${f.message}${f.rule ? `  ${c.dim(f.rule)}` : ''}`);
    }
  }
  if (out.length > 0) out.push('');
  const errors = report.findings.some((f) => f.severity === 'error');
  const warnings = report.findings.some((f) => f.severity === 'warning');
  const mark = errors ? c.red('✖') : warnings ? c.yellow('⚠') : c.green('✔');
  out.push(`${mark} ${report.summary}`);
  return `${out.join('\n')}\n`;
}

export type FailOn = 'error' | 'warning' | 'none';

/** Exit code 1 when a finding at or above the threshold exists. */
export function exitCodeFor(findings: Finding[], failOn: FailOn): number {
  if (failOn === 'none') return 0;
  if (findings.some((f) => f.severity === 'error')) return 1;
  if (failOn === 'warning' && findings.some((f) => f.severity === 'warning')) return 1;
  return 0;
}
