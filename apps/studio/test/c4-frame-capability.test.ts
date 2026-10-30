// gate-b-c4 — security C4 (decision `v2-michal-c4-fix-in-wave-b`): canvas code runs with the
// rights of whoever OPENS the canvas. The planted attack: an editor whose grant covers canvas A
// writes code into A; the OWNER opens A; A's code asks the canvas origin for B's board, comments,
// meta, source and asset — and writes to B — with the owner's rights. Every such request carries
// A's frame capability (or none, or a forged one) and must be refused exactly like a missing
// file; A's own requests keep working. Revert the narrowing (http.ts `accessOf`) and the frame
// gate (server.ts `inFrame`) and the refusals below go red.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import {
  A_REL,
  type AclCell,
  asUser,
  B_REL,
  bootAclCell,
  frameCap,
  get,
  hasCanary,
  OWNER,
} from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const NOT_IN_SCOPE = { error: 'not-in-scope', reason: 'not-in-scope' };
const B_FILE = `.design/${B_REL}`;
const A_FILE = `.design/${A_REL}`;
const B_SLUG = canvasSlugFromRel(B_REL, '.design');
const A_SLUG = canvasSlugFromRel(A_REL, '.design');
const OWNER_O = asUser(OWNER, 'owner@example.com');

let cell: AclCell;
let fcA: string;
let fcB: string;
beforeAll(async () => {
  cell = await bootAclCell();
  fcA = (await frameCap(cell, OWNER_O, A_REL)) as string;
  fcB = (await frameCap(cell, OWNER_O, B_REL)) as string;
}, 60000);
afterAll(async () => {
  if (cell) await killProc(cell.proc);
});

const withFc = (path: string, fc: string) =>
  `${path}${path.includes('?') ? '&' : '?'}fc=${encodeURIComponent(fc)}`;

/** Every per-canvas read canvas code could aim at B. */
const B_READS = [
  `/${B_FILE}`,
  `/${B_FILE}?sha=deadbeef`,
  `/${B_FILE}?file=${encodeURIComponent(A_FILE)}`,
  '/assets/bbbb0001.png',
  '/.design/assets/bbbb0001.png',
  `/_comments?file=${encodeURIComponent(B_FILE)}`,
  `/_api/canvas-meta?file=${encodeURIComponent(B_FILE)}`,
  `/_api/annotations?file=${encodeURIComponent(B_FILE)}`,
];

describe("the owner's frame for A (canvas code planted by an A-only editor)", () => {
  test('the shell got a key and minted a capability per canvas', () => {
    expect(typeof fcA).toBe('string');
    expect(typeof fcB).toBe('string');
    expect(fcA).not.toBe(fcB);
  });

  for (const path of B_READS) {
    test(`GET ${path} with A's capability → absent`, async () => {
      const r = await get(cell.canvasBase + withFc(path, fcA), OWNER_O);
      expect({ path, status: r.status }).toEqual({ path, status: 403 });
      expect(JSON.parse(r.text)).toEqual(NOT_IN_SCOPE);
      expect(hasCanary(r.text)).toBe(false);
    });
    test(`GET ${path} with A's capability in the Referer → absent`, async () => {
      const r = await get(cell.canvasBase + path, {
        ...OWNER_O,
        referer: `${cell.canvasBase}/_canvas-shell.html?canvas=${A_REL}&fc=${encodeURIComponent(fcA)}`,
      });
      expect({ path, status: r.status }).toEqual({ path, status: 403 });
      expect(hasCanary(r.text)).toBe(false);
    });
    test(`GET ${path} with NO capability → absent`, async () => {
      const r = await get(cell.canvasBase + path, OWNER_O);
      expect({ path, status: r.status }).toEqual({ path, status: 403 });
      expect(hasCanary(r.text)).toBe(false);
    });
  }

  test('a capability for B minted under ANOTHER member key opens nothing', async () => {
    const forged = (await frameCap(cell, asUser(OWNER, 'editor@example.com'), B_REL)) as string;
    expect(typeof forged).toBe('string');
    const r = await get(cell.canvasBase + withFc(`/${B_FILE}`, forged), OWNER_O);
    expect(r.status).toBe(403);
    expect(hasCanary(r.text)).toBe(false);
  });

  test('the comment listing in A carries nothing of B', async () => {
    const r = await get(cell.canvasBase + withFc('/_comments', fcA), OWNER_O);
    expect(hasCanary(r.text)).toBe(false);
  });

  test("the collab upgrade to B's room is refused; A's room upgrades", async () => {
    const b = await get(cell.canvasBase + withFc(`/_ws/collab/${B_SLUG}`, fcA), OWNER_O);
    expect(b.status).toBe(403);
    const a = await get(cell.canvasBase + withFc(`/_ws/collab/${A_SLUG}`, fcA), OWNER_O);
    expect(a.status).toBe(400); // reaches srv.upgrade (a plain GET is not a handshake)
  });

  const B_WRITES: Array<[string, string, unknown]> = [
    ['PATCH', '/_api/canvas-meta', { file: B_FILE, patch: { layout: { artboards: [] } } }],
    ['POST', '/_api/annotations/ops', { file: B_FILE, ops: [] }],
    ['PUT', '/_api/annotations', { file: B_FILE, svg: '<svg/>' }],
    ['POST', '/_comments', { file: B_FILE, text: 'exfil', selector: '[data-dc-screen]' }],
  ];
  for (const [method, path, body] of B_WRITES) {
    test(`${method} ${path} naming B with A's capability → refused`, async () => {
      const r = await fetch(cell.canvasBase + withFc(path, fcA), {
        method,
        headers: { ...OWNER_O, 'content-type': 'application/json', origin: cell.canvasBase },
        body: JSON.stringify(body),
      });
      expect({ method, path, status: r.status }).toEqual({ method, path, status: 403 });
    });
  }

  test("A's own module, CSS, asset and meta load", async () => {
    for (const path of [
      `/${A_FILE}`,
      '/.design/ui/a.css',
      '/assets/aaaa0001.png',
      `/_api/canvas-meta?file=${encodeURIComponent(A_FILE)}`,
    ]) {
      const r = await get(cell.canvasBase + withFc(path, fcA), OWNER_O);
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
    // the frame's nested loads (an import, a CSS url()) carry it in their Referer
    const nested = await get(`${cell.canvasBase}/.design/ui/a.css`, {
      ...OWNER_O,
      referer: `${cell.canvasBase}/${A_FILE}?fc=${encodeURIComponent(fcA)}`,
    });
    expect(nested.status).toBe(200);
  });

  test("the owner's frame for B reads B (a frame is scoped, not shut)", async () => {
    const r = await get(cell.canvasBase + withFc(`/${B_FILE}`, fcB), OWNER_O);
    expect(r.status).toBe(200);
  });

  test('frame-less requests still reach the shell and /_health', async () => {
    for (const path of ['/_health', '/_canvas-shell.html']) {
      const r = await get(cell.canvasBase + path, OWNER_O);
      expect({ path, ok: r.status < 400 }).toEqual({ path, ok: true });
    }
  });
});

test('a cell session without a vouched member gets no frame key (a shared key would be forgeable)', async () => {
  const r = await fetch(`${cell.base}/_config`, { headers: OWNER });
  const cfg = (await r.json()) as { frameKey?: string };
  expect(cfg.frameKey).toBeUndefined();
});
