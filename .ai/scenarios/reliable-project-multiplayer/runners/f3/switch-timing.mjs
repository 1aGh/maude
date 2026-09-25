#!/usr/bin/env node
// The legacy → accepted switch on a cloud-shaped hub, timed (G1/G2 of
// followup-multiplayer-hardening).
//
// The self-host fixture's hub runs against scripts/dev/local-project-store.mjs
// (the cloud's ProjectStore host over HTTP, with per-call latency) — the shape
// of a cell: the hub in a container, its store a round trip away. A desktop
// adds this repo's canvases in legacy mode; the owner previews and switches;
// the report says how long the answer took, how many store calls the switch
// made, and whether the import finished.
//
//   node switch-timing.mjs --work <selfhost dir, legacy, remote store> --scratch <dir>
//        --stats <store /stats url> --out <file> [--canvases 76]
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './backend.mjs';
import { startDesktop, until } from './desktop.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const work = arg('work');
const scratch = arg('scratch');
const statsUrl = arg('stats');
const out = arg('out');
mkdirSync(scratch, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const B = await loadBackend('selfhost', { work });
const mode = async () => (await B.api('owner', 'mode', undefined, { timeout: 30000 })).body;
const calls = async () => (await (await fetch(statsUrl)).json()).calls;
const report = { startedAt: new Date().toISOString() };

// A desktop with this repository's canvases (ui/ and system/), in legacy mode.
const root = join(scratch, `desktop-${Date.now()}`);
mkdirSync(join(root, '.design'), { recursive: true });
for (const d of ['ui', 'system']) cpSync(join(REPO, '.design', d), join(root, '.design', d), { recursive: true });
const A = await startDesktop({
  root,
  port: fx.port + 150,
  hubUrl: fx.url,
  token: fx.sessions.a.token,
  role: fx.sessions.a.role,
  name: 'switch-timing',
});
const local = [];
const walk = (d, rel = '') => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(join(d, e.name), r);
    else if (r.endsWith('.tsx')) local.push(r);
  }
};
walk(join(root, '.design'));
report.localCanvases = local.length;
try {
  const docsOnHub = async () => {
    const r = await fetch(`${fx.url}/api/documents`, { headers: { authorization: `Bearer ${fx.operatorSecret}` } });
    return ((await r.json()).documents ?? []).filter((d) => d.bytes > 0).length;
  };
  report.legacyDocsOnHub = await until(async () => {
    const n = await docsOnHub();
    return n >= local.length ? n : null;
  }, 'the canvases in the hub (legacy)', 600000, 2000).catch(async () => docsOnHub());

  const m0 = await mode();
  report.before = m0;
  let c0 = await calls();
  let t0 = Date.now();
  const dry = await B.api('owner', 'mode', { mode: 'transactions', dryRun: true }, { timeout: 600000 });
  report.dryRun = { status: dry.status, ms: Date.now() - t0, storeCalls: (await calls()) - c0, created: dry.body?.imported?.created ?? null, blockers: dry.body?.blockers ?? null };

  c0 = await calls();
  t0 = Date.now();
  const sw = await B.api('owner', 'mode', { mode: 'transactions', expectEpoch: m0.epoch }, { timeout: 600000 }).catch((e) => ({ status: 0, body: { error: String(e) } }));
  report.switch = {
    status: sw.status,
    answeredMs: Date.now() - t0,
    storeCalls: (await calls()) - c0,
    importPending: sw.body?.importPending ?? null,
    created: sw.body?.imported?.created ?? null,
    updated: sw.body?.imported?.updated ?? null,
  };
  const done = await until(async () => {
    const m = await mode().catch(() => null);
    return m && m.mode === 'transactions' && !m.importPending ? m : null;
  }, 'the import to finish', 600000, 2000).catch(() => null);
  report.importFinished = done ? { afterMs: Date.now() - t0, revision: done.revision } : false;
  report.parity = (await B.api('owner', 'parity', undefined, { timeout: 120000 })).body;
} finally {
  await A.stop();
}
report.status =
  report.switch?.status === 200 && report.importFinished && report.parity?.ok === true ? 'pass' : 'fail';
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exitCode = report.status === 'pass' ? 0 : 1;
