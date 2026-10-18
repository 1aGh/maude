// S10.6 — `@maude/ds/board` through the real canvas build: the generated module registers the
// system's model, inlines the board CSS, imports the specimens the canvas names (and only those
// inside the system's folder), is a cache dep of the canvas, and the template is clean under
// `ds-check` canvas mode.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildCanvasModule } from '../canvas-build.ts';
import { designSystemCanvasSource } from '../ds/board/template.ts';
import { checkCanvas } from '../ds/canvas-check.ts';
import { canvasContext } from '../ds/canvas-cli.ts';
import { loadProject } from '../ds/cli.ts';
import { dsDepsFor, importsDs, importsDsBoard, specimenFiles, usesDs } from '../ds/ds-resolver.ts';
import { systemConfigsFrom } from '../ds/system.ts';

const root = mkdtempSync(join(tmpdir(), 'ds-board-build-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const CONFIG = {
  designSystems: [
    {
      name: 'acme',
      path: 'system/acme',
      themes: ['light', 'dark'],
      themeDefault: 'light',
      rootClass: 'acme',
    },
  ],
  defaultDesignSystem: 'acme',
  canvasGroups: [{ path: 'ui' }, { path: 'system' }],
};
put('config.json', JSON.stringify(CONFIG));
put(
  'system/acme/colors_and_type.css',
  `:root,\n.acme[data-theme="light"],\n.ds[data-theme="light"] {\n  --bg-0: #fff;\n  --fg-0: #111;\n  --accent: oklch(0.55 0.2 255);\n  --radius-md: 8px;\n}\n.acme[data-theme="dark"],\n.ds[data-theme="dark"] {\n  --bg-0: #111;\n  --fg-0: #eee;\n  --accent: oklch(0.65 0.2 255);\n}\n`
);
put(
  'system/acme/tokens.json',
  JSON.stringify({
    $extensions: {
      'sh.maude': { system: 'acme', label: 'Acme system', themes: ['light', 'dark'] },
    },
  })
);
put('system/acme/design-system.tsx', designSystemCanvasSource('acme', 'Acme system'));
put('system/acme/design-system.meta.json', JSON.stringify({ designSystem: 'acme' }));
put(
  'system/acme/preview/colors-accent.tsx',
  'export default function Spec() { return <p className="spec-marker-3f9a">accent specimen</p>; }\n'
);
const DS_TSX = join(root, 'system/acme/design-system.tsx');

const build = (rel: string, source?: string) =>
  buildCanvasModule(join(root, rel), source ?? readFileSync(join(root, rel), 'utf8'), {
    designRoot: root,
    restrictImportsTo: root,
  });

describe('@maude/ds/board through the canvas build', () => {
  test('specifier detection is exact: the board is not `@maude/ds`', () => {
    const board = 'import { DSSection } from "@maude/ds/board";\n';
    expect(importsDsBoard(board)).toBe(true);
    expect(importsDs(board)).toBe(false);
    expect(usesDs(board)).toBe(true);
    expect(usesDs('import { Button } from "@maude/ds";\n')).toBe(true);
    expect(usesDs('import x from "@maude/dsx";\n')).toBe(false);
  });

  test('the template builds: the model is registered, the CSS is inlined, no dev specifier is left', async () => {
    const out = (await build('system/acme/design-system.tsx')).js;
    expect(out).not.toMatch(/from\s*["']@maude\/ds\/board["']/);
    expect(out).toContain('maude.ds-board');
    expect(out).toContain('Acme system');
    expect(out).toContain('"--accent"');
    expect(out).toContain('.ds-chip'); // board.css rides in the canvas bundle
    expect(out).toContain('ds-brand');
    expect(out).toContain('ds-patterns');
  });

  test('a specimen the canvas names is imported; one outside the system folder is not', async () => {
    const src =
      readFileSync(DS_TSX, 'utf8') +
      '\nconst _a = <Specimen src="preview/colors-accent.tsx" />;\nconst _b = <Specimen src="../../ui/secret.tsx" />;\nconst _c = <Specimen src="preview/nope.tsx" />;\n';
    put('ui/secret.tsx', 'export default () => <i>secret-marker-77</i>;\n');
    const sys = systemConfigsFrom(CONFIG)[0];
    expect(specimenFiles(root, sys, src).map((s) => s.src)).toEqual(['preview/colors-accent.tsx']);
    const withSpec = src.replace(
      'import { DSSection, DsBar }',
      'import { DSSection, DsBar, Specimen }'
    );
    put('system/acme/spec-canvas.tsx', withSpec);
    put('system/acme/spec-canvas.meta.json', JSON.stringify({ designSystem: 'acme' }));
    const out = (await build('system/acme/spec-canvas.tsx')).js;
    expect(out).toContain('spec-marker-3f9a');
    expect(out).not.toContain('secret-marker-77');
  });

  test('cache deps: a pending edit, the tokens, the usage cache and the specimens rebuild the canvas', () => {
    const src = `${readFileSync(DS_TSX, 'utf8')}\nconst _a = <Specimen src="preview/colors-accent.tsx" />;\n`;
    const deps = dsDepsFor(src, DS_TSX, root);
    for (const rel of [
      'system/acme/design-system.meta.json',
      'system/acme/colors_and_type.css',
      'system/acme/tokens.json',
      'system/acme/components.json',
      'system/acme/revisions/head.json',
      '_cache/index/ds-usage.json',
      'system/acme/preview/colors-accent.tsx',
      'config.json',
    ])
      expect(deps).toContain(join(root, rel));
    // not a board canvas → not these deps
    expect(dsDepsFor('export default () => null;\n', DS_TSX, root)).toEqual([]);
  });

  test('ds-check canvas mode is clean on the template', () => {
    const ctx = canvasContext(loadProject(root, {}));
    const report = checkCanvas(ctx, 'system/acme/design-system.tsx');
    expect(report.findings).toEqual([]);
    expect(report.state).not.toBe('blocked');
  });

  test('the template survives a hostile label', () => {
    const src = designSystemCanvasSource('acme', '*/ evil(); /* <script> {x}');
    expect(src).not.toContain('evil(); /*');
    expect(src.match(/\/\*\*/g)?.length).toBe(1);
    expect(src).toContain('@ds acme');
  });
});
