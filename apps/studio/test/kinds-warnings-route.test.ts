// S7.25 — `GET /_api/kinds/warnings` and `GET /_api/kinds/convert-plan`: the agent's door to what the canvas shows as a mark
// and a row. Read-only, main origin only; warnings need read, the plan needs edit. The layers come from an injected
// geometry source (the real one is a headless render), so a test hands the route a manifest.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { CANVAS_SAFE_API } from '../http.ts';
import type { RectsManifest } from '../exporters/print-preflight.ts';
import { allSpecs } from '../routes/index.ts';
import { createKindRoutes } from '../routes/kinds.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = `import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';
export default function Kampan() {
  return (
    <DesignCanvas>
      <DCArtboard id="ig" label="Oznámení" width={1080} height={1350} fixed kind="digital" background="var(--ink)">
        <h1>COMBINE</h1>
      </DCArtboard>
      <DCArtboard id="karta" label="Arch 1" width={1144} height={816} fixed kind="print" print={{ paper: 'a4', orientation: 'landscape', bleedMm: 3 }}>
        <p>Karta</p>
      </DCArtboard>
      <DCArtboard id="flag" label="A · přední" width={419} height={581} fixed kind="print" print={{ paper: 'a6', bleedMm: 3 }}>
        <p>Leták</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// the QR code on the A6 reaches 8 px past the trim line (and stops inside the bleed)
const MANIFEST: RectsManifest = {
  artboards: [
    { id: 'ig', x: 0, y: 0, w: 1080, h: 1350 },
    { id: 'karta', x: 1200, y: 0, w: 1144, h: 816 },
    { id: 'flag', x: 0, y: 1500, w: 419, h: 581 },
  ],
  elements: [
    { cdId: 'qr', artboard: 'flag', x: 332, y: 1500 + 480, w: 84, h: 84, tag: 'img', naturalW: 900 },
    { cdId: 'foto', artboard: 'ig', x: 90, y: 300, w: 900, h: 600, tag: 'img', naturalW: 640 },
    { cdId: 'hl', artboard: 'ig', x: 900, y: 40, w: 160, h: 60, tag: 'h1', text: 'COMBINE' },
  ],
};

function sandbox(role: string | null, rects: RectsManifest | null = MANIFEST) {
  const root = mkdtempSync(join(tmpdir(), 'maude-warn-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Kampan.tsx'), SRC);
  const specs = createKindRoutes({
    designRoot,
    designRel: '.design',
    ...(role ? { access: () => resolveAccess({ v: 1, role } as never) } : {}),
    rects: async () => rects,
    videoFacts: () => null,
  });
  const by = (p: string) => specs.find((s) => s.path === p);
  return {
    warnings: (q = 'canvas=.design/ui/Kampan.tsx') =>
      (by('/_api/kinds/warnings') as NonNullable<ReturnType<typeof by>>).handle(
        new Request(`http://localhost/_api/kinds/warnings?${q}`),
        {}
      ),
    plan: (q: string) =>
      (by('/_api/kinds/convert-plan') as NonNullable<ReturnType<typeof by>>).handle(
        new Request(`http://localhost/_api/kinds/convert-plan?${q}`),
        {}
      ),
  };
}

describe('in the one table', () => {
  test('both reads: GET, main origin only, in neither canvas allowlist', () => {
    for (const p of ['/_api/kinds/warnings', '/_api/kinds/convert-plan']) {
      const specs = allSpecs(stubDeps()).filter((s) => s.path === p);
      expect(specs.map((s) => [s.method, s.origin, s.readOnly])).toEqual([
        ['GET', 'main', 'allowed'],
      ]);
      expect(mountRoutes(allSpecs(stubDeps())).canvasPaths).not.toContain(p);
      expect(CANVAS_SAFE_API.has(p)).toBe(false);
    }
  });
});

describe('GET /_api/kinds/warnings', () => {
  test('an observer reads the things to check: the hand-typed 1144, the QR across the cut, nothing for the post', async () => {
    const r = await sandbox('observer').warnings();
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      measured: boolean;
      artboards: Array<{
        id: string;
        count: number;
        summary: string;
        warnings: Array<{ code: string; verb: string; text: string }>;
      }>;
    };
    expect(body.measured).toBe(true);
    const by = (id: string) => body.artboards.find((a) => a.id === id);
    expect(by('ig')?.count).toBe(0);
    expect(by('karta')?.warnings.map((w) => [w.code, w.verb])).toEqual([
      ['not-paper-size', 'Fix size'],
    ]);
    expect(by('karta')?.warnings[0]?.text).toBe(
      '1 px narrower than A4 landscape with bleed (1145 × 816).'
    );
    expect(by('flag')?.summary).toBe('1 thing to check');
    expect(by('flag')?.warnings[0]?.code).toBe('crosses-cut');
  });

  test('?artboard= narrows it; unmeasured (no render) still raises what the props say', async () => {
    const one = await (await sandbox('viewer').warnings('canvas=.design/ui/Kampan.tsx&artboard=karta')).json();
    expect((one as { artboards: unknown[] }).artboards).toHaveLength(1);
    const dark = (await (await sandbox('viewer', null).warnings()).json()) as {
      measured: boolean;
      artboards: Array<{ id: string; count: number }>;
    };
    expect(dark.measured).toBe(false);
    expect(dark.artboards.find((a) => a.id === 'karta')?.count).toBe(1);
    expect(dark.artboards.find((a) => a.id === 'flag')?.count).toBe(0);
  });

  test('no access, or a canvas that is not there, is refused', async () => {
    expect((await sandbox(null).warnings()).status).toBe(403);
    expect((await sandbox('viewer').warnings('canvas=.design/ui/Nope.tsx')).status).toBe(403);
  });
});

describe('GET /_api/kinds/convert-plan', () => {
  const Q = 'canvas=.design/ui/Kampan.tsx&artboard=ig&paper=a6';
  test('Can edit gets the plan and the Check after list from the source geometry', async () => {
    const r = await sandbox('member').plan(Q);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      measured: boolean;
      plan: { title: string; primary: string; widthPx: number };
      check: Array<{ code: string }>;
    };
    expect(body.plan.title).toBe('Make “Oznámení” an A6 print?');
    expect(body.plan.widthPx).toBe(419);
    expect(body.measured).toBe(true);
    expect(body.check.map((c) => c.code)).toEqual(['soft-image', 'crosses-cut']);
  });
  test('below Can edit it is refused; a page, an unknown paper and a missing artboard are said in words', async () => {
    expect((await sandbox('viewer').plan(Q)).status).toBe(403);
    expect((await sandbox('observer').plan(Q)).status).toBe(403);
    expect((await sandbox('member').plan(Q.replace('paper=a6', 'paper=a99'))).status).toBe(422);
    expect((await sandbox('member').plan(Q.replace('artboard=ig', 'artboard=karta'))).status).toBe(422);
    expect((await sandbox('member').plan(Q.replace('artboard=ig', 'artboard=zz'))).status).toBe(404);
  });
});
