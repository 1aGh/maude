// 2.0.2 — a frame opened by someone with a PROJECT read role reads the project's media
// (decision `maude/v2-202-project-role-frames-read-project-media`, Michal 2026-11-03).
//
// gate-b-c4 narrows every frame to its canvas, the owner's included, and the closure resolves only
// STATIC references (G3). So an owner's own Design system canvas that builds its picture paths in
// code (`.design/assets/${n}.svg`) got 403 not-in-scope for pictures the main origin serves it —
// "Picture not found" on the desktop. Michal's rule: when the frame's opener holds a project read
// role, the frame may GET any inert media (images, video, audio, fonts) anywhere in the design root.
// Nothing else widens: source, CSS, JSON, sidecars and other canvases stay refused, and a
// canvas-only opener (a share of one canvas) keeps the strict closure, G3 included.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { frameReadsProjectMedia, narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { asUser, frameCap, get, OWNER, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SYS = 'system/alligators';
const BOARD = `${SYS}/design-system.tsx`;
const MASCOT = 'assets/gator_mascot_head.svg';
const ROUNDEL = 'assets/gator_badge_roundel.svg';
/** A name the static scanner stops at (whitespace) and the file-plane shape refuses (parens). */
const SPACED = 'assets/Team photo (2).jpg';
const OTHER_DS_ASSET = 'system/club/assets/photos/pitch.jpg';
const OTHER_CANVAS = 'ui/canary-b-zx.tsx';
const OTHER_META = 'ui/canary-b-zx.meta.json';
const OTHER_CSS = 'system/club/colors_and_type.css';

const header = (claim: unknown) => Buffer.from(JSON.stringify(claim)).toString('base64url');
const OWNER_O = asUser(OWNER, 'owner@example.com');
const VIEWER_O = asUser(
  {
    'x-maude-access': header({ v: 1, role: 'viewer' }),
    'x-maude-role': 'viewer',
    'x-maude-readonly': '1',
  },
  'viewer@example.com'
);
/** A share of the board alone — no project role. */
const SHARE_O = asUser(
  {
    'x-maude-access': header({ v: 1, role: null, grants: [{ c: BOARD, r: 'member' }] }),
    'x-maude-readonly': '1',
  },
  'guest@example.com'
);

const BOARD_SRC = `import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
import { DSSection, DsBar } from "@maude/ds/board";
const MASCOT = ["gator_mascot_head", "gator_badge_roundel"];
export default function DesignSystem() {
  return <DesignCanvas><DsBar /><DCArtboard id="ds-mascot" label="Mascot" width={400} height={400}>{MASCOT.map((n) => <img key={n} src={\`.design/assets/\${n}.svg\`} />)}</DCArtboard></DesignCanvas>;
}
`;

let proc: Subprocess;
let dr = '';
let base = '';
let canvasBase = '';
const fcs: Record<string, string> = {};

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  dr = designRoot;
  const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  cfg.designSystems = [
    { name: 'alligators', path: SYS },
    { name: 'club', path: 'system/club' },
  ];
  cfg.defaultDesignSystem = 'alligators';
  writeFileSync(join(designRoot, 'config.json'), JSON.stringify(cfg, null, 2));
  for (const d of [SYS, 'system/club/assets/photos', 'assets'])
    mkdirSync(join(designRoot, d), { recursive: true });
  writeFileSync(join(designRoot, SYS, 'colors_and_type.css'), ':root{}');
  writeFileSync(join(designRoot, OTHER_CSS), ':root{--club:1}');
  writeFileSync(join(designRoot, BOARD), BOARD_SRC);
  writeFileSync(join(designRoot, OTHER_CANVAS), '// CANARY-B-SOURCE\nexport default () => null;\n');
  writeFileSync(join(designRoot, OTHER_META), '{"designSystem":"club"}');
  for (const f of [MASCOT, ROUNDEL])
    writeFileSync(join(designRoot, f), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(designRoot, SPACED), 'JPEG-BYTES');
  writeFileSync(join(designRoot, OTHER_DS_ASSET), 'JPEG-CLUB');
  const port = nextPort();
  const home = mkdtempSync(join(tmpdir(), 'frame-media-home-'));
  proc = await bootServer(root, port, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Alligators',
  });
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
  base = `http://localhost:${port}`;
  canvasBase = `http://localhost:${info.canvasPort}`;
  for (const [k, h] of Object.entries({ owner: OWNER_O, viewer: VIEWER_O, share: SHARE_O }))
    fcs[k] = (await frameCap({ base }, h, BOARD)) as string;
}, 60000);
afterAll(async () => {
  if (proc) await killProc(proc);
});

const url = (rel: string) => `/.design/${rel.split('/').map(encodeURIComponent).join('/')}`;

describe('a frame opened with a project read role reads project media', () => {
  test('every opener got a capability', () => {
    expect(Object.values(fcs).every((v) => typeof v === 'string')).toBe(true);
  });

  for (const [who, h] of [
    ['owner', OWNER_O],
    ['viewer', VIEWER_O],
  ] as const) {
    for (const rel of [MASCOT, ROUNDEL, SPACED, OTHER_DS_ASSET]) {
      test(`${who} frame: GET ${rel} → 200`, async () => {
        const r = await get(canvasBase + withFc(url(rel), fcs[who] as string), h);
        expect({ rel, status: r.status }).toEqual({ rel, status: 200 });
      });
    }
    test(`${who} frame: the project /assets/ alias and a Referer-carried capability → 200`, async () => {
      const a = await get(canvasBase + withFc(`/${MASCOT}`, fcs[who] as string), h);
      expect(a.status).toBe(200);
      const b = await get(canvasBase + url(ROUNDEL), {
        ...h,
        referer: `${canvasBase}/_canvas-shell.html?canvas=${encodeURIComponent(BOARD)}&fc=${encodeURIComponent(fcs[who] as string)}`,
      });
      expect(b.status).toBe(200);
    });
    for (const rel of [OTHER_CANVAS, OTHER_META, OTHER_CSS, 'config.json']) {
      test(`${who} frame: a non-media file outside the closure stays refused: ${rel}`, async () => {
        const r = await get(canvasBase + withFc(url(rel), fcs[who] as string), h);
        expect({ rel, status: r.status }).toEqual({ rel, status: 403 });
        expect(r.text).not.toMatch(/canary-b|--club/i);
      });
    }
  }

  test('a write is never media-relaxed (PUT on a media path from an owner frame)', async () => {
    const r = await fetch(canvasBase + withFc(url(OTHER_DS_ASSET), fcs.owner as string), {
      method: 'PUT',
      headers: { ...OWNER_O, origin: canvasBase },
      body: 'OVERWRITE',
    });
    expect(r.status).not.toBe(200);
    expect(readFileSync(join(dr, OTHER_DS_ASSET), 'utf8')).toBe('JPEG-CLUB');
  });

  test('no capability: still refused', async () => {
    const r = await get(canvasBase + url(MASCOT), OWNER_O);
    expect(r.status).toBe(403);
  });
});

describe('a canvas-only opener keeps the strict closure (G3)', () => {
  for (const rel of [MASCOT, ROUNDEL, SPACED, OTHER_DS_ASSET]) {
    test(`share frame: GET ${rel} (computed / outside its closure) → 403`, async () => {
      const r = await get(canvasBase + withFc(url(rel), fcs.share as string), SHARE_O);
      expect({ rel, status: r.status }).toEqual({ rel, status: 403 });
    });
  }
  test("share frame: its own system's stylesheet still loads", async () => {
    const r = await get(
      canvasBase + withFc(url(`${SYS}/colors_and_type.css`), fcs.share as string),
      SHARE_O
    );
    expect(r.status).toBe(200);
  });
});

describe('frameReadsProjectMedia (unit)', () => {
  const owner = narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), [BOARD]);
  const share = narrowToFrame(
    resolveAccess({ v: 1, role: null, grants: [{ c: BOARD, r: 'member' }] }),
    [BOARD]
  );
  test('media anywhere, GET/HEAD only, for a project-role opener', () => {
    for (const rel of [MASCOT, SPACED, OTHER_DS_ASSET, 'ui/x/clip.MP4', 'fonts/a.woff2'])
      expect({ rel, ok: frameReadsProjectMedia(owner, rel, 'GET') }).toEqual({ rel, ok: true });
    expect(frameReadsProjectMedia(owner, MASCOT, 'HEAD')).toBe(true);
    for (const m of ['PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'])
      expect({ m, ok: frameReadsProjectMedia(owner, MASCOT, m) }).toEqual({ m, ok: false });
  });
  test('never source, CSS, JSON, runtime state, dot names or an escape', () => {
    for (const rel of [
      BOARD,
      OTHER_CSS,
      OTHER_META,
      'config.json',
      'assets/x.photo.json',
      '_state/x.png',
      '_comments/x.png',
      'assets/.hidden.png',
      '.hidden-dir/x.png',
      '../escape.png',
      '/abs.png',
      'assets//x.png',
    ])
      expect({ rel, ok: frameReadsProjectMedia(owner, rel, 'GET') }).toEqual({ rel, ok: false });
  });
  test('never for a canvas-only opener, nor for an access that is not a frame', () => {
    expect(frameReadsProjectMedia(share, MASCOT, 'GET')).toBe(false);
    expect(frameReadsProjectMedia(resolveAccess({ v: 1, role: 'owner' }), MASCOT, 'GET')).toBe(
      false
    );
  });
});
