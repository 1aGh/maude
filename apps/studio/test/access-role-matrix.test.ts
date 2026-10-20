// V2-4 gate (standing rule 12) — per-role server enforcement: owner · member · viewer (Can
// comment) · observer (Can view, S9.9 — per-capability since the local gate split). A role the
// studio does not know must hold no edit (V2-1.7 R1).
//
// One row per WRITE route family. The studio's local gate (`readOnlyRefusal`, http.ts) is binary —
// read-only or not — so owner and member get the same answer here; what only an owner may do
// (push to the mirror, invite, clear the trash, delete) is the hub's (apps/hub/test/
// studio-manifest.test.mjs "a member may edit but may not push", project-config-door.test.mjs,
// cell-ops.test.mjs "the export refuses everyone but the owner").
//
// Two doors decide the role, and both are exercised:
//   - the hub-linked desktop: the role the hub vouched, stored in hubs.json (isHubReadOnly);
//   - a cell child: the proxy's per-request `x-maude-readonly` vouch, read-only by default.
//
// The viewer's refused rows never reach a handler (the gate answers first), so they are safe to
// send with an empty body. An editor's rows DO reach handlers, so the editor list is the subset
// whose handler answers an empty body without side effects outside the sandbox (no network, no
// keychain, no Claude spawn, no project migration).

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';
const FIXTURE = '.design/ui/fixture.html';

type Viewer = 'refused' | 'allowed';
interface Row {
  family: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  viewer: Viewer;
  /** The handler is safe to run with this body in a sandbox: also sent as owner / member. */
  editor?: true;
}

const ROWS: Row[] = [
  // ── canvas file writes ──
  { family: 'canvas', method: 'POST', path: '/_api/edit-text', viewer: 'refused', editor: true },
  { family: 'canvas', method: 'POST', path: '/_api/canvas', viewer: 'refused', editor: true },
  { family: 'canvas', method: 'POST', path: '/_api/edit-css', viewer: 'refused', editor: true },
  // S2.1 — the edit-op dispatch (routes/edit.ts): minRole edit; an empty body is 400 invalid
  { family: 'canvas', method: 'POST', path: '/_api/edit-op', viewer: 'refused', editor: true },
  {
    family: 'canvas',
    method: 'POST',
    path: '/_api/insert-element',
    viewer: 'refused',
    editor: true,
  },
  {
    family: 'canvas',
    method: 'POST',
    path: '/_api/duplicate-artboard',
    viewer: 'refused',
    editor: true,
  },
  {
    family: 'canvas',
    method: 'POST',
    path: '/_api/delete-artboard',
    viewer: 'refused',
    editor: true,
  },
  {
    family: 'canvas',
    method: 'POST',
    path: '/_api/set-artboard-style',
    viewer: 'refused',
    editor: true,
  },
  { family: 'canvas', method: 'POST', path: '/_api/clip-edit', viewer: 'refused', editor: true },
  // S7.6c — a clip / video op through the dispatcher (hidden ≠ refused: the server says no)
  {
    family: 'canvas (clip op)',
    method: 'POST',
    path: '/_api/edit-op',
    body: {
      file: 'ui/fixture.tsx',
      op: 'clip.split',
      targets: [],
      params: { stableId: 'name:a', atFrame: 10 },
    },
    viewer: 'refused',
    editor: true,
  },
  // S7.9 — the three timeline gestures (trim / move, drag a beat, drop footage) are ops too: Can comment says no
  ...(
    [
      ['clip.retime', { stableId: 'name:a', durationInFrames: 30 }],
      ['clip.move', { stableId: 'name:a', refStableId: 'name:b', position: 'before' }],
      ['clip.insert', { lane: 'storyline', durationInFrames: 30 }],
    ] as const
  ).map(([op, params]) => ({
    family: 'canvas (clip gesture)',
    method: 'POST' as const,
    path: '/_api/edit-op',
    body: { file: 'ui/fixture.tsx', op, targets: [], params },
    viewer: 'refused' as const,
    editor: true,
  })),
  {
    family: 'canvas (video op)',
    method: 'POST',
    path: '/_api/edit-op',
    body: { file: 'ui/fixture.tsx', op: 'video.captions.add', targets: [], params: {} },
    viewer: 'refused',
    editor: true,
  },
  { family: 'canvas', method: 'POST', path: '/_api/fs-move', viewer: 'refused', editor: true },
  { family: 'canvas', method: 'POST', path: '/_api/fs-mkdir', viewer: 'refused', editor: true },
  // ── meta / layout ──
  {
    family: 'meta',
    method: 'PATCH',
    path: '/_api/canvas-meta',
    body: { file: FIXTURE, patch: { layout: { artboards: [] } } },
    viewer: 'refused',
    editor: true,
  },
  {
    family: 'meta (viewport lane — per-user camera)',
    method: 'PATCH',
    path: '/_api/canvas-meta',
    body: { file: FIXTURE, patch: { viewport: { x: 0, y: 0, zoom: 1 } } },
    viewer: 'allowed',
    editor: true,
  },
  // ── comments ── (create / resolve / delete ride the collab lane: collab-readonly-gate.test.ts)
  {
    family: 'comments',
    method: 'POST',
    path: '/_api/comments/c1/reply',
    viewer: 'allowed',
    editor: true,
  },
  {
    family: 'comments (not a reply)',
    method: 'POST',
    path: '/_api/comments/c1/delete',
    viewer: 'refused',
  },
  // ── annotations ──
  {
    family: 'annotations',
    method: 'PUT',
    path: '/_api/annotations',
    viewer: 'refused',
    editor: true,
  },
  {
    family: 'annotations',
    method: 'POST',
    path: '/_api/annotations/ops',
    viewer: 'refused',
    editor: true,
  },
  // S4.16 - Can comment: the op batches and the whole-board write above, the sticky <-> comment doors and the
  // FigJam import all answer 403 (hidden is not refused). The refusal comes before the body is read.
  {
    family: 'annotations (S4.16)',
    method: 'POST',
    path: '/_api/annotations/figjam',
    body: {
      file: '.design/ui/fixture.html',
      url: 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/x',
    },
    viewer: 'refused',
  },
  {
    family: 'annotations (S4.16)',
    method: 'POST',
    path: '/_api/annotations/to-comment',
    body: { file: '.design/ui/fixture.html', id: 'st-1' },
    viewer: 'refused',
  },
  // ── assets ──
  { family: 'assets', method: 'POST', path: '/_api/asset', viewer: 'refused', editor: true },
  {
    family: 'assets',
    method: 'POST',
    path: '/_api/asset/chunk-start',
    viewer: 'refused',
    editor: true,
  },
  { family: 'assets', method: 'POST', path: '/_api/import-asset', viewer: 'refused', editor: true },
  { family: 'assets', method: 'POST', path: '/_api/import-brand', viewer: 'refused' },
  { family: 'assets', method: 'POST', path: '/_api/photo-edit', viewer: 'refused', editor: true },
  // ── export (Can comment holds export, V2-1.7 §5.2) ──
  { family: 'export', method: 'POST', path: '/_api/export', viewer: 'allowed', editor: true },
  { family: 'export', method: 'POST', path: '/_api/export-jobs', viewer: 'allowed', editor: true },
  {
    family: 'export',
    method: 'POST',
    path: '/_api/export-history',
    viewer: 'allowed',
    editor: true,
  },
  {
    family: 'export',
    method: 'POST',
    path: '/_api/export-assemble',
    viewer: 'allowed',
    editor: true,
  },
  // ── git / version history ──
  { family: 'git', method: 'POST', path: '/_api/git/commit', viewer: 'refused', editor: true },
  { family: 'git', method: 'POST', path: '/_api/git/checkout', viewer: 'refused' },
  { family: 'git', method: 'POST', path: '/_api/git/pull', viewer: 'refused' },
  { family: 'git', method: 'POST', path: '/_api/git/branch', viewer: 'refused' },
  { family: 'git', method: 'POST', path: '/_api/git/discard', viewer: 'refused' },
  { family: 'git', method: 'POST', path: '/_api/git/fold', viewer: 'refused' },
  { family: 'git', method: 'POST', path: '/_api/git/resolve', viewer: 'refused' },
  { family: 'git', method: 'POST', path: '/_api/git/push', viewer: 'refused' },
  {
    family: 'git (fetch moves remote refs only)',
    method: 'POST',
    path: '/_api/git/fetch',
    viewer: 'allowed',
  },
  {
    family: 'history',
    method: 'POST',
    path: '/_api/project/restore',
    viewer: 'refused',
    editor: true,
  },
  {
    family: 'history',
    method: 'POST',
    path: '/_api/project/undo',
    viewer: 'refused',
    editor: true,
  },
  // ── AI runs (S5.11b: Run on a copy writes the canvas — a viewer / canvas-only session never) ──
  {
    family: 'ai',
    method: 'POST',
    path: '/_api/ai/runs/r_nosuchrun1/copy',
    viewer: 'refused',
    editor: true,
  },
  // ── sync ──
  { family: 'sync', method: 'POST', path: '/_api/sync/resync', viewer: 'refused' },
  { family: 'sync', method: 'POST', path: '/_api/diagnostics/disk-retry', viewer: 'refused' },
  { family: 'sync', method: 'POST', path: '/_api/sync/settings', viewer: 'refused' },
  { family: 'sync', method: 'POST', path: '/_api/sync/ownership', viewer: 'refused' },
  { family: 'sync', method: 'POST', path: '/_api/sync/cancel-assets', viewer: 'refused' },
  { family: 'sync', method: 'POST', path: '/_api/sync/offline', viewer: 'refused' },
  // ── settings / config ──
  { family: 'config', method: 'POST', path: '/_api/design/init', viewer: 'refused' },
  { family: 'config', method: 'POST', path: '/_api/project/migrate', viewer: 'refused' },
  { family: 'config', method: 'POST', path: '/_api/generate/prefs', viewer: 'refused' },
  {
    family: 'config (per-user)',
    method: 'POST',
    path: '/_api/ui-prefs',
    viewer: 'allowed',
    editor: true,
  },
  {
    family: 'config (per-user)',
    method: 'POST',
    path: '/_api/tree-state',
    viewer: 'allowed',
    editor: true,
  },
  {
    family: 'config (per-user camera)',
    method: 'POST',
    path: '/_canvas-state',
    body: { file: FIXTURE, viewport: { x: 1, y: 2, zoom: 1 } },
    viewer: 'allowed',
    editor: true,
  },
  // ── trash ── restore is an fs-move out of `_trash/` (canvas row above); clearing it out is S1's
  // `/_api/trash/clear` (owner only, not built yet). The per-Mac prune stays refused for a viewer.
  { family: 'trash', method: 'POST', path: '/_api/sync/trash', viewer: 'refused' },
];

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

/** A hub-linked desktop whose stored credential vouches `role`. */
async function bootLinked(role: string) {
  const { root, designRoot } = makeSandbox();
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), role } } })
  );
  const port = nextPort();
  const proc = await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath });
  procs.push(proc);
  return `http://localhost:${port}`;
}

/** A cell child: the proxy vouches the role per request (DDR-209). */
async function bootCell() {
  const { root } = makeSandbox();
  const port = nextPort();
  const proc = await bootServer(root, port, {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Alligators',
  });
  procs.push(proc);
  return `http://localhost:${port}`;
}

async function send(base: string, row: Row, headers: Record<string, string> = {}) {
  const r = await fetch(base + row.path, {
    method: row.method,
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify(row.body ?? {}),
  });
  let error: unknown = null;
  try {
    error = ((await r.json()) as { error?: unknown }).error ?? null;
  } catch {
    /* not JSON */
  }
  return { status: r.status, error };
}

const label = (row: Row) => `${row.family}: ${row.method} ${row.path}`;

/** Refused = the gate's own answer (403 read-only), never a handler's. */
const refused = (got: { status: number; error: unknown }) => `${got.status} ${got.error}`;
const REFUSED = '403 read-only';

/** `notServed`: routes a cell does not serve at all (404) — still no write; any other 404 stays red. */
async function expectViewer(
  base: string,
  headers?: Record<string, string>,
  notServed: ReadonlySet<string> = new Set()
) {
  const wrong: string[] = [];
  for (const row of ROWS) {
    const got = refused(await send(base, row, headers));
    const ok =
      row.viewer === 'refused'
        ? got === REFUSED || (notServed.has(row.path) && got.startsWith('404'))
        : got !== REFUSED;
    if (!ok) wrong.push(`${label(row)} → ${got} (viewer: ${row.viewer})`);
  }
  expect(wrong).toEqual([]);
}

async function expectEditor(base: string, headers?: Record<string, string>) {
  const wrong: string[] = [];
  for (const row of ROWS.filter((r) => r.editor)) {
    const got = refused(await send(base, row, headers));
    if (got === REFUSED) wrong.push(`${label(row)} → ${got}`);
  }
  expect(wrong).toEqual([]);
}

describe('hub-linked desktop — the role the hub vouched (hubs.json)', () => {
  test('viewer (Can comment): every project write is refused; comment, export and per-user state pass', async () => {
    const base = await bootLinked('viewer');
    expect(
      ((await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean }).readOnly
    ).toBe(true);
    await expectViewer(base);
  }, 60000);

  for (const role of ['member', 'owner']) {
    test(`${role}: no write family is refused by the role gate`, async () => {
      const base = await bootLinked(role);
      expect(
        ((await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean }).readOnly
      ).toBe(false);
      await expectEditor(base);
    }, 60000);
  }

  // V2-1.7 R1: an unknown role holds nothing. `observer` (Can view, S9) and any role a newer hub
  // names that this build does not know must not open the edit door (`role === 'viewer'` was the
  // only read-only answer, so every other string failed OPEN).
  for (const role of ['observer', 'guest', 'Viewer']) {
    test(`a role this build does not edit with (${role}) is read-only, not writable`, async () => {
      const base = await bootLinked(role);
      expect(
        ((await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean }).readOnly
      ).toBe(true);
      const got = await send(base, ROWS[0]);
      expect(refused(got)).toBe(REFUSED);
    }, 30000);
  }
});

describe('cell child — the proxy vouches the role per request', () => {
  test('viewer (no vouch): the same refusals and the same passes', async () => {
    const base = await bootCell();
    // A cell serves no desktop-only setup routes at all (workspace mode): a 404 there is still no write.
    await expectViewer(
      base,
      { 'x-maude-role': 'viewer' },
      // S11.17 — `/_api/diagnostics*` is pruned in a cell (workspace-mode FORBIDDEN_ROUTE_PREFIXES)
      new Set(['/_api/design/init', '/_api/generate/prefs', '/_api/diagnostics/disk-retry'])
    );
  }, 60000);
  // S9.9 — Can view (`observer`) arrives: the viewer's refusals PLUS comment and export
  // (V2-1.7 §5.2); its own place (camera, prefs, tree state, fetch, sign-in) still passes.
  test('observer (x-maude-access claim): comment + export refused too, session writes pass', async () => {
    const base = await bootCell();
    const headers = {
      'x-maude-role': 'observer',
      'x-maude-readonly': '1',
      'x-maude-access': Buffer.from(JSON.stringify({ v: 1, role: 'observer' })).toString(
        'base64url'
      ),
    };
    // `/_api/export` is the desktop's project export — a cell does not serve it to anyone.
    // S11.17 — `/_api/diagnostics*` is pruned in a cell (workspace-mode FORBIDDEN_ROUTE_PREFIXES)
    const notServed = new Set([
      '/_api/design/init',
      '/_api/generate/prefs',
      '/_api/export',
      '/_api/diagnostics/disk-retry',
    ]);
    const wrong: string[] = [];
    for (const row of ROWS) {
      const got = refused(await send(base, row, headers));
      const lane = row.family.startsWith('comments') || row.family === 'export';
      const want = row.viewer === 'refused' || lane ? 'refused' : 'allowed';
      const ok =
        want === 'refused'
          ? got === REFUSED || (notServed.has(row.path) && got.startsWith('404'))
          : got !== REFUSED;
      if (!ok) wrong.push(`${label(row)} → ${got} (observer: ${want})`);
    }
    expect(wrong).toEqual([]);
  }, 60000);
  test('owner / member (x-maude-readonly: 0): no write family is refused by the role gate', async () => {
    const base = await bootCell();
    for (const role of ['member', 'owner'])
      await expectEditor(base, { 'x-maude-role': role, 'x-maude-readonly': '0' });
  }, 60000);
});
