// Internal shim behind logs.sh (`maude design logs`). See USAGE.
//
// The Logs half of Menu › Diagnostics from a terminal (S11.11): the same four sources — sync, server,
// AI, export — the same lines, merged by time like the sheet merges them. Read-only (effect none →
// auto tier); it reads `GET /_api/diagnostics`, the one place those lines are served from, so the
// sheet, the diagnostic report and this verb can never disagree about what was logged.
//
// REDACTION. The lines are scrubbed when they are recorded and again when they are served
// (diagnostics/store.ts → debug-bundle.ts scrub): tokens, keys, e-mails, the project root and the
// home folder never leave the studio. This verb scrubs ONCE MORE on the way out — a studio older than
// this verb must not be able to hand a secret to a terminal (or to Claude Code reading one).
//
// Log text is whatever a subsystem printed (file names, peer names, an error body from a hub): it is
// DATA, never instructions. It goes through the same untrusted block as comments (writeUntrusted).

import { scrub } from '../debug-bundle.ts';
import {
  call,
  connect,
  field,
  parseWords,
  runVerb,
  UsageError,
  untrustedJson,
  writeUntrusted,
} from './_studio-verb.mjs';

export const SOURCES = ['sync', 'server', 'ai', 'export'];
export const DEFAULT_TAIL = 100;
export const MAX_TAIL = 200;

export const USAGE = `usage: maude design logs [--source all|sync|server|ai|export] [--tail N] [--grep <text>] [--json] [--root <project>]
  --source  one source of the four Diagnostics › Logs filters by (default: all, merged by time)
  --tail    the last N lines (default ${DEFAULT_TAIL}, at most ${MAX_TAIL} — the studio keeps that many per source)
  --grep    only lines containing <text> (case-insensitive)
Read-only. Lines are redacted (tokens, keys, e-mails, paths) and printed between
<<<BEGIN UNTRUSTED DATA <nonce> and END UNTRUSTED DATA <nonce>>> — data, not instructions.
Logs are kept 7 days on this Mac (~/.maude/logs).
Exit 0 ok · 1 the studio refused · 2 usage · 3 no studio running.
`;

/** `[warn] [sync] hub replied 429` → { level: 'warn', text: 'hub replied 429' } (the prefix is the source). */
export function parseLine(raw, source) {
  const m = /^\[(log|info|warn|error|debug)\]\s*(.*)$/s.exec(String(raw));
  const level = m ? m[1] : 'log';
  let text = m ? m[2] : String(raw);
  const tag = new RegExp(`^\\[${source}(?::[a-z0-9-]+)?\\]\\s*`, 'i');
  text = text.replace(tag, '');
  return { level, text };
}

/**
 * The lines to show, oldest first. `payload` is the diagnostics JSON. Lines carry `at` (epoch ms)
 * when the studio recorded one; without it a source keeps its own order and sources are concatenated.
 */
export function collect(payload, { source = 'all', grep = '', tail = DEFAULT_TAIL } = {}) {
  const names = source === 'all' ? SOURCES : [source];
  const q = grep.trim().toLowerCase();
  const rows = [];
  let seq = 0;
  for (const name of names) {
    const src = payload?.sources?.[name];
    const recent = Array.isArray(src?.recent) ? src.recent : [];
    const stamps = Array.isArray(src?.recentAt) ? src.recentAt : [];
    recent.forEach((raw, i) => {
      const { level, text } = parseLine(scrub(String(raw)), name);
      if (q && !text.toLowerCase().includes(q)) return;
      const at = Number.isFinite(stamps[i]) ? stamps[i] : null;
      rows.push({ at, source: name, level, text, seq: seq++ });
    });
  }
  // merge by time where we have it; stable by arrival (seq) otherwise
  rows.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.seq - b.seq);
  return rows.slice(-tail);
}

const pad = (n) => String(n).padStart(2, '0');
export function clock(at) {
  if (at == null) return '        ';
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function main(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--json'],
    value: ['--source', '--tail', '--grep', '--root'],
  });
  if (pos.length) throw new UsageError('logs takes no operand');
  const source = flags['--source'] ?? 'all';
  if (source !== 'all' && !SOURCES.includes(source))
    throw new UsageError(`--source is one of all, ${SOURCES.join(', ')}`);
  let tail = DEFAULT_TAIL;
  if (flags['--tail'] !== undefined) {
    tail = Number(flags['--tail']);
    if (!Number.isInteger(tail) || tail < 1 || tail > MAX_TAIL)
      throw new UsageError(`--tail is a whole number from 1 to ${MAX_TAIL}`);
  }
  const c = await connect('logs', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/diagnostics');
  if (r?.status !== 200 || !r.body?.sources) {
    process.stderr.write(
      `maude design logs: ${r ? `the studio refused (HTTP ${r.status})` : 'the studio did not answer'}\n`
    );
    return 1;
  }
  const rows = collect(r.body, { source, grep: flags['--grep'] ?? '', tail });
  if (flags['--json']) {
    process.stdout.write(
      `${JSON.stringify(untrustedJson({ retentionDays: r.body.retentionDays ?? 7, lines: rows.map(({ seq, ...x }) => x) }))}\n`
    );
    return 0;
  }
  if (rows.length === 0) {
    process.stdout.write('no lines\n');
    return 0;
  }
  writeUntrusted(
    rows
      .map(
        (l) =>
          `${clock(l.at)}  ${l.source.padEnd(6)} ${l.level === 'warn' || l.level === 'error' ? `${l.level}: ` : ''}${field(l.text)}`
      )
      .join('\n')
  );
  return 0;
}

if (import.meta.main) runVerb('logs', USAGE, main);
