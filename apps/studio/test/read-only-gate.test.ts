// Cloud Phase 25 C2 — the local half of the read-only gate.
//
// When the linked hub's credential carries the `viewer` role (vouched at
// workspace sign-in, stored in hubs.json), the LOCAL dev-server refuses
// project-mutating writes with a legible 403 — so a viewer's clone can never
// silently diverge from the cell (which refuses the same writes at sync,
// Phase 25 C1). Writes are default-denied with a short allowlist
// (READ_ONLY_ALLOWED_WRITES in http.ts): per-user runtime state (camera,
// ui-prefs) plus the two role-granted verbs the cell itself allows (export,
// session management).

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';

/** Sandbox linked to a hub whose credential vouches `role`. */
function makeLinkedSandbox(role?: string) {
  const { root, designRoot } = makeSandbox();
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  // The hubs.json credential store the role is read from (isHubReadOnly).
  const hubsPath = join(root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({
      hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), ...(role ? { role } : {}) } },
    })
  );
  return { root, designRoot, hubsPath };
}

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function boot(role?: string) {
  const { root, hubsPath } = makeLinkedSandbox(role);
  const port = nextPort();
  const proc = await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath });
  procs.push(proc);
  return { base: `http://localhost:${port}` };
}

describe('read-only gate — viewer role refuses project writes locally', () => {
  test('viewer: writes 403 read-only, per-user + role-granted writes pass, /_config says so', async () => {
    const { base } = await boot('viewer');

    // /_config tells the client at boot.
    const cfg = (await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean };
    expect(cfg.readOnly).toBe(true);

    // Project-mutating writes: refused with the legible read-only shape.
    const editText = await fetch(`${base}/_api/edit-text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'ui/fixture.html', text: 'x' }),
    });
    expect(editText.status).toBe(403);
    const body = (await editText.json()) as { error?: string; message?: string };
    expect(body.error).toBe('read-only');
    expect(body.message).toContain('viewer');

    // Canvas create + delete-element + git commit: same refusal.
    for (const [path, method] of [
      ['/_api/canvas', 'POST'],
      ['/_api/delete-element', 'POST'],
      ['/_api/git/commit', 'POST'],
      ['/_api/fs-mkdir', 'POST'],
      ['/_api/annotations', 'PUT'],
      ['/_api/acp/chat', 'POST'],
      // Cloud Phase 27 D2 — both USED to be on READ_ONLY_ALLOWED_WRITES, on the
      // reasoning that "viewing another branch is not changing one". Both
      // rewrite the working TREE, and the tree is shared: a viewer switching
      // branches replaces the files under whoever is mid-edit. The cell's proxy
      // refuses them too, but this is the gate the hub-linked desktop and the
      // self-host path consult, where no manifest runs at all.
      ['/_api/git/checkout', 'POST'],
      ['/_api/git/pull', 'POST'],
    ] as const) {
      const r = await fetch(base + path, { method, body: '{}' });
      expect(`${path} ${r.status}`).toBe(`${path} 403`);
    }

    // canvas-meta: the LAYOUT lane is refused…
    const layout = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: '.design/ui/fixture.html',
        patch: { layout: { artboards: [] } },
      }),
    });
    expect(layout.status).toBe(403);
    // …the VIEWPORT lane (per-user camera) is not.
    const viewport = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: '.design/ui/fixture.html',
        patch: { viewport: { x: 0, y: 0, zoom: 1 } },
      }),
    });
    expect(viewport.status).not.toBe(403);

    // Per-user runtime state stays writable (DDR-115 taxonomy).
    const camera = await fetch(`${base}/_canvas-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: '.design/ui/fixture.html', viewport: { x: 1, y: 2, zoom: 1 } }),
    });
    expect(camera.status).toBe(204);

    // Role-granted verb: export reaches its handler (may 400 on shape, never 403).
    const exp = await fetch(`${base}/_api/export`, { method: 'POST', body: '{}' });
    expect(exp.status).not.toBe(403);

    // Reads are untouched.
    expect((await fetch(`${base}/_index-data`)).status).toBe(200);
    expect((await fetch(`${base}/_comments-all`)).status).toBe(200);
  }, 30000);

  // S9.9 / Phase 4 security D3 — this USED to be "no role = member, writes NOT gated": a
  // credential whose role nobody ever learned counted as writable. It is now the floor
  // (read-only) until a sign-in stores the role (test/sync-access-v1-compat.test.ts).
  test('no role on the credential: read-only until a sign-in heals it (D3)', async () => {
    const { base } = await boot(undefined);
    const cfg = (await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean };
    expect(cfg.readOnly).toBe(true);
    const r = await fetch(`${base}/_api/edit-text`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(403);
  }, 30000);

  test('member on the credential: writes are NOT gated', async () => {
    const { base } = await boot('member');
    const cfg = (await (await fetch(`${base}/_config`)).json()) as { readOnly?: boolean };
    expect(cfg.readOnly).toBe(false);
    // A write reaches its handler (400 on bad shape — not the 403 refusal).
    const r = await fetch(`${base}/_api/edit-text`, { method: 'POST', body: '{}' });
    expect(r.status).not.toBe(403);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Cloud Phase 27 — the one write a viewer holds.
//
// The role matrix has said `viewer.comment === true` since Phase 25 C4 and the
// People page promises it in those words. This list did not have it, so a
// viewer's comment was allowed by the authority (the cell's proxy) and then
// refused by the defence-in-depth layer behind it. Found by commenting as a
// viewer against a real cell, not by reading either file.

describe('a viewer may comment — the matrix says so, and so must this gate', () => {
  test('comment + reply pass; annotate still does not', async () => {
    const { base } = await boot('viewer');

    const comment = await fetch(`${base}/_comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'ui/Sample.tsx', text: 'looks off to me' }),
    });
    expect(comment.status).not.toBe(403);

    const reply = await fetch(`${base}/_api/comments/abc123/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'agreed' }),
    });
    expect(reply.status).not.toBe(403);

    // An annotation is drawn ON the design and versioned with it — the matrix
    // files it with `edit`, and that distinction has to survive this change.
    const annotate = await fetch(`${base}/_api/annotations`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'ui/Sample.tsx', svg: '<svg/>' }),
    });
    expect(annotate.status).toBe(403);
  });

  test('the reply pattern does not open the whole comment namespace', async () => {
    const { base } = await boot('viewer');
    for (const path of [
      '/_api/comments/abc/delete',
      '/_api/comments/abc/reply/../../edit-text',
      '/_api/comments//reply',
    ]) {
      const res = await fetch(`${base}${path}`, { method: 'POST' });
      expect(res.status).not.toBe(200);
    }
  });
});
