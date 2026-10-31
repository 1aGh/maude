// r1-format-ds (Michal rc.1, item 1) — booted half of r1-parked-link-format.test.ts: a real studio on a
// format-1 project whose committed `linkedHub` was never linked on this Mac (gate-b-sec4 parks it), even
// though this Mac holds an OWNER sign-in for that hub. The dry run must name the parked state
// (`link-unconfirmed` → the callout's Connect), never "no sign-in". The same project unlinked converts.
// Needs http.ts to hand `ctx.unconfirmedHub` to the project-format route (`parkedHub`).

import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox | null = null;
let proc: Subprocess | null = null;
afterEach(async () => {
  if (proc) await killProc(proc);
  if (box) rmSync(box.root, { recursive: true, force: true });
  proc = null;
  box = null;
});

/** A format-1 project; `linked` names a hub nothing listens on (the app never binds it here). */
async function dryRun(linked: boolean) {
  box = makeSandbox();
  const hubUrl = `http://localhost:${nextPort()}`;
  const cfgPath = path.join(box.designRoot, 'config.json');
  const { formatVersion: _drop, ...cfg } = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(
    cfgPath,
    JSON.stringify(linked ? { ...cfg, linkedHub: { url: hubUrl, linkedAt: 1 } } : cfg)
  );
  writeFileSync(
    path.join(box.designRoot, 'ui', 'card.tsx'),
    'export default function C() { return null; }\n'
  );
  const cfgDir = path.join(box.root, 'cfg');
  mkdirSync(cfgDir, { recursive: true });
  const hubs = path.join(cfgDir, 'hubs.json');
  writeFileSync(hubs, JSON.stringify({ hubs: { [hubUrl]: { token: 'tok-test', role: 'owner' } } }));
  const port = nextPort();
  proc = await bootServer(box.root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    HUBS_CONFIG_PATH: hubs,
    MAUDE_PROJECT_LINKS_PATH: path.join(cfgDir, 'project-links.json'),
    MAUDE_CLOUD_CONFIG: path.join(cfgDir, 'cloud.json'),
    // gate-b-sec4: this Mac never made the link — no app binding, no record, no runtime evidence
    MAUDE_APP_BOUND_HUB: '',
  });
  const base = `http://localhost:${port}`;
  const res = await fetch(`${base}/_api/project/migrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ direction: 'forward' }),
  });
  return {
    status: res.status,
    body: (await res.json()) as { refusals: { code?: string }[]; project: { linked: unknown } },
  };
}

test('a parked link: the dry run says link-unconfirmed, not no-sign-in', async () => {
  const { status, body } = await dryRun(true);
  expect(status).toBe(409);
  expect(body.refusals.map((r) => r.code)).toEqual(['link-unconfirmed']);
}, 60_000);

test('the same project unlinked converts (no refusal)', async () => {
  const { status, body } = await dryRun(false);
  expect(status).toBe(200);
  expect(body.refusals).toEqual([]);
  expect(body.project.linked).toBe(null);
}, 60_000);
