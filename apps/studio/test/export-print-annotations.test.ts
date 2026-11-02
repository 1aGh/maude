// S4.16 (an-print) — "Print files never carry annotations", checked by the SERVER, not by the export sheet.
// The sheet (S8) greys Include annotations for a print format; a request that sets `includeAnnotations`
// anyway (a stale tab, a script, the legacy options bag) must still produce a file without the layer.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportContext, ExportResult } from '../exporters/index.ts';
import { runExport } from '../exporters/index.ts';
import type { Target } from '../exporters/scope.ts';
import { annotationsExportPolicy, enforceAnnotationsPolicy } from '../exporters/scope.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A repo with `.design/ui/{flyer,site}.tsx`; the flyer has a print artboard. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'maude-print-annot-'));
  roots.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'ui', 'flyer.tsx'),
    `export default () => (<DesignCanvas><DCSection id="s">
  <DCArtboard id="front" label="A6" width={298} height={420} kind="print" print={{ w: 105, h: 148, bleed: 3, unit: "mm" }}><p>x</p></DCArtboard>
</DCSection></DesignCanvas>);\n`
  );
  writeFileSync(
    join(designRoot, 'ui', 'site.tsx'),
    `export default () => (<DesignCanvas><DCSection id="s">
  <DCArtboard id="home" label="Home" width={1440} height={900}><p>x</p></DCArtboard>
</DCSection></DesignCanvas>);\n`
  );
  return { root, designRoot };
}

const el = (file: string, annotations: boolean): Target => ({
  kind: 'element',
  cssPath: '[data-dc-screen]',
  canvasSlug: file.replace(/^.*\//, '').replace('.tsx', ''),
  file,
  region: 'canvas',
  annotations,
});
const annotated = (t: Target[]) => t.map((x) => (x.kind === 'element' ? !!x.annotations : null));

describe('annotationsExportPolicy (the same answer the sheet and the server read)', () => {
  test('print PDFs and every temporal / bundled format never; screens optional', () => {
    expect(annotationsExportPolicy('pdf', { kind: 'print' })).toBe('never');
    expect(annotationsExportPolicy('pdf', { print: true })).toBe('never');
    for (const f of ['mp4', 'webm', 'gif', 'zip', 'pptx', 'canva'] as const)
      expect(annotationsExportPolicy(f)).toBe('never');
    expect(annotationsExportPolicy('pdf')).toBe('optional');
    expect(annotationsExportPolicy('png')).toBe('optional');
  });
});

describe('enforceAnnotationsPolicy — the server strips the layer from a target it must not carry', () => {
  test('a PDF with print options drops the layer even when the request opted in', () => {
    const { designRoot } = repo();
    const out = enforceAnnotationsPolicy(
      [el('.design/ui/site.tsx', true)],
      'pdf',
      { pdfPrint: { bleedMm: 3 } },
      designRoot
    );
    expect(annotated(out)).toEqual([false]);
  });

  test('a PDF of a canvas that has a print artboard drops it with no print option at all', () => {
    const { designRoot } = repo();
    const out = enforceAnnotationsPolicy([el('.design/ui/flyer.tsx', true)], 'pdf', {}, designRoot);
    expect(annotated(out)).toEqual([false]);
  });

  test('a review copy stays possible: a screen canvas as PDF, or a PNG of the flyer, keeps what was asked', () => {
    const { designRoot } = repo();
    expect(
      annotated(enforceAnnotationsPolicy([el('.design/ui/site.tsx', true)], 'pdf', {}, designRoot))
    ).toEqual([true]);
    expect(
      annotated(enforceAnnotationsPolicy([el('.design/ui/flyer.tsx', true)], 'png', {}, designRoot))
    ).toEqual([true]);
    expect(
      annotated(
        enforceAnnotationsPolicy(
          [el('.design/ui/site.tsx', false)],
          'pdf',
          { pdfPrint: {} },
          designRoot
        )
      )
    ).toEqual([false]);
  });

  test('temporal and bundled formats never carry it, and a file tree passes through untouched', () => {
    const { designRoot } = repo();
    for (const f of ['mp4', 'webm', 'gif', 'pptx', 'canva']) {
      expect(
        annotated(enforceAnnotationsPolicy([el('.design/ui/site.tsx', true)], f, {}, designRoot))
      ).toEqual([false]);
    }
    const tree: Target[] = [{ kind: 'file-tree', paths: ['ui/site.tsx'] }];
    expect(enforceAnnotationsPolicy(tree, 'zip', {}, designRoot)).toBe(tree);
  });

  test('an unreadable canvas file is treated as plain screens, not as a crash', () => {
    const { designRoot } = repo();
    const out = enforceAnnotationsPolicy(
      [el('.design/ui/missing.tsx', true)],
      'pdf',
      {},
      designRoot
    );
    expect(annotated(out)).toEqual([true]);
  });
});

describe('runExport — the one door every export goes through', () => {
  test('the adapter receives targets without the layer for a print PDF, with it for a PNG', async () => {
    const { root, designRoot } = repo();
    const seen: Target[][] = [];
    const adapter = {
      run: async (targets: Target[]): Promise<ExportResult> => {
        seen.push(targets);
        return { filename: 'x', contentType: 'application/octet-stream', body: new Uint8Array() };
      },
    };
    const ctx: ExportContext = { designRoot, repoRoot: root, serverOrigin: 'http://localhost:1' };
    const resolve = {
      activeJson: { active: '.design/ui/flyer.tsx', selected: null },
      designRoot,
    };
    await runExport({
      format: 'pdf',
      scope: 'canvas-whole',
      options: { includeAnnotations: true, pdfPrint: {} },
      resolve,
      ctx,
      adapter,
    });
    await runExport({
      format: 'png',
      scope: 'canvas-whole',
      options: { includeAnnotations: true },
      resolve,
      ctx,
      adapter,
    });
    expect(annotated(seen[0] ?? [])).toEqual([false]);
    expect(annotated(seen[1] ?? [])).toEqual([true]);
  });
});
