// S6.1 — the blank template: parses, renders zero artboards, and is capture-safe.

import { describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { BLANK_TEMPLATE, componentNameFrom, renderBlankCanvas } from '../canvas-create.ts';
import { DCArtboard } from '../canvas-lib.tsx';

const rendered = (name = 'Untitled canvas') =>
  renderBlankCanvas({
    name,
    componentName: componentNameFrom(name),
    dsName: 'project',
    platform: 'desktop',
    historyDir: '.design/_history/ui-untitled_canvas',
  });

describe('blank canvas template', () => {
  test('no placeholder is left, and the component is named from the canvas', () => {
    const out = rendered('Untitled canvas 2');
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(out).toContain('export default function UntitledCanvas2()');
    expect(out).toContain('@canvas      Untitled canvas 2');
  });

  test('it parses as TSX', () => {
    const t = new Bun.Transpiler({ loader: 'tsx' });
    expect(() => t.transformSync(rendered())).not.toThrow();
  });

  test('it holds no artboard and no section', () => {
    const body = BLANK_TEMPLATE.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/<DCArtboard|<DCSection/);
    expect(body).toContain('<DesignCanvas>');
  });

  test('capture-safe: imports the canvas library and nothing else; no scripts, fetches or handlers', () => {
    const imports = [...rendered().matchAll(/^[ \t]*import\b.*$/gm)].map((m) => m[0]);
    expect(imports).toEqual(['import { DesignCanvas } from "@maude/canvas-lib";']);
    const code = rendered().replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of [
      'fetch(',
      '<script',
      'eval(',
      'XMLHttpRequest',
      'WebSocket',
      'onClick',
      'dangerouslySetInnerHTML',
    ]) {
      expect(code).not.toContain(bad);
    }
  });

  test('it renders with zero artboards (and the same walk does find one when there is one)', async () => {
    // A full DesignCanvas needs a layout pass (DOM), so walk the element tree the component returns,
    // the way canvas-lib's own harvest does: every DCArtboard under the DesignCanvas.
    const lib = resolve(import.meta.dir, '..', 'canvas-lib.tsx');
    const blank = await elementOf(rendered(), lib);
    expect(blank.type).toBe((await import('../canvas-lib.tsx')).DesignCanvas);
    expect(artboardsIn(blank)).toBe(0);
    const withOne = await elementOf(
      rendered()
        .replace('import { DesignCanvas }', 'import { DCArtboard, DCSection, DesignCanvas }')
        .replace(
          /\{\/\* Empty[^*]*\*\/\}/,
          '<DCSection id="s" title="S"><DCArtboard id="a" label="A" width={100} height={100}><div /></DCArtboard></DCSection>'
        ),
      lib
    );
    expect(artboardsIn(withOne)).toBe(1); // the control: the walk is not blind
  });
});

/** Write the rendered template INSIDE the test folder (so `react` resolves), import it, call it. */
async function elementOf(source: string, lib: string): Promise<ReactElement> {
  const file = join(import.meta.dir, `_blank-canvas-${process.pid}-${Date.now()}.tsx`);
  writeFileSync(file, source.replace('"@maude/canvas-lib"', JSON.stringify(lib)));
  try {
    const mod = (await import(file)) as { default: () => ReactElement };
    return mod.default();
  } finally {
    rmSync(file, { force: true });
  }
}

function artboardsIn(node: unknown): number {
  if (!isValidElement(node)) return 0;
  const own = node.type === DCArtboard ? 1 : 0;
  let n = own;
  Children.forEach((node.props as { children?: ReactNode }).children, (c) => {
    n += artboardsIn(c);
  });
  return n;
}
