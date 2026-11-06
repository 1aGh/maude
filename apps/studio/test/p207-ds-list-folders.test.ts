// 2.0.7 #1b — a system the config does not list is a system in every list, and a pin reaches it.
//
// A cell's `config.json` never travels on the file plane, so a design system converted on a desktop can
// be on the cell as files only: `system/b/` with its own Design system canvas, while the config still
// lists only `a`. #1 (p207-folder-owned-ds) made that folder own its own canvases. Left open:
//   - `/_api/ds`, `/_config` (the Design system panel) and the left panel's rows still listed `a` only;
//   - a `ui/` canvas whose `.meta.json` pins `b` rendered with the default system `a`.
// Now one merged list — the configured systems, then the folder-owned ones (ds/folder-systems.ts) — is
// the source for every list and for pin resolution. A pin to a name with no folder (`c`) stays at the
// default, and a folder without its Design system canvas (`system/project`) is no system.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { projectVisibility } from '../access/filters.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { canvasUrl } from '../client/canvas-url.js';
import { dsPinnedRows } from '../client/v2/left-panel/left-panel-model.js';
import { createBus, loadConfig } from '../context.ts';
import { designSystemCanvasSource } from '../ds/board/template.ts';
import { canvasSystemFor, dsDepsFor } from '../ds/ds-resolver.ts';
import { createDsEngine } from '../ds/engine.ts';
import { runDsOp } from '../routes/ds.ts';
import { bootServer, killProc, nextPort } from './_helpers.ts';

const THEMED_CSS = (cls: string) =>
  `.${cls}[data-theme="dark"], .ds[data-theme="dark"] { --bg-0: #000; }\n.${cls}[data-theme="light"], .ds[data-theme="light"] { --bg-0: #fff; }\n`;
const CANVAS =
  "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n";

// The cell's config.json: it knows only system `a` (the default).
const CELL_CONFIG = {
  name: 'cell',
  designRoot: '.design',
  formatVersion: 2,
  canvasGroups: [
    { label: 'Design system', path: 'system' },
    { label: 'UI', path: 'ui' },
  ],
  designSystems: [{ name: 'a', path: 'system/a', themeDefault: 'dark', themes: ['dark', 'light'] }],
  defaultDesignSystem: 'a',
};

const FILES: Record<string, string> = {
  'system/a/design-system.tsx': designSystemCanvasSource('a', 'A', []),
  'system/a/design-system.meta.json': '{"designSystem":"a"}',
  'system/a/colors_and_type.css': THEMED_CSS('a'),
  'system/b/design-system.tsx': designSystemCanvasSource('b', 'B', []),
  'system/b/design-system.meta.json': '{"designSystem":"b"}',
  'system/b/colors_and_type.css': THEMED_CSS('b'),
  // a legacy folder: tokens, no Design system canvas — not a system
  'system/project/colors_and_type.css': THEMED_CSS('project'),
  'system/project/preview/card.tsx': 'export default () => <p>card</p>;\n',
  // runtime-named folders never are
  'system/_draft/design-system.tsx': designSystemCanvasSource('_draft', 'D', []),
  'ui/home.tsx': CANVAS,
  'ui/home.meta.json': '{}',
  'ui/pinned-b.tsx': CANVAS,
  'ui/pinned-b.meta.json': '{"designSystem":"b"}',
  'ui/pinned-c.tsx': CANVAS,
  'ui/pinned-c.meta.json': '{"designSystem":"c"}',
};

function writeProject(root: string, extra: Record<string, string> = {}) {
  const designRoot = join(root, '.design');
  const all = { ...FILES, 'config.json': JSON.stringify(CELL_CONFIG), ...extra };
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  return designRoot;
}

function withProject(
  fn: (designRoot: string, root: string) => void | Promise<void>,
  extra: Record<string, string> = {}
) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), 'p207-ds-list-'));
    try {
      await fn(writeProject(root, extra), root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

const OWNER = resolveAccess({ v: 1, role: 'owner' });

describe('one merged list: the configured systems, then the folder-owned ones', () => {
  test(
    'the studio config lists both, b with its themes; project and _draft are not systems',
    withProject((_designRoot, root) => {
      const cfg = loadConfig(root);
      expect((cfg.designSystems ?? []).map((d) => d.name)).toEqual(['a', 'b']);
      const b = cfg.designSystems?.find((d) => d.name === 'b');
      expect(b?.path).toBe('system/b');
      expect(b?.tokensCssRel).toBe('system/b/colors_and_type.css');
      expect(b?.themes).toEqual(['dark', 'light']);
      expect(b?.rootClass).toBe('b');
      // the default is unchanged: the first configured system
      expect(cfg.defaultDesignSystem).toBe('a');
      expect(cfg.designSystems?.[0]?.name).toBe('a');
    })
  );

  test(
    '/_api/ds (state) lists both',
    withProject(async (designRoot) => {
      const engine = createDsEngine({ designRoot, kernel: null, log: { warn() {}, error() {} } });
      const r = await runDsOp(
        'state',
        {},
        {
          engine,
          outside: null,
          usage: null,
          access: OWNER,
          by: { kind: 'person', name: 'T' },
        }
      );
      expect(r.status).toBe(200);
      const names = (r.body as { systems: Array<{ name: string }> }).systems.map((s) => s.name);
      expect(names).toEqual(['a', 'b']);
      const one = await runDsOp(
        'state',
        { ds: 'b' },
        { engine, outside: null, usage: null, access: OWNER, by: { kind: 'person', name: 'T' } }
      );
      expect(one.status).toBe(200);
      const none = await runDsOp(
        'state',
        { ds: 'project' },
        { engine, outside: null, usage: null, access: OWNER, by: { kind: 'person', name: 'T' } }
      );
      expect(none.status).toBe(404);
    })
  );

  test(
    'a ui/ canvas pinned to b renders with b; a pin to c (no folder) stays at the default',
    withProject((designRoot) => {
      expect(canvasSystemFor(designRoot, join(designRoot, 'ui/pinned-b.tsx'))?.tokensCssRel).toBe(
        'system/b/colors_and_type.css'
      );
      expect(canvasSystemFor(designRoot, join(designRoot, 'ui/pinned-c.tsx'))?.name).toBe('a');
      expect(canvasSystemFor(designRoot, join(designRoot, 'ui/home.tsx'))?.name).toBe('a');
    })
  );

  test(
    "the closure of a canvas pinned to b reads b's tokens, never a's; c reads the default's",
    withProject((designRoot, root) => {
      const ctx = {
        paths: { designRoot, designRel: '.design', repoRoot: root },
        bus: createBus(),
        cfg: CELL_CONFIG,
      } as unknown as Parameters<typeof projectVisibility>[0];
      const v = projectVisibility(ctx);
      const frame = (c: string) => narrowToFrame(OWNER, [c]);
      const b = v.closureOf(frame('ui/pinned-b.tsx'));
      expect(b?.read.has('system/b/colors_and_type.css')).toBe(true);
      expect(b?.read.has('system/a/colors_and_type.css')).toBe(false);
      const c = v.closureOf(frame('ui/pinned-c.tsx'));
      expect(c?.read.has('system/a/colors_and_type.css')).toBe(true);
      expect(c?.read.has('system/b/colors_and_type.css')).toBe(false);
    })
  );

  test(
    "a pin to a name the config does not list rebuilds when that folder's Design system canvas arrives",
    withProject((designRoot) => {
      const uses = "import { Button } from '@maude/ds';\nexport default () => <Button />;\n";
      const deps = (c: string) => dsDepsFor(uses, join(designRoot, c), designRoot);
      expect(deps('ui/pinned-c.tsx')).toContain(join(designRoot, 'system/c/design-system.tsx'));
      // a configured pin needs no such dep
      expect(deps('ui/home.tsx').some((d) => d.endsWith('design-system.tsx'))).toBe(false);
    })
  );
});

describe('the running studio lists b and frames a canvas pinned to it with b', () => {
  let root = '';
  let proc: Subprocess | null = null;
  let base = '';
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'p207-ds-list-srv-'));
    writeProject(root);
    const port = nextPort();
    proc = await bootServer(root, port);
    base = `http://localhost:${port}`;
  });
  afterAll(async () => {
    if (proc) await killProc(proc);
    rmSync(root, { recursive: true, force: true });
  });

  const getJson = async (p: string) => {
    const r = await fetch(`${base}${p}`);
    expect(r.status).toBe(200);
    return (await r.json()) as Record<string, unknown>;
  };

  test('/_api/ds/state, /_config and the left panel rows list both systems', async () => {
    const ds = await getJson('/_api/ds/state');
    expect((ds.systems as Array<{ name: string }>).map((s) => s.name)).toEqual(['a', 'b']);
    const cfg = await getJson('/_config');
    const systems = cfg.designSystems as Array<{ name: string }>;
    expect(systems.map((d) => d.name)).toEqual(['a', 'b']);
    const index = await getJson('/_index-data');
    const rows = dsPinnedRows(index.groups as unknown[], {
      designSystems: systems,
      canvasDesignSystems: index.canvasDesignSystems as Record<string, string>,
      defaultDs: (cfg.defaultDesignSystem as string) ?? null,
      designRel: '.design',
    }) as Array<{ dsName: string; isDefault?: boolean }>;
    expect(rows.map((r) => r.dsName)).toEqual(['a', 'b']);
    expect(rows.find((r) => r.dsName === 'a')?.isDefault).toBe(true);
    expect(rows.find((r) => r.dsName === 'b')?.isDefault).toBeFalsy();
  });

  test('a system folder arriving after boot (a cell gets it as files) joins the list live', async () => {
    const dir = join(root, '.design', 'system', 'late');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'colors_and_type.css'), THEMED_CSS('late'));
    writeFileSync(join(dir, 'design-system.tsx'), designSystemCanvasSource('late', 'Late', []));
    let names: string[] = [];
    for (let i = 0; i < 60 && !names.includes('late'); i++) {
      await Bun.sleep(100);
      const cfg = await getJson('/_config');
      names = (cfg.designSystems as Array<{ name: string }>).map((d) => d.name);
    }
    expect(names).toEqual(['a', 'b', 'late']);
  });

  test("the shell frames ui/pinned-b with b's tokens, ui/pinned-c with the default's", async () => {
    const cfg = await getJson('/_config');
    const index = await getJson('/_index-data');
    const shellCfg = { ...cfg, canvasDesignSystems: index.canvasDesignSystems };
    const tokens = (p: string) =>
      new URL(canvasUrl(p, shellCfg), 'http://x').searchParams.get('tokens');
    expect(tokens('.design/ui/pinned-b.tsx')).toBe('system/b/colors_and_type.css');
    expect(tokens('.design/ui/pinned-c.tsx')).toBe('system/a/colors_and_type.css');
    expect(tokens('.design/ui/home.tsx')).toBe('system/a/colors_and_type.css');
  });
});
