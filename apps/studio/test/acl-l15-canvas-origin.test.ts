// S9.11 — V2-1.16 L15: the canvas origin with an A-only render token. B's module, B's
// asset (both static-lane spellings), a `?sha=` build of B, B's comments and canvas meta
// and a collab upgrade to B all answer exactly like a missing file; A's module, CSS and
// asset load. A `?file=` naming A never lends its answer to B's module. Owners unchanged.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import { A_ONLY, type AclCell, B_REL, bootAclCell, get, hasCanary, OWNER } from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const NOT_IN_SCOPE = { error: 'not-in-scope', reason: 'not-in-scope' };
const B_FILE = `.design/${B_REL}`;
const B_SLUG = canvasSlugFromRel(B_REL, '.design');
const A_SLUG = canvasSlugFromRel('ui/a.tsx', '.design');

let cell: AclCell;
beforeAll(async () => {
  cell = await bootAclCell();
}, 60000);
afterAll(async () => {
  if (cell) await killProc(cell.proc);
});

const B_READS = [
  `/${B_FILE}`,
  `/${B_FILE}?sha=deadbeef`,
  `/${B_FILE}?file=.design/ui/a.tsx`,
  '/assets/bbbb0001.png',
  '/.design/assets/bbbb0001.png',
  `/_comments?file=${encodeURIComponent(B_FILE)}`,
  `/_api/canvas-meta?file=${encodeURIComponent(B_FILE)}`,
];

describe('an A-only render token on the canvas origin', () => {
  test('a missing canvas is the reference answer (U1)', async () => {
    const r = await get(`${cell.canvasBase}/.design/ui/nope.tsx`, A_ONLY);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual(NOT_IN_SCOPE);
  });

  for (const path of B_READS) {
    test(`GET ${path} → absent`, async () => {
      const r = await get(cell.canvasBase + path, A_ONLY);
      expect(r.status).toBe(403);
      expect(JSON.parse(r.text)).toEqual(NOT_IN_SCOPE);
      expect(hasCanary(r.text)).toBe(false);
    });
  }

  test('the collab upgrade to B is refused before it upgrades; A upgrades', async () => {
    const b = await get(`${cell.canvasBase}/_ws/collab/${B_SLUG}`, A_ONLY);
    expect(b.status).toBe(403);
    expect(JSON.parse(b.text)).toEqual(NOT_IN_SCOPE);
    // a plain GET to an allowed room reaches `srv.upgrade` (and fails it: not a handshake)
    const a = await get(`${cell.canvasBase}/_ws/collab/${A_SLUG}`, A_ONLY);
    expect(a.status).toBe(400);
  });

  test("A's module, CSS and asset load", async () => {
    for (const path of ['/.design/ui/a.tsx', '/.design/ui/a.css', '/assets/aaaa0001.png']) {
      const r = await get(cell.canvasBase + path, A_ONLY);
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
  });
});

test('an owner still reads B on the canvas origin (U7)', async () => {
  for (const path of [`/${B_FILE}`, '/assets/bbbb0001.png']) {
    const r = await get(cell.canvasBase + path, OWNER);
    expect({ path, status: r.status }).toEqual({ path, status: 200 });
  }
  const c = await get(`${cell.canvasBase}/_ws/collab/${B_SLUG}`, OWNER);
  expect(c.status).toBe(400);
});
