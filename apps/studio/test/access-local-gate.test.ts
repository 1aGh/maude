// S9.9 — the studio's local gate per role (V2-1.7 §5.7, A19 studio half; Phase 4 security D3 / D5).
//
// `x-maude-access` is read PER REQUEST in a cell child, so one boot serves every role here:
//   - observer (Can view): every COMMENT and EXPORT write → 403; SESSION writes pass;
//   - viewer (Can comment): comment + export pass, every edit / annotate write → 403;
//   - member / owner: nothing refused by the role gate;
//   - canvas-only member on A: A's edits pass, B → 403 `not-in-scope` with the SAME body a
//     missing file gets (no existence oracle), on reads too.
// Every `_role-refusals.ts` row is sent as every role it names (V2-1.11 rule 7, non-vacuous).
// Plus the desktop half: a hubs.json record without a role is read-only (D3), and the
// `/_api/canvas-meta` lanes: a non-lane key from a read-only session, and any key canvas-lib
// does not send from the canvas origin, are refused; a canvas-origin drag (`layout`) by an
// editor still lands.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { writeCapability } from '../access/request.ts';
import type { AccessClaim } from '../access/scope.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { ROLE_REFUSALS } from './_role-refusals.ts';

const WIRE = { view: 'observer', comment: 'viewer', edit: 'member', owner: 'owner' } as const;
const CANVAS_A = '.design/ui/a.tsx';
const CANVAS_B = '.design/ui/b.tsx';
const SRC = 'export default function C() { return <div>c</div>; }\n';

const claimHeader = (claim: AccessClaim) => ({
  'x-maude-access': Buffer.from(JSON.stringify(claim)).toString('base64url'),
});
const asRole = (role: string) => ({
  ...claimHeader({ v: 1, role } as AccessClaim),
  'x-maude-role': role,
  'x-maude-readonly': role === 'member' || role === 'owner' ? '0' : '1',
});
const CANVAS_ONLY_A = {
  ...claimHeader({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] }),
  'x-maude-readonly': '1',
};

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

let cell = '';
let cellDesign = '';
beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), SRC);
  writeFileSync(join(designRoot, 'ui', 'b.tsx'), SRC);
  const port = nextPort();
  procs.push(
    await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Alligators',
    })
  );
  cell = `http://localhost:${port}`;
  cellDesign = designRoot;
}, 60000);

async function send(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: unknown = {}
) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let error: unknown = null;
  try {
    error = (JSON.parse(text) as { error?: unknown }).error ?? null;
  } catch {
    /* not JSON */
  }
  return { status: r.status, error, text, line: `${r.status} ${error}` };
}

const REFUSED = '403 read-only';

describe('the write classes (access/request.ts writeCapability)', () => {
  test('session · comment · export · annotate · delete · edit, and the AI chat is always edit', () => {
    const got = Object.fromEntries(
      [
        '/_canvas-state',
        '/_api/ui-prefs',
        '/_api/git/fetch',
        '/_comments',
        '/_api/comments/c1/reply',
        '/_api/export-jobs',
        '/_api/export-history',
        '/_api/annotations/ops',
        '/_api/trash/clear',
        '/_api/edit-text',
        '/_api/git/pull',
        '/_api/acp/chats/trash',
        '/_api/a-route-nobody-classified',
      ].map((p) => [p, writeCapability(p)])
    );
    expect(got).toEqual({
      '/_canvas-state': 'session',
      '/_api/ui-prefs': 'session',
      '/_api/git/fetch': 'session',
      '/_comments': 'comment',
      '/_api/comments/c1/reply': 'comment',
      '/_api/export-jobs': 'export',
      '/_api/export-history': 'export',
      '/_api/annotations/ops': 'annotate',
      '/_api/trash/clear': 'delete',
      '/_api/edit-text': 'edit',
      '/_api/git/pull': 'edit',
      '/_api/acp/chats/trash': 'edit',
      '/_api/a-route-nobody-classified': 'edit',
    });
  });
});

describe('cell child — x-maude-access read per request', () => {
  test('observer (Can view): comment + export refused, session writes pass (D5)', async () => {
    const h = asRole('observer');
    const lines = {
      comment: (await send(cell, 'POST', '/_comments', h)).line,
      reply: (await send(cell, 'POST', '/_api/comments/c1/reply', h)).line,
      export: (await send(cell, 'POST', '/_api/export-jobs', h)).line,
      exportHistory: (await send(cell, 'POST', '/_api/export-history', h)).line,
    };
    expect(lines).toEqual({
      comment: REFUSED,
      reply: REFUSED,
      export: REFUSED,
      exportHistory: REFUSED,
    });
    for (const p of ['/_api/ui-prefs', '/_api/tree-state'])
      expect([p, (await send(cell, 'POST', p, h)).line]).not.toEqual([p, REFUSED]);
    const camera = await send(cell, 'PATCH', '/_api/canvas-meta', h, {
      file: CANVAS_A,
      patch: { viewport: { x: 1, y: 2, zoom: 1 } },
    });
    expect(camera.line).not.toBe(REFUSED);
  }, 60000);

  test('viewer (Can comment): comment + export pass; edit and annotate refused', async () => {
    const h = asRole('viewer');
    for (const p of ['/_comments', '/_api/export-jobs', '/_api/export-history'])
      expect([p, (await send(cell, 'POST', p, h)).line]).not.toEqual([p, REFUSED]);
    for (const p of ['/_api/edit-text', '/_api/annotations/ops'])
      expect([p, (await send(cell, 'POST', p, h)).line]).toEqual([p, REFUSED]);
  }, 60000);

  test('member / owner: no class refused by the role gate', async () => {
    for (const role of ['member', 'owner'])
      for (const p of [
        '/_comments',
        '/_api/export-jobs',
        '/_api/annotations/ops',
        '/_api/edit-text',
      ])
        expect([role, p, (await send(cell, 'POST', p, asRole(role))).line]).not.toEqual([
          role,
          p,
          REFUSED,
        ]);
  }, 60000);

  test('canvas-only member: A passes, B is not-in-scope exactly like a missing file', async () => {
    const editA = await send(cell, 'POST', '/_api/edit-text', CANVAS_ONLY_A, { file: CANVAS_A });
    expect(editA.status).not.toBe(403);
    const layoutA = await send(cell, 'PATCH', '/_api/canvas-meta', CANVAS_ONLY_A, {
      file: CANVAS_A,
      patch: { layout: { artboards: [] } },
    });
    expect(layoutA.status).toBe(200);
    const editB = await send(cell, 'POST', '/_api/edit-text', CANVAS_ONLY_A, { file: CANVAS_B });
    const missing = await send(cell, 'POST', '/_api/edit-text', CANVAS_ONLY_A, {
      file: '.design/ui/nope.tsx',
    });
    expect(editB.line).toBe('403 not-in-scope');
    expect(editB.text).toBe(missing.text);
    const readB = await send(
      cell,
      'GET',
      `/_api/canvas-meta?file=${encodeURIComponent(CANVAS_B)}`,
      CANVAS_ONLY_A
    );
    const readMissing = await send(
      cell,
      'GET',
      `/_api/canvas-meta?file=${encodeURIComponent('.design/ui/nope.tsx')}`,
      CANVAS_ONLY_A
    );
    expect(readB.line).toBe('403 not-in-scope');
    expect(readB.text).toBe(readMissing.text);
    const readA = await send(
      cell,
      'GET',
      `/_api/canvas-meta?file=${encodeURIComponent(CANVAS_A)}`,
      CANVAS_ONLY_A
    );
    expect(readA.status).toBe(200);
    // A project-level write with no target is not the grant's: refused.
    expect((await send(cell, 'POST', '/_api/git/commit', CANVAS_ONLY_A)).line).toBe(REFUSED);
  }, 60000);

  test('canvas-meta: a session without edit may send only the per-user lanes', async () => {
    const h = asRole('viewer');
    for (const patch of [{ title: 'x' }, { viewport: { x: 0, y: 0, zoom: 1 }, present: {} }]) {
      const got = await send(cell, 'PATCH', '/_api/canvas-meta', h, { file: CANVAS_A, patch });
      expect([JSON.stringify(patch), got.line]).toEqual([JSON.stringify(patch), REFUSED]);
    }
    const lanes = await send(cell, 'PATCH', '/_api/canvas-meta', h, {
      file: CANVAS_A,
      patch: { viewport: { x: 0, y: 0, zoom: 1 }, overlays: {}, locked: [] },
    });
    expect(lanes.status).toBe(200);
  }, 60000);

  test('canvas origin: only the keys canvas-lib sends; an editor drag still lands', async () => {
    const info = JSON.parse(readFileSync(join(cellDesign, '_server.json'), 'utf8'));
    const canvas = String(info.canvasOrigin);
    expect(canvas.startsWith('http')).toBe(true);
    const h = asRole('owner');
    for (const patch of [
      { overlays: {} },
      { locked: [] },
      { layout: { artboards: [] }, title: 'x' },
    ]) {
      const got = await send(canvas, 'PATCH', '/_api/canvas-meta', h, { file: CANVAS_A, patch });
      expect([JSON.stringify(patch), got.line]).toEqual([JSON.stringify(patch), REFUSED]);
    }
    const drag = await send(canvas, 'PATCH', '/_api/canvas-meta', h, {
      file: CANVAS_A,
      patch: { layout: { artboards: [{ id: 'a1', x: 10, y: 20 }] } },
    });
    expect(drag.status).toBe(200);
    const camera = await send(canvas, 'PATCH', '/_api/canvas-meta', asRole('viewer'), {
      file: CANVAS_A,
      patch: { viewport: { x: 0, y: 0, zoom: 1 } },
    });
    expect(camera.status).toBe(200);
  }, 60000);
});

describe('hub-linked desktop — the stored record (D3)', () => {
  const HUB_URL = 'http://hub.invalid:9';
  async function bootLinked(record: Record<string, unknown>) {
    const { root, designRoot } = makeSandbox();
    const cfgPath = join(designRoot, 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const hubsPath = join(root, 'hubs.json');
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), ...record } } })
    );
    const port = nextPort();
    procs.push(await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath }));
    return `http://localhost:${port}`;
  }

  // On desktops: a cell does not serve every row's route (desktop-only routes 404 there for
  // everyone), and the stored role is what a hub-linked desktop is gated on.
  test('every _role-refusals row refuses every role it names', async () => {
    expect(ROLE_REFUSALS.length).toBeGreaterThan(0);
    const roles = [...new Set(ROLE_REFUSALS.flatMap((r) => r.refused))];
    const bases = Object.fromEntries(
      await Promise.all(roles.map(async (r) => [r, await bootLinked({ role: WIRE[r] })] as const))
    );
    const wrong: string[] = [];
    for (const row of ROLE_REFUSALS)
      for (const role of row.refused) {
        const got = await send(bases[role] as string, row.method, row.route, {}, row.body ?? {});
        if (got.line !== REFUSED) wrong.push(`${row.method} ${row.route} as ${role} → ${got.line}`);
      }
    expect(wrong).toEqual([]);
  }, 90000);

  test('a record without a role is read-only until a sign-in heals it', async () => {
    const base = await bootLinked({});
    expect(
      ((await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean }).readOnly
    ).toBe(true);
    expect((await send(base, 'POST', '/_api/edit-text', {})).line).toBe(REFUSED);
  }, 60000);

  test('a stored observer may not comment (D5); its v2 claim beats the v1 projection', async () => {
    const base = await bootLinked({ role: 'viewer', access: { v: 1, role: 'observer' } });
    expect((await send(base, 'POST', '/_comments', {})).line).toBe(REFUSED);
    expect((await send(base, 'POST', '/_api/export-jobs', {})).line).toBe(REFUSED);
    expect((await send(base, 'POST', '/_api/ui-prefs', {})).line).not.toBe(REFUSED);
  }, 60000);
});
