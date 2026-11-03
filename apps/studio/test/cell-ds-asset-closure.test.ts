// 2.0.2 — on a materializing cell, a canvas frame is refused its own design system's media.
//
// Measured on alligators.cloud.maude.sh (2.0.1): a frame's `colors_and_type.css` loads, but
// `system/alligators/assets/logos/mark-white.svg` answers 403 not-in-scope on the canvas origin
// (the main origin serves it). On a cell the disk is a cache (DDR-243): inert media lives in the
// bucket, the hub's journal lists it, and the static lane fills it into a HUB-OWNED cache outside
// the design root (`materializedOr404`). The closure listed only the checkout, so a DS asset never
// on disk was never in any canvas's closure, and the path-first gate refused it before the static
// lane could ask the hub. The fix: the closure's listing also holds the journal's inert media
// (`listMaterializable`), awaited by the gate for a canvas-only session.
//
// This boots a real studio in workspace mode with the cell materializer on, pointed at a fake hub
// that lists + fills the media, and replays the production requests with the frame capability.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';

import { type AclCell, asUser, frameCap, get, OWNER, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SHA = 'c'.repeat(64);
const OTHER_SHA = 'd'.repeat(64);
const CANVAS = 'ui/social/events.tsx';
const SYS = 'system/alligators';
const LOGO = `${SYS}/assets/logos/mark-white.svg`;
const PHOTO = `${SYS}/assets/photos-cut/frame-helmet.jpg`;
/** Another system's media, also in the journal — never this canvas's. */
const FOREIGN = 'system/other/assets/logos/mark.svg';
/** A project asset no canvas file names — not in the closure either. */
const UNUSED = 'assets/zzzz0001.png';
/** A project asset the canvas names statically — the same bug for `assets/` (closure `existingAssetRefs`). */
const USED = 'assets/rrrr0001.png';

// The production shape: the logo path is computed at runtime in a `_social` helper, so only the
// "whole design-system folder" rule (closure.ts `isSystemFileInClosure`) can admit it.
const LOGO_SRC = `export function Logo({ variant = 'mark', tone = 'white' }) {
  return <img src={\`/.design/system/alligators/assets/logos/\${variant}-\${tone}.svg\`} />;
}
`;
const CANVAS_SRC = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
import { Logo } from './_social/logo';
export default function Events() {
  return <DesignCanvas><DCArtboard id="a" width={400} height={400}><Logo /><img src="assets/rrrr0001.png" /></DCArtboard></DesignCanvas>;
}
`;

let cell: AclCell;
let hub: Server;
let fc: string;
const asked: string[] = [];
const OWNER_O = asUser(OWNER, 'owner@example.com');

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  cfg.designSystems = [{ name: 'alligators', path: SYS }];
  cfg.defaultDesignSystem = 'alligators';
  writeFileSync(join(designRoot, 'config.json'), JSON.stringify(cfg, null, 2));
  mkdirSync(join(designRoot, SYS), { recursive: true });
  writeFileSync(join(designRoot, SYS, 'colors_and_type.css'), ':root { --fg: #fff }\n');
  mkdirSync(join(designRoot, 'ui/social/_social'), { recursive: true });
  writeFileSync(join(designRoot, CANVAS), CANVAS_SRC);
  writeFileSync(join(designRoot, 'ui/social/_social/logo.tsx'), LOGO_SRC);
  // NOT on disk: LOGO, PHOTO, FOREIGN, UNUSED — the journal lists them, the bucket holds them.

  const cache = realpathSync(mkdtempSync(join(tmpdir(), 'cell-ds-cache-')));
  mkdirSync(join(cache, 'blobs'), { recursive: true });
  writeFileSync(join(cache, 'blobs', SHA), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(cache, 'blobs', OTHER_SHA), 'OTHER-SYSTEM-BYTES');
  hub = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== '/_materialize' || req.headers.get('authorization') !== 'Bearer tok')
        return new Response('nope', { status: 404 });
      if (u.searchParams.get('list') === '1')
        return Response.json({ rels: [LOGO, PHOTO, USED, FOREIGN, UNUSED] });
      const rel = u.searchParams.get('rel') ?? '';
      asked.push(rel);
      if (rel === FOREIGN || rel === UNUSED)
        return Response.json({ path: join(cache, 'blobs', OTHER_SHA) });
      if (rel === LOGO || rel === PHOTO || rel === USED)
        return Response.json({ path: join(cache, 'blobs', SHA) });
      return Response.json({ miss: 'absent' }, { status: 404 });
    },
  });

  const port = nextPort();
  const home = mkdtempSync(join(tmpdir(), 'cell-ds-home-'));
  const proc = await bootServer(root, port, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Alligators',
    MAUDE_CELL_MATERIALIZE: '1',
    MAUDE_MATERIALIZE_URL: `http://127.0.0.1:${hub.port}`,
    MAUDE_MATERIALIZE_TOKEN: 'tok',
    MAUDE_MATERIALIZE_CACHE_DIR: cache,
  });
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')) as {
    canvasPort?: number;
  };
  cell = {
    proc,
    root,
    designRoot,
    base: `http://localhost:${port}`,
    port,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
  fc = (await frameCap(cell, OWNER_O, CANVAS)) as string;
}, 60000);

afterAll(async () => {
  if (cell) await killProc(cell.proc);
  hub?.stop(true);
});

describe("a cell frame reads its own design system's media (not on the checkout)", () => {
  test('the frame capability was minted', () => {
    expect(typeof fc).toBe('string');
  });

  test('the owner on the main origin gets the logo (control — the hub serves it)', async () => {
    const r = await get(`${cell.base}/.design/${LOGO}`, OWNER_O);
    expect(r.status).toBe(200);
  });

  test('the system stylesheet on disk loads (control)', async () => {
    const r = await get(
      cell.canvasBase + withFc(`/.design/${SYS}/colors_and_type.css`, fc),
      OWNER_O
    );
    expect(r.status).toBe(200);
  });

  for (const rel of [LOGO, PHOTO, USED]) {
    test(`GET /.design/${rel} with the frame's capability → 200, materialized`, async () => {
      const r = await get(cell.canvasBase + withFc(`/.design/${rel}`, fc), OWNER_O);
      expect({ rel, status: r.status }).toEqual({ rel, status: 200 });
      expect(r.text).toContain('<svg');
      expect(asked).toContain(rel);
    });
    test(`GET /.design/${rel} with the capability in the Referer → 200`, async () => {
      const r = await get(`${cell.canvasBase}/.design/${rel}`, {
        ...OWNER_O,
        referer: `${cell.canvasBase}/.design/${CANVAS}?fc=${encodeURIComponent(fc)}`,
      });
      expect({ rel, status: r.status }).toEqual({ rel, status: 200 });
    });
  }

  test('no capability → still refused', async () => {
    const r = await get(`${cell.canvasBase}/.design/${LOGO}`, OWNER_O);
    expect(r.status).toBe(403);
  });

  for (const rel of [FOREIGN, UNUSED]) {
    test(`journal media outside the canvas's system / closure stays refused: ${rel}`, async () => {
      const before = asked.length;
      const r = await get(cell.canvasBase + withFc(`/.design/${rel}`, fc), OWNER_O);
      expect({ rel, status: r.status }).toEqual({ rel, status: 403 });
      expect(JSON.parse(r.text).error).toBe('not-in-scope');
      expect(r.text).not.toContain('OTHER-SYSTEM-BYTES');
      // refused before the static lane — the hub was never asked to fill it
      expect(asked.slice(before)).not.toContain(rel);
    });
  }
});
