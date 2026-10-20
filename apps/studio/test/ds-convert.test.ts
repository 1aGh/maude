// S10.12 (V2-1.6 §5.2 / §5.4 / §5.11 g; 13 · 25 ds-multi-migrate, 29 ds-edge-migrate): converting
// `system/<ds>/` folders into Design system canvases. One all-or-nothing run with its own copy;
// R0's siblings are the working CSS byte for byte (every canvas renders what it rendered); nothing a
// 1.x peer reads changes; Restore returns the system to its folder and the revisions stay.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkSystem } from '../ds/check.ts';
import { createDsConvert, DsConvertError } from '../ds/convert.ts';
import { mapSpecimens, sectionOf } from '../ds/convert-map.ts';
import { emitTokensJson, stableJson } from '../ds/emit.ts';
import { createDsEngine } from '../ds/engine.ts';
import { readHead } from '../ds/head.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { dsRenderIndex } from '../ds/render-rev.ts';
import { verifyRevision } from '../ds/revision.ts';
import { diskFs, loadSystem, systemConfigsFrom } from '../ds/system.ts';

const PERSON = { kind: 'person', name: 'Tereza' } as const;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const css = (cls: string, accent: string) => `/* ${cls} tokens */
:root,
.${cls}[data-theme="light"],
.ds[data-theme="light"] {
  --accent: ${accent};
  --fg-0: #111111;
}

.${cls}[data-theme="dark"],
.ds[data-theme="dark"] {
  --accent: oklch(0.7 0.1 140);
  --fg-0: #eeeeee;
}
`;
const COMPONENTS = '.btn {\n  border-radius: 2px;\n}\n';
const SPECIMENS = [
  'logo',
  'colors-accent',
  'type-scale',
  'spacing-scale',
  'motion',
  'components-buttons',
  'empty-state',
  'ui_kits-desktop-showcase',
];

function files(root: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = readdirSync(path.join(root, rel));
  } catch {
    return out;
  }
  for (const e of names) {
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(path.join(root, r)).isDirectory()) Object.assign(out, files(root, r));
    else out[r] = readFileSync(path.join(root, r), 'utf8');
  }
  return out;
}

/** Three folders (25): Alligators (canvases, default) · Combine 2026 (one folder) · Alligators 2023 (none). */
function makeProject(o: { groups?: { path: string }[] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-convert-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const write = (rel: string, text: string) => {
    const abs = path.join(designRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const config = {
    designSystems: [
      {
        name: 'gator',
        label: 'Alligators brand system',
        path: 'system/gator',
        rootClass: 'gator',
        themes: ['light', 'dark'],
        themeDefault: 'light',
      },
      {
        name: 'combine',
        label: 'Combine 2026',
        path: 'system/combine',
        rootClass: 'combine',
        themes: ['light', 'dark'],
        themeDefault: 'light',
      },
      {
        name: 'gator-2023',
        label: 'Alligators 2023',
        path: 'system/gator-2023',
        rootClass: 'gator',
        themes: ['light', 'dark'],
        themeDefault: 'light',
      },
    ],
    defaultDesignSystem: 'gator',
    canvasGroups: o.groups ?? [{ path: 'ui' }, { path: 'system' }],
  };
  write('config.json', `${JSON.stringify(config, null, 2)}\n`);
  write('system/gator/colors_and_type.css', css('gator', 'oklch(0.55 0.15 150)'));
  write('system/gator/preview/_components.css', COMPONENTS);
  write('system/gator/preview/_layout.css', '.x{}\n');
  for (const s of SPECIMENS)
    write(`system/gator/preview/${s}.tsx`, `export default () => <p>${s}</p>;\n`);
  write('system/gator/README.md', '# Alligators\n');
  write('system/combine/colors_and_type.css', css('combine', 'oklch(0.6 0.2 30)'));
  write('system/gator-2023/colors_and_type.css', css('gator', 'oklch(0.5 0.1 150)'));
  write('system/gator-2023/preview/_components.css', COMPONENTS);
  for (const c of ['Home', 'Landing', 'Pricing']) {
    write(`ui/${c}.tsx`, `export default () => <h1>${c}</h1>;\n`);
    write(`ui/${c}.meta.json`, `${JSON.stringify({ title: c }, null, 2)}\n`);
  }
  for (const c of ['Poster', 'Tickets']) {
    write(`ui/2026/combine/${c}.tsx`, `export default () => <h1>${c}</h1>;\n`);
    write(
      `ui/2026/combine/${c}.meta.json`,
      `${JSON.stringify({ title: c, designSystem: 'combine' }, null, 2)}\n`
    );
  }
  // gator's manifest exists (phase α, `source: "css"`) and carries a designer's label
  const idx = indexRegistry(loadRegistry());
  const sys = systemConfigsFrom(config).find((s) => s.name === 'gator');
  const manifest = JSON.parse(emitTokensJson(loadSystem(diskFs(designRoot), sys as never), idx));
  manifest.color.accent.$extensions['sh.maude'].label = 'Klubová zelená';
  write('system/gator/tokens.json', stableJson(manifest));
  const engine = createDsEngine({ designRoot, kernel: null, log: { warn() {}, error() {} } });
  let clock = Date.parse('2026-10-20T10:00:00Z');
  const eng = { ...engine, now: () => (clock += 1000) };
  return { root, designRoot, engine: eng, convert: createDsConvert(eng), write };
}

const level = (designRoot: string, name: string) => {
  const cfg = systemConfigsFrom(
    JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'))
  );
  return checkSystem(
    loadSystem(diskFs(designRoot), cfg.find((s) => s.name === name) as never),
    indexRegistry(loadRegistry())
  );
};

describe('ds convert — the specimen map (Q5)', () => {
  test('golden: this repo’s maude and maude-v2 specimens fold into 7 sections; only the desktop kits stay own', () => {
    const repo = path.resolve(import.meta.dir, '../../../.design/system');
    const golden: Record<string, unknown> = {};
    for (const ds of ['maude', 'maude-v2']) {
      const m = mapSpecimens(readdirSync(path.join(repo, ds, 'preview')));
      golden[ds] = {
        counts: Object.fromEntries(Object.entries(m.sections).map(([k, v]) => [k, v.length])),
        own: m.own.map((o) => `${o.id} · ${o.label} · ${o.src}`),
      };
    }
    expect(golden.maude).toEqual({
      counts: { brand: 2, colour: 9, type: 2, space: 5, motion: 1, components: 18, patterns: 0 },
      own: [
        'ds-own-ui-kits-desktop-index · Desktop index · preview/ui_kits-desktop-index.tsx',
        'ds-own-ui-kits-desktop-showcase · Desktop showcase · preview/ui_kits-desktop-showcase.tsx',
      ],
    });
    expect((golden['maude-v2'] as { own: string[] }).own).toEqual(
      (golden.maude as { own: string[] }).own
    );
    expect(sectionOf('textures')).toBe('brand');
    expect(sectionOf('colorsx')).toBeNull();
    expect(sectionOf('_layout')).toBe(null);
  });
});

describe('ds convert — the run', () => {
  test('dry run: per folder what it becomes, the default, the shared folder, a draft for the unused one', async () => {
    const p = makeProject();
    const before = files(p.designRoot);
    const plan = p.convert.plan();
    expect(plan.format).toBe('maude.ds-convert');
    const rows = Object.fromEntries(plan.systems.map((r) => [r.name, r]));
    expect(rows.gator).toMatchObject({
      canvases: 3,
      default: true,
      to: 'design-system',
      folder: 'ui',
      refused: null,
      specimens: 8,
    });
    expect(rows.gator.own.map((o) => o.id)).toEqual(['ds-own-ui-kits-desktop-showcase']);
    expect(rows.gator.sections.components).toEqual(['components-buttons', 'empty-state']);
    expect(rows.combine).toMatchObject({
      canvases: 2,
      default: false,
      to: 'design-system',
      folder: 'ui/2026/combine',
    });
    expect(rows['gator-2023']).toMatchObject({ canvases: 0, to: 'draft', folder: null });
    expect(files(p.designRoot)).toEqual(before); // a dry run writes nothing
  });

  test('converts every folder in one run: R0 siblings are the working CSS byte for byte; nothing a v1 peer reads changes', async () => {
    const p = makeProject();
    const before = files(p.designRoot);
    const levelBefore = level(p.designRoot, 'gator');
    const r = await p.convert.convert({ by: PERSON });
    expect(r.result.systems.map((s) => s.name).sort()).toEqual(['combine', 'gator', 'gator-2023']);
    const after = files(p.designRoot);
    for (const s of ['gator', 'combine', 'gator-2023']) {
      const dir = `system/${s}`;
      const h = readHead(path.join(p.designRoot, dir));
      expect(h.state).toBe('ok');
      if (h.state !== 'ok') continue;
      const R0 = h.doc.head as string;
      expect(h.doc.base).toBe(R0);
      expect(h.doc.log).toHaveLength(1);
      expect(h.doc.log[0]).toMatchObject({
        action: 'convert',
        rev: R0,
        actionId: null,
        by: PERSON,
        was: { head: null, base: null },
      });
      expect(verifyRevision(R0, after[`${dir}/revisions/${R0}.json`] as string).ok).toBe(true);
      // every follower renders R0's sibling — the bytes it rendered before
      expect(after[`${dir}/revisions/${R0}.tokens.css`]).toBe(before[`${dir}/colors_and_type.css`]);
      expect(after[`${dir}/revisions/${R0}.components.css`]).toBe(
        before[`${dir}/preview/_components.css`] ?? `/* ${s}: no component classes yet */\n`
      );
      expect(after[`${dir}/design-system.tsx`]).toContain(`@ds ${s}`);
      // the files a 1.x peer reads keep their bytes
      for (const [k, v] of Object.entries(before))
        if (k.startsWith(`${dir}/`) && !k.endsWith('tokens.json')) expect(after[k]).toBe(v);
      expect(
        statSync(path.join(p.designRoot, dir, 'revisions', `${R0}.components.css`)).size
      ).toBeGreaterThan(0);
    }
    // canvases elsewhere are untouched; only the systems' folders + the copy changed
    for (const [k, v] of Object.entries(before))
      if (!k.startsWith('system/')) expect(after[k]).toBe(v);
    // own artboards: the showcase kept as it is
    const src = after['system/gator/design-system.tsx'] as string;
    expect(src).toContain(
      '<DCArtboard id="ds-own-ui-kits-desktop-showcase" label="Desktop showcase" width={1440} height={900}>'
    );
    expect(src).toContain('<Specimen src="preview/ui_kits-desktop-showcase.tsx" />');
    expect(src).toContain('import { DSSection, DsBar, Specimen } from "@maude/ds/board";');
    const meta = JSON.parse(after['system/gator/design-system.meta.json'] as string);
    expect(meta).toMatchObject({ title: 'Alligators brand system', designSystem: 'gator' });
    expect(meta.layout.artboards.map((a: { id: string }) => a.id)).toContain(
      'ds-own-ui-kits-desktop-showcase'
    );
    // tokens.json is the canvas's own now, the designer's label kept; the system is no staler than before
    const tj = JSON.parse(after['system/gator/tokens.json'] as string);
    expect(tj.$extensions['sh.maude'].source).toBe('canvas');
    expect(tj.color.accent.$extensions['sh.maude'].label).toBe('Klubová zelená');
    const levelAfter = level(p.designRoot, 'gator');
    expect(levelAfter.reasons.includes('manifest-stale')).toBe(
      levelBefore.reasons.includes('manifest-stale')
    );
    // every Mac can render it: both siblings present, no gap
    const idx = dsRenderIndex(
      p.designRoot,
      ['gator', 'combine', 'gator-2023'].map((n) => ({ name: n, path: `system/${n}` })),
      {}
    );
    expect(idx.dsConverted).toEqual({ gator: true, combine: true, 'gator-2023': true });
    expect(idx.dsRevGaps).toEqual({});
    // the copy: a report naming what was created / modified, and the old tokens.json bytes
    expect(r.result.snapshot.startsWith('_history/_ds-convert/')).toBe(true);
    const snap = path.join(p.designRoot, r.result.snapshot);
    expect(readFileSync(path.join(snap, 'files/system/gator/tokens.json'), 'utf8')).toBe(
      before['system/gator/tokens.json'] as string
    );
    const report = JSON.parse(readFileSync(path.join(snap, 'report.json'), 'utf8'));
    expect(report.rolledBack).toBe(false);
    // the engine sees a converted system with nothing outside to review
    expect(p.engine.state('gator').outside).toBeNull();
    expect(p.engine.state('combine').outside).toBeNull();
  });

  test('the same folders convert to the same R0 (deterministic)', async () => {
    const a = makeProject();
    const b = makeProject();
    const ra = await a.convert.convert({ systems: ['gator'], by: PERSON });
    const rb = await b.convert.convert({
      systems: ['gator'],
      by: { kind: 'agent', name: 'Claude Code' },
    });
    expect(ra.result.systems[0].rev).toBe(rb.result.systems[0].rev);
  });

  test('refused outside the canvas folders — and then nothing is written for anyone', async () => {
    const p = makeProject({ groups: [{ path: 'ui' }] });
    const before = files(p.designRoot);
    const plan = p.convert.plan();
    expect(plan.systems.every((r) => r.refused?.code === 'ds-convert-outside')).toBe(true);
    await expect(p.convert.convert({ by: PERSON })).rejects.toMatchObject({
      code: 'ds-convert-refused',
      status: 409,
    });
    expect(files(p.designRoot)).toEqual(before);
  });

  test('one refused folder refuses the whole run (already a canvas, a canvas file in the way)', async () => {
    const p = makeProject();
    await p.convert.convert({ systems: ['combine'], by: PERSON });
    p.write('system/gator-2023/design-system.tsx', 'export default () => null;\n');
    const before = files(p.designRoot);
    const err = await p.convert
      .convert({ systems: ['gator', 'combine', 'gator-2023'], by: PERSON })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DsConvertError);
    expect(err.code).toBe('ds-convert-refused');
    const codes = Object.fromEntries(
      (err.detail.systems as { name: string; code: string }[]).map((s) => [s.name, s.code])
    );
    expect(codes).toEqual({ combine: 'ds-converted', 'gator-2023': 'ds-convert-exists' });
    expect(files(p.designRoot)).toEqual(before);
    // nothing left to convert by default once every folder is on a canvas
    rmSync(path.join(p.designRoot, 'system/gator-2023/design-system.tsx'));
    await p.convert.convert({ by: PERSON });
    await expect(p.convert.convert({ by: PERSON })).rejects.toMatchObject({
      code: 'ds-convert-nothing',
    });
  });

  test('all or nothing: a write that fails mid-run puts back every file that landed', async () => {
    const p = makeProject();
    // combine's tokens.json is a folder: its rename fails after gator's files have landed
    mkdirSync(path.join(p.designRoot, 'system/combine/tokens.json/x'), { recursive: true });
    const before = files(p.designRoot);
    const err = await p.convert
      .convert({ systems: ['gator', 'combine'], by: PERSON })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'ds-convert-failed', status: 500 });
    const after = files(p.designRoot);
    const runtime = (k: string) => k.startsWith('_history/');
    expect(Object.fromEntries(Object.entries(after).filter(([k]) => !runtime(k)))).toEqual(before);
    expect(readHead(path.join(p.designRoot, 'system/gator')).state).toBe('absent');
    const snap = readdirSync(path.join(p.designRoot, '_history/_ds-convert'));
    const report = JSON.parse(
      readFileSync(path.join(p.designRoot, '_history/_ds-convert', snap[0], 'report.json'), 'utf8')
    );
    expect(report.rolledBack).toBe(true);
  });
});

describe('ds convert — Restore (β → α)', () => {
  test('Restore puts the folder back: head.json and the canvas go to the trash, tokens.json is the folder’s own, revisions stay', async () => {
    const p = makeProject();
    const before = files(p.designRoot);
    const r = await p.convert.convert({ systems: ['gator'], by: PERSON });
    const R0 = r.result.systems[0].rev;
    const back = await p.convert.restore({ ds: 'gator', by: PERSON });
    expect(back).toMatchObject({ action: 'restore', system: 'gator' });
    expect(back.moved.sort()).toEqual([
      'design-system.meta.json',
      'design-system.tsx',
      'revisions/head.json',
    ]);
    expect(readHead(path.join(p.designRoot, 'system/gator')).state).toBe('absent');
    const after = files(p.designRoot);
    for (const [k, v] of Object.entries(before)) expect(after[k]).toBe(v); // tokens.json too: source css again
    expect(after[`system/gator/revisions/${R0}.json`]).toBeDefined(); // unreferenced, kept
    expect(after[`${back.trash}/design-system.tsx`]).toContain('@ds gator');
    expect(p.engine.state('gator').converted).toBe(false);
    // and it converts again to the very same revision
    const again = await p.convert.convert({ systems: ['gator'], by: PERSON });
    expect(again.result.systems[0].rev).toBe(R0);
  });

  test('Restore refuses while changes wait on the Design system canvas, and for a folder', async () => {
    const p = makeProject();
    await expect(p.convert.restore({ ds: 'gator', by: PERSON })).rejects.toMatchObject({
      code: 'ds-not-converted',
    });
    await p.convert.convert({ systems: ['gator'], by: PERSON });
    const metaRel = 'system/gator/design-system.meta.json';
    const meta = JSON.parse(readFileSync(path.join(p.designRoot, metaRel), 'utf8'));
    meta.dsPending = { tokens: { '--accent': { light: 'red', dark: 'red' } } };
    p.write(metaRel, `${JSON.stringify(meta, null, 2)}\n`);
    await expect(p.convert.restore({ ds: 'gator', by: PERSON })).rejects.toMatchObject({
      code: 'ds-pending-waiting',
      status: 409,
    });
    expect(existsSync(path.join(p.designRoot, 'system/gator/revisions/head.json'))).toBe(true);
  });
});
