/**
 * Display utilities -- colors, formatting, progress bars.
 * Makes terminal output feel premium.
 */

// --- ANSI Colors -----------------------------------------------------
export const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// --- Engagement Formatting -------------------------------------------
export function formatEngagement(likes: number, replies: number, reposts: number): string {
  const parts: string[] = [];
  if (likes > 0) parts.push(colors.red(`${likes} likes`));
  if (replies > 0) parts.push(colors.blue(`${replies} replies`));
  if (reposts > 0) parts.push(colors.green(`${reposts} reposts`));
  return parts.length > 0 ? parts.join(colors.gray(' / ')) : colors.gray('no engagement yet');
}

// --- Progress Bar ----------------------------------------------------
export function progressBar(value: number, max: number, width: number = 20): string {
  const pct = Math.min(value / max, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const color = pct > 0.8 ? colors.green : pct > 0.5 ? colors.yellow : colors.gray;
  return color(bar) + ` ${Math.round(pct * 100)}%`;
}

// --- Horizontal Rule -------------------------------------------------
export function hr(char: string = '\u2500', width: number = 50): string {
  return colors.gray(char.repeat(width));
}

// --- Box Drawing -----------------------------------------------------
export function box(title: string, content: string[], width: number = 50): string {
  const lines = [
    `\u2554${'\u2550'.repeat(width - 2)}\u2557`,
    `\u2551 ${colors.bold(title.padEnd(width - 4))} \u2551`,
    `\u2560${'\u2550'.repeat(width - 2)}\u2563`,
    ...content.map(l => `\u2551 ${l.padEnd(width - 4)} \u2551`),
    `\u255A${'\u2550'.repeat(width - 2)}\u255D`,
  ];
  return lines.join('\n');
}

// --- Table Formatting ------------------------------------------------
export function table(headers: string[], rows: string[][], colWidths?: number[]): string {
  const widths = colWidths ?? headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)) + 2,
  );
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('');
  const separator = widths.map(w => '\u2500'.repeat(w)).join('');
  const dataLines = rows.map(row =>
    row.map((cell, i) => cell.padEnd(widths[i])).join(''),
  );
  return [colors.bold(headerLine), colors.gray(separator), ...dataLines].join('\n');
}

// --- Terminal Bell ---------------------------------------------------
export function bell(): void {
  process.stdout.write('\x07');
}
