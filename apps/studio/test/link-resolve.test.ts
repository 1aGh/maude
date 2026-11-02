// S1.18 — a stable canvas link names the kernel entry (S1 Q6), so it survives a move and a rename;
// a trashed canvas answers `trashed` (the shell opens the Trash); anything else — never here, cleared,
// or not this canvas-only session's to see — is the same `unknown` (no existence oracle).
//
// The oracle is a REAL local home (S5.1: in-process kernel over bun:sqlite in a temp project) behind the
// real route handler — not a fake store.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { type LinkDoc, resolveEntry } from '../history/links.ts';
import { createLinksRoutes } from '../routes/links.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const tsx = (text: string) => `export default () => <p>${text}</p>;\n`;
const quiet = { warn() {}, error() {} };

async function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-link-resolve-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const file = (rel: string) => path.join(designRoot, rel);
  for (const rel of ['ui/Pozvanka.tsx', 'ui/Plakat.tsx']) {
    mkdirSync(path.dirname(file(rel)), { recursive: true });
    writeFileSync(file(rel), tsx(rel));
  }
  const home = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_link_mac', name: 'Link Mac' },
    bootId: 'boot-link',
    lockRetryMs: 0,
    settleMs: 5,
    log: quiet,
  });
  homes.push(home);
  await home.ready();
  let scope: ReturnType<typeof resolveAccess> | null = null;
  const [spec] = createLinksRoutes({
    control: () => home.runtime,
    designRel: '.design',
    scope: () => scope,
  });
  const ask = async (q: string) => {
    const res = await (spec as NonNullable<typeof spec>).handle(
      new Request(`http://127.0.0.1/_api/link/resolve?${q}`),
      {}
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const entryOf = async (rel: string) => {
    const r = await ask(`path=${encodeURIComponent(rel)}`);
    expect(r.body).toMatchObject({ ok: true, status: 'live', path: rel });
    return r.body.entry as string;
  };
  const move = async (from: string, to: string) => {
    mkdirSync(path.dirname(file(to)), { recursive: true });
    renameSync(file(from), file(to));
    home.observeMove(from, to);
    await home.flush();
  };
  return {
    file,
    home,
    ask,
    entryOf,
    move,
    setScope: (s: typeof scope) => {
      scope = s;
    },
  };
}

describe('GET /_api/link/resolve — entry → where the canvas is now', () => {
  test('the route is main-origin only and a read a viewer may make', () => {
    const [spec] = createLinksRoutes({ control: () => null, designRel: '.design' });
    expect(spec).toMatchObject({
      method: 'GET',
      path: '/_api/link/resolve',
      origin: 'main',
      readOnly: 'allowed',
    });
  });

  test('a link minted before a move opens the moved canvas', async () => {
    const p = await project();
    const entry = await p.entryOf('ui/Pozvanka.tsx');
    expect(entry).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    await p.move('ui/Pozvanka.tsx', 'ui/kampan/Pozvanka.tsx');
    expect((await p.ask(`c=${entry}`)).body).toEqual({
      ok: true,
      status: 'live',
      entry,
      path: 'ui/kampan/Pozvanka.tsx',
    });
  });

  test('a rename keeps the link', async () => {
    const p = await project();
    const entry = await p.entryOf('ui/Plakat.tsx');
    await p.move('ui/Plakat.tsx', 'ui/Plakat A3.tsx');
    expect((await p.ask(`c=${entry}`)).body).toMatchObject({
      status: 'live',
      path: 'ui/Plakat A3.tsx',
    });
    // A path link names the live canvas only: the old path names nothing now.
    expect((await p.ask('path=ui/Plakat.tsx')).body).toEqual({ ok: true, status: 'unknown' });
  });

  test('a trashed canvas answers trashed (the shell opens the Trash)', async () => {
    const p = await project();
    const entry = await p.entryOf('ui/Plakat.tsx');
    rmSync(p.file('ui/Plakat.tsx'));
    p.home.observe('ui/Plakat.tsx');
    await p.home.flush();
    expect((await p.ask(`c=${entry}`)).body).toEqual({ ok: true, status: 'trashed', entry });
  });

  test('an entry that was never here, or a malformed one, is unknown', async () => {
    const p = await project();
    expect((await p.ask('c=n_neverwashere0')).body).toEqual({ ok: true, status: 'unknown' });
    for (const bad of ['short', '../../etc', 'a'.repeat(129), 'n_has space0'])
      expect((await p.ask(`c=${encodeURIComponent(bad)}`)).body).toEqual({
        ok: true,
        status: 'unknown',
      });
    // One question per request.
    expect((await p.ask('c=n_aaaaaaaa&c=n_bbbbbbbb')).status).toBe(400);
    expect((await p.ask('c=n_aaaaaaaa&path=ui/Plakat.tsx')).status).toBe(400);
    expect((await p.ask('')).status).toBe(400);
  });

  test('a repo-relative path names the same canvas (Copy link from the tree)', async () => {
    const p = await project();
    const entry = await p.entryOf('ui/Pozvanka.tsx');
    expect((await p.ask('path=.design/ui/Pozvanka.tsx')).body).toMatchObject({
      status: 'live',
      entry,
    });
  });

  test('a canvas-only session resolves only its granted canvases; the rest is the same unknown', async () => {
    const p = await project();
    const granted = await p.entryOf('ui/Pozvanka.tsx');
    const other = await p.entryOf('ui/Plakat.tsx');
    p.setScope(
      resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/Pozvanka.tsx', r: 'viewer' }] })
    );
    expect((await p.ask(`c=${granted}`)).body).toMatchObject({
      status: 'live',
      path: 'ui/Pozvanka.tsx',
    });
    const unknown = { ok: true, status: 'unknown' };
    // Live elsewhere in the project: indistinguishable from never-here.
    expect((await p.ask(`c=${other}`)).body).toEqual(unknown);
    expect((await p.ask('path=ui/Plakat.tsx')).body).toEqual(unknown);
    expect((await p.ask('c=n_neverwashere0')).body).toEqual(unknown);
    // A trashed canvas — even its own granted one — never shows the Trash to a canvas-only session.
    rmSync(p.file('ui/Pozvanka.tsx'));
    p.home.observe('ui/Pozvanka.tsx');
    await p.home.flush();
    expect((await p.ask(`c=${granted}`)).body).toEqual(unknown);
    // A project session sees it in the Trash.
    p.setScope(null);
    expect((await p.ask(`c=${granted}`)).body).toMatchObject({ status: 'trashed' });
  });

  test('no op log (legacy) says so; the caller keeps today’s path link', async () => {
    for (const control of [() => null, () => ({})]) {
      const [spec] = createLinksRoutes({ control, designRel: '.design' });
      const res = await (spec as NonNullable<typeof spec>).handle(
        new Request('http://127.0.0.1/_api/link/resolve?c=n_aaaaaaaa'),
        {}
      );
      expect(await res.json()).toEqual({ ok: false, reason: 'legacy' });
    }
  });
});

describe('resolveEntry over the hub manifest (no cleared set)', () => {
  const docs: LinkDoc[] = [
    { entry: 'n_moved000', path: 'old/A.tsx', retired: true },
    { entry: 'n_moved000', path: 'new/A.tsx', retired: false },
    { entry: 'n_deleted0', path: 'ui/B.tsx', retired: true },
  ];
  const source = { docs: async () => docs };
  test('a moved entry follows its live row; a retired-only entry is trashed', async () => {
    expect(await resolveEntry(source, 'n_moved000')).toEqual({
      status: 'live',
      entry: 'n_moved000',
      path: 'new/A.tsx',
    });
    expect(await resolveEntry(source, 'n_deleted0')).toEqual({
      status: 'trashed',
      entry: 'n_deleted0',
    });
    expect(await resolveEntry(source, 'n_missing0')).toEqual({ status: 'unknown' });
  });
  test('a home that knows its Trash decides (a cleared item is unknown, not trashed)', async () => {
    const cleared = { ...source, trashed: async () => false };
    expect(await resolveEntry(cleared, 'n_deleted0')).toEqual({ status: 'unknown' });
  });
});
