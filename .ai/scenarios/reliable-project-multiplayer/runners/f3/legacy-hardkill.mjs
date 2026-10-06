#!/usr/bin/env node
// Legacy documents across a HARD kill (followup-multiplayer-hardening G3b).
//
// A legacy self-host hub with object storage and a short backup interval: one
// canvas is written and a backup generation covers it; then that canvas is
// edited and a second one is written — after the generation — and the hub is
// killed without SIGTERM and both of its disks replaced (`selfhost.mjs
// wipe-disk`: the container is removed, the wake rehydrates from object
// storage). Oracle: both canvases, with the late edit, are there after the
// wake, read through a fresh socket — the generation alone holds neither.
//
//   node legacy-hardkill.mjs --work <selfhost dir, legacy, MAUDE_BACKUP_INTERVAL_MS set> --out <file>
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasSource } from './backend.mjs';
import { hostS3Config } from './s3-fixture.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const arg = (k) => argv[argv.indexOf(`--${k}`) + 1];
const work = arg('work');
const out = arg('out');
const fx = () => JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const require = createRequire(join(REPO, 'apps/hub/package.json'));
const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const { listObjects } = await import(join(REPO, 'apps/hub/src/s3.mjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(500);
  }
};

const docName = async (slug) => {
  // The wire name the hub uses (a workspace hub namespaces documents).
  const r = await fetch(`${fx().url}/api/documents`, { headers: { authorization: `Bearer ${fx().operatorSecret}` } });
  const names = ((await r.json()).documents ?? []).map((d) => d.name);
  const prefix = names.find((n) => n.includes('/'))?.replace(/[^/]*$/, '') ?? '';
  return `${prefix}${slug}`;
};
const socket = (name) => {
  const d = new Y.Doc();
  const p = new HocuspocusProvider({ url: fx().url.replace(/^http/, 'ws'), name, token: fx().sessions.a.token, document: d });
  return { d, p };
};
const write = async (name, text, path) => {
  const s = socket(name);
  await until(() => s.p.synced, 30000, `${name} synced`);
  s.d.transact(() => {
    const t = s.d.getText('html');
    t.delete(0, t.length);
    t.insert(0, text);
    if (path) s.d.getMap('syncMeta').set('path', path);
  });
  await sleep(1500);
  s.p.destroy();
};
const read = async (name) => {
  const s = socket(name);
  await until(() => s.p.synced, 60000, `${name} synced after the wake`);
  const text = s.d.getText('html').toString();
  s.p.destroy();
  return text;
};
const generations = async () => {
  const cfg = await hostS3Config();
  return [...new Set((await listObjects(cfg, `${fx().tenant}/backups/`)).map((o) => o.key.split('/').slice(0, -1).join('/')))].filter((k) =>
    /backups\/\d/.test(k)
  );
};

const tag = Math.random().toString(16).slice(2, 8);
const A = await docName(`ui-f3hardkilla${tag}`);
const B = await docName(`ui-f3hardkillb${tag}`);
const aV1 = canvasSource(`F3HardKillA${tag}`, 'In the generation');
const aV2 = canvasSource(`F3HardKillA${tag}`, 'Edited after the generation');
const bV1 = canvasSource(`F3HardKillB${tag}`, 'Born after the generation');
const report = { tag };

await write(A, aV1, `ui/F3HardKillA${tag}.tsx`);
const before = (await generations()).length;
await until(async () => (await generations()).length > before, 180000, 'a backup generation after the first canvas');
report.generationCoversA = true;
await sleep(2000);
await write(A, aV2);
await write(B, bV1, `ui/F3HardKillB${tag}.tsx`);
// The store's debounce (2 s) and the write-behind: then kill without SIGTERM.
await sleep(5000);
const genBeforeKill = (await generations()).length;
execFileSync('node', [join(HERE, 'selfhost.mjs'), 'wipe-disk', '--work', work], { stdio: 'ignore', timeout: 600000 });
report.noGenerationBetween = (await generations()).length === genBeforeKill;
// The entrypoint and the hub write to both streams.
const logs = execFileSync('sh', ['-c', `docker logs ${fx().container} 2>&1`], { encoding: 'utf8' });
report.replayLine = logs.split('\n').find((l) => l.includes('[docs-tail] replayed')) ?? null;
report.after = { a: await read(A), b: await read(B) };
report.checks = {
  lateEditKept: report.after.a === aV2,
  lateCanvasKept: report.after.b === bV1,
  replayed: /replayed [1-9]/.test(report.replayLine ?? ''),
};
report.status = Object.values(report.checks).every(Boolean) ? 'pass' : 'fail';
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exitCode = report.status === 'pass' ? 0 : 1;
