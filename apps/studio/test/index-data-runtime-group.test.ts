// V2-2.8 S7 — the project tree does not name other members' session files.
//
// `/_index-data` ends with a "Runtime" group: every top-level `_*` entry of the
// design root. In a cell (one studio, every member — DDR-209) that includes
// each member's `_active.<session>.json` (Cloud Phase 27 D3), so ANY member's
// tree listed every other member's session key. V2-1.16 L8 files it as an
// "everyone-fix": the Runtime group is dropped for non-owners. And an owner's
// group keeps the shared runtime entries and THEIR OWN session file, never
// another member's.
//
// The desktop answer is byte-for-byte unchanged (no workspace mode ⇒ no roles,
// no sessions): the last test pins it.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const ALICE = 'aaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbb';
const CAROL = 'cccccccccccccccc'; // the owner

interface Group {
  label: string;
  kind?: string;
  paths: string[];
}

function seedRuntime(designRoot: string): void {
  for (const key of [ALICE, BOB, CAROL]) {
    writeFileSync(join(designRoot, `_active.${key}.json`), '{}');
  }
  writeFileSync(join(designRoot, '_active.json'), '{}');
  mkdirSync(join(designRoot, '_history', 'ui-fixture'), { recursive: true });
}

async function indexAs(
  base: string,
  headers: Record<string, string>
): Promise<{ groups: Group[]; raw: string }> {
  const r = await fetch(`${base}/_index-data`, { headers });
  expect(r.status).toBe(200);
  const raw = await r.text();
  return { groups: (JSON.parse(raw) as { groups: Group[] }).groups, raw };
}

const as = (session: string, role: string) => ({
  'x-maude-session': session,
  'x-maude-role': role,
  'x-maude-readonly': role === 'viewer' ? '1' : '0',
});

describe('/_index-data Runtime group (V2-2.8 S7)', () => {
  test('a cell: non-owners get no Runtime group; the owner sees only their own session file', async () => {
    const { root, designRoot } = makeSandbox();
    seedRuntime(designRoot);
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      MAUDE_NO_AUTOBUILD: '1',
    });
    try {
      const base = `http://localhost:${port}`;

      for (const [session, role] of [
        [ALICE, 'member'],
        [BOB, 'viewer'],
      ] as const) {
        const { groups, raw } = await indexAs(base, as(session, role));
        expect(groups.some((g) => g.kind === 'runtime')).toBe(false);
        // Not even its own key, nor anyone else's, anywhere in the body.
        for (const key of [ALICE, BOB, CAROL]) expect(raw).not.toContain(key);
      }

      const { groups, raw } = await indexAs(base, as(CAROL, 'owner'));
      const runtime = groups.find((g) => g.kind === 'runtime');
      expect(runtime).toBeDefined();
      expect(runtime?.paths).toContain(`.design/_active.${CAROL}.json`);
      expect(runtime?.paths).toContain('.design/_history');
      expect(raw).not.toContain(ALICE);
      expect(raw).not.toContain(BOB);
    } finally {
      await killProc(proc);
    }
  }, 30_000);

  test('the desktop tree is unchanged: every runtime entry is listed', async () => {
    const { root, designRoot } = makeSandbox();
    seedRuntime(designRoot);
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const { groups } = await indexAs(`http://localhost:${port}`, {});
      const runtime = groups.find((g) => g.kind === 'runtime');
      expect(runtime?.label).toBe('Runtime');
      for (const p of [
        '.design/_active.json',
        `.design/_active.${ALICE}.json`,
        `.design/_active.${BOB}.json`,
        `.design/_active.${CAROL}.json`,
        '.design/_history',
      ]) {
        expect(runtime?.paths).toContain(p);
      }
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
