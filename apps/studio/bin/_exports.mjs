// Internal shim behind exports.sh (`maude design exports`). See USAGE.
//
// The Exports panel from a terminal (contract V2-1.11 §5.3, S8):
//   list            GET /_api/export-history — this session's recent exports (effect none)
//   again <id|i>    re-submit one entry through the SAME jobs path the Export sheet's
//                   "Export again" row uses: POST /_api/export-jobs with replayExportJob(entry)
//                   (exporters/replay.ts — the sheet's scope fallback), wait for the job, write
//                   the file inside the project (effect project). `--out` is confined like every
//                   verb's (cli/lib/confine-out.mjs) and the server's file name is reduced to a
//                   basename, so neither can put the file outside the project.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { outputViolation, violationMessage } from '../../../cli/lib/confine-out.mjs';
import { replayExportBody } from '../exporters/replay.ts';
import {
  call,
  clean,
  connect,
  field,
  parseWords,
  runVerb,
  UsageError,
  untrustedJson,
  writeUntrusted,
} from './_studio-verb.mjs';

export const USAGE = `usage: maude design exports list [--json] [--root <project>]
       maude design exports again <id | index> [--out <file|folder/>] [--no-wait] [--json] [--root <project>]
  list    recent exports, newest first (index 0 is the newest)
  again   export that entry again, exactly as the Export sheet's "Export again" does; waits for the
          job and writes the file to --out (default: the current folder). --no-wait only queues it.
Exit 0 ok · 1 not found / the export failed · 2 usage · 3 no studio running.
`;

const WAIT_MS = 15 * 60 * 1000;

async function history(studio) {
  const r = await call(studio, '/_api/export-history');
  if (r?.status !== 200) throw new Error('the studio did not answer the export history');
  return Array.isArray(r.body?.history) ? r.body.history : [];
}

async function list(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length) throw new UsageError('list takes no operand');
  const c = await connect('exports', flags['--root']);
  if (c.exit) return c.exit;
  const h = await history(c.studio);
  if (flags['--json']) {
    process.stdout.write(`${JSON.stringify(untrustedJson({ history: h }))}\n`);
    return 0;
  }
  if (h.length === 0) {
    process.stdout.write('no exports yet\n');
    return 0;
  }
  // the history can be a committed file from a cloned repo: every field is untrusted
  const when = (e) =>
    field(e.at ?? '')
      .replace('T', ' ')
      .slice(0, 16);
  const text = h
    .map(
      (e, i) =>
        `${i}  ${field(e.id ?? '-')}  ${when(e)}  ${field(e.format)}  ${field(e.scope)}  ${field(e.filename)}${e.status === 'failed' ? '  failed' : ''}${e.deliveredInBrowser ? '  (saved in the browser)' : ''}\n`
    )
    .join('');
  writeUntrusted(text);
  return 0;
}

async function again(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--json', '--no-wait'],
    value: ['--out', '--root'],
  });
  if (pos.length !== 1) throw new UsageError('again takes one <id | index>');
  // the dispatcher already confined --out; the helper checks again so a direct run can't skip it
  const outside = outputViolation(words);
  if (outside) {
    process.stderr.write(violationMessage('exports again', outside));
    return 2;
  }
  const c = await connect('exports', flags['--root']);
  if (c.exit) return c.exit;
  const h = await history(c.studio);
  const key = pos[0];
  const entry =
    h.find((e) => e?.id === key) ?? (/^\d{1,3}$/.test(key) ? h[Number(key)] : undefined);
  if (!entry) {
    process.stderr.write(
      `maude design exports again: no export ${clean(key)} — \`maude design exports list\` lists them\n`
    );
    return 1;
  }
  // S8.1 — a v2 row replays its stored spec ({v:2, spec}); a v1 row the v1 job, unchanged
  const job = replayExportBody(entry);
  const posted = await call(c.studio, '/_api/export-jobs', { method: 'POST', json: job });
  if (posted?.status !== 202 || !posted.body?.jobId) {
    process.stderr.write(
      `maude design exports again: the studio refused (${posted ? clean(posted.text).slice(0, 200) || posted.status : 'no answer'})\n`
    );
    return 1;
  }
  const jobId = String(posted.body.jobId);
  if (flags['--no-wait']) {
    process.stdout.write(
      flags['--json'] ? `${JSON.stringify(untrustedJson({ jobId, job }))}\n` : `→ queued ${jobId}\n`
    );
    return 0;
  }
  const done = await waitFor(c.studio, jobId);
  if (done?.status !== 'done') {
    process.stderr.write(
      `maude design exports again: ${done ? `the export failed — ${clean(done.error ?? 'no reason given')}` : 'timed out waiting for the export'}\n`
    );
    return 1;
  }
  const dl = await fetchBytes(c.studio, jobId);
  if (!dl) {
    process.stderr.write('maude design exports again: could not download the finished export\n');
    return 1;
  }
  const name =
    basename(String(done.filename ?? ''))
      .replace(/[^A-Za-z0-9._-]/g, '')
      .replace(/^\.+/, '') || `export.${job.format || 'bin'}`;
  const target = outPath(flags['--out'], name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, dl);
  process.stdout.write(
    flags['--json']
      ? `${JSON.stringify(untrustedJson({ jobId, job, path: target }))}\n`
      : `→ ${target}\n`
  );
  return 0;
}

function outPath(out, name) {
  if (!out) return resolve(process.cwd(), name);
  const abs = resolve(process.cwd(), out);
  const isDir = out.endsWith('/') || (existsSync(abs) && statSync(abs).isDirectory());
  return isDir ? join(abs, name) : abs;
}

async function waitFor(studio, jobId) {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const r = await call(studio, '/_api/export-jobs');
    const job = (r?.body?.jobs ?? []).find((j) => j?.id === jobId);
    if (job && (job.status === 'done' || job.status === 'failed')) return job;
    await new Promise((res) => setTimeout(res, 400));
  }
  return null;
}

async function fetchBytes(studio, jobId) {
  try {
    const res = await fetch(
      `${studio.base}/_api/export-jobs/download?${new URLSearchParams({ id: jobId })}`,
      { signal: AbortSignal.timeout(60_000) }
    );
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const SUBS = { list, again };

if (import.meta.main) {
  runVerb('exports', USAGE, async (words) => {
    const sub = words[0];
    if (!sub || !Object.hasOwn(SUBS, sub))
      throw new UsageError(sub ? `unknown sub-verb ${sub}` : 'name a sub-verb');
    return SUBS[sub](words.slice(1));
  });
}
