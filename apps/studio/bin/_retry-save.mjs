// Internal shim behind retry-save.sh (`maude design retry-save`).
//
// Retry on the "Not saved — this Mac is out of space" status (S11.17): the canvas writes a full disk
// held try to land now (POST /_api/diagnostics/disk-retry → { landed, held, full }). They also land by
// themselves once there is room; an agent frees space first, then retries (fix-bulk 2026-11-10
// follow-up). An agent's own writes go straight to the files and are never held here.
//
// Why a verb and not `curl-local`: since 2.1.0 the studio's main origin needs its key from every caller
// (contract sec-loopback-bearer §7). `curl-local` sends none, by design; this finds the studio and its
// key the way every verb does (studio-locate.mjs).

import { call, clean, connect, parseWords, runVerb, UsageError } from './_studio-verb.mjs';

export const USAGE = `usage: maude design retry-save [--json] [--root <project>]
  The saves this Mac held because its disk was full try to land now, as Retry on the "Not saved"
  status does. Free some space first; they also land by themselves once there is room.
Exit 0 nothing is held any more · 1 some are still held / the studio refused · 2 usage · 3 no studio running.
`;

async function main(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length) throw new UsageError('retry-save takes no operand');
  const c = await connect('retry-save', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/diagnostics/disk-retry', { method: 'POST' });
  const b = r?.body ?? {};
  if (r?.status !== 200 || !Number.isFinite(b.held)) {
    const why = clean(
      b.reason ?? b.error ?? (r ? r.text?.trim() || `HTTP ${r.status}` : 'no answer')
    );
    process.stderr.write(`maude design retry-save: refused — ${why}\n`);
    return 1;
  }
  const out = { landed: Number(b.landed) || 0, held: b.held, full: b.held > 0 };
  if (flags['--json']) process.stdout.write(`${JSON.stringify(out)}\n`);
  else if (out.held === 0)
    process.stdout.write(
      out.landed
        ? `→ ${out.landed} held saves landed\n`
        : '→ nothing was held — every save is on disk\n'
    );
  else
    process.stdout.write(
      `· ${out.landed} landed, ${out.held} still held — the disk is still full; free some space and retry\n`
    );
  return out.held === 0 ? 0 : 1;
}

if (import.meta.main) runVerb('retry-save', USAGE, main);
