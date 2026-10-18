// S9.10 — V2-1.16 L6 studio half: `/_api/git/log` and `/_api/git/diff` for a canvas-only session.
//
// The fixture has one commit touching A + B (`design: update 2 canvases`, a body naming B),
// a manual commit naming B in its subject, and one touching C only. As A-only the log shows
// "Changed a" — no "2", no B, no body, no author e-mail — and never C's commit; the diff
// lists A and nothing else; `?path=B` is the `not-in-scope` a missing file gets. The owner's
// log keeps every subject (U7).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  A,
  A_ONLY,
  asRole,
  B,
  bootCanaryCell,
  type Cell,
  canaries,
  canvasOnly,
  get,
  OWNER,
} from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

type Entry = { sha: string; message: string; author: string; email: string; date: string };
const entries = (j: unknown) => (j as { entries: Entry[] }).entries;

describe('L6 — git log', () => {
  test('owner: every commit, subjects as written', async () => {
    const r = await get(cell, '/_api/git/log', OWNER);
    expect(r.status).toBe(200);
    expect(entries(r.json).map((e) => e.message)).toEqual([
      'canary only commit',
      'tweak canary-b and a',
      'design: update 2 canvases',
    ]);
    expect(entries(r.json)[0]?.email).toBe('tess@example.com');
  });

  test('A-only: only commits touching A, subjects rewritten, author by name only', async () => {
    for (const path of ['/_api/git/log', `/_api/git/log?path=${encodeURIComponent(A)}`]) {
      const r = await get(cell, path, A_ONLY);
      expect(r.status).toBe(200);
      expect(canaries(r.text)).toEqual([]);
      const list = entries(r.json);
      expect(list.map((e) => e.message)).toEqual(['Changed a', 'Changed a']);
      expect(r.text).not.toContain('2 canvases');
      expect(list.every((e) => e.author === 'Tess Ter' && e.email === '')).toBe(true);
    }
  });

  test('A-only: ?path=B is the not-in-scope a missing file gets', async () => {
    const b = await get(cell, `/_api/git/log?path=${encodeURIComponent(B)}`, A_ONLY);
    const missing = await get(cell, '/_api/git/log?path=.design/ui/missing.tsx', A_ONLY);
    expect(b.status).toBe(403);
    expect(b.text).toBe(missing.text);
  });
});

describe('L6 — git diff (the export class)', () => {
  test('A-only: the file list is A only; the owner sees all three', async () => {
    const owner = await get(cell, `/_api/git/diff?sha=${cell.firstSha}`, OWNER);
    expect(owner.status).toBe(200);
    expect(canaries(owner.text).length).toBeGreaterThan(0);
    const r = await get(cell, `/_api/git/diff?sha=${cell.firstSha}`, A_ONLY);
    expect(r.status).toBe(200);
    expect(canaries(r.text)).toEqual([]);
    expect((r.json as { entries: Array<{ file: string }> }).entries.map((e) => e.file)).toEqual([
      A,
    ]);
  });

  test('without export anywhere (an observer grant, an observer) → 403 read-only', async () => {
    for (const h of [canvasOnly('observer'), asRole('observer')]) {
      const r = await get(cell, `/_api/git/diff?sha=${cell.firstSha}`, h);
      expect(r.status).toBe(403);
      expect((r.json as { error?: string }).error).toBe('read-only');
    }
    // A viewer (Can comment) holds export: unchanged.
    expect((await get(cell, `/_api/git/diff?sha=${cell.firstSha}`, asRole('viewer'))).status).toBe(
      200
    );
  });
});
