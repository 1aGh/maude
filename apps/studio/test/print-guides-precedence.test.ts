// S7.23 / Gate 0 C25 — print guides: View › Advanced › Print guides is the default for every print artboard, and the
// per-artboard switch in the print inspector overrides it, either way. Three layers pinned here: the rule (pure), the
// canvas drawing it (the real overlay), and the write (the one dispatch route's two ops).

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArtboardGuidesOverlay } from '../artboard-guides-overlay.tsx';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { effectivePrintGuides, printGuidesOverride } from '../kinds/print-guides.ts';
import '../print-overlay-content.tsx';

const RECT = { x: 0, y: 0, w: 419, h: 581 };
const A6 = { paper: 'a6', orientation: 'portrait', bleedMm: 3 };

// the mount's own wrapper is one absolute div; the bleed, trim and margin lines are the rest
const draws = (print: Record<string, unknown>, viewPrint: boolean) =>
  (
    renderToStaticMarkup(
      createElement(ArtboardGuidesOverlay, {
        rect: RECT,
        kind: 'print',
        print,
        visibility: { print: viewPrint },
      })
    ).match(/position:absolute/g) ?? []
  ).length > 1;

describe('C25 — the rule', () => {
  test('no override follows View, either way', () => {
    expect(printGuidesOverride(A6)).toBeNull();
    expect(effectivePrintGuides(A6, true)).toBe(true);
    expect(effectivePrintGuides(A6, false)).toBe(false);
  });
  test('the artboard’s own switch wins over View, both ways', () => {
    expect(effectivePrintGuides({ ...A6, showGuides: true }, false)).toBe(true);
    expect(effectivePrintGuides({ ...A6, showGuides: false }, true)).toBe(false);
  });
  test('anything that is not a boolean is no override', () => {
    expect(printGuidesOverride({ ...A6, showGuides: 'yes' })).toBeNull();
    expect(printGuidesOverride(null)).toBeNull();
    expect(printGuidesOverride('a6')).toBeNull();
  });
});

describe('C25 — what the canvas draws', () => {
  test('View on, no override: drawn', () => {
    expect(draws(A6, true)).toBe(true);
  });
  test('View off, no override: nothing', () => {
    expect(draws(A6, false)).toBe(false);
  });
  test('View off, this artboard’s switch on: drawn', () => {
    expect(draws({ ...A6, showGuides: true }, false)).toBe(true);
  });
  test('View on, this artboard’s switch off: not drawn', () => {
    expect(draws({ ...A6, showGuides: false }, true)).toBe(false);
  });
});

const FILE = 'ui/Letak.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Letak() {
  return (
    <DesignCanvas>
      <DCArtboard id="a" label="A · přední" width={419} height={581} kind="print" print={{"paper":"a6","orientation":"portrait","bleedMm":3}}>
        <p>Leták</p>
      </DCArtboard>
      <DCArtboard id="web" label="Nábor" width={834} height={581} kind="web">
        <p>Web</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([[FILE, SRC]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: () => null,
    heldArtboard: () => null,
    log: createWriteLog(),
  };
  return {
    files,
    run: (artboard: string, visible: unknown) =>
      dispatchEditOp(
        {
          file: FILE,
          op: 'artboard.set-print-guides',
          targets: [],
          params: { artboard, visible },
        },
        deps
      ),
  };
}

describe('C25 — artboard.set-print-guides', () => {
  test('on writes print.showGuides and nothing else; off flips it; null follows View again', async () => {
    const h = harness();
    expect((await h.run('a', true)).ok).toBe(true);
    const on = h.files.get(FILE) ?? '';
    expect(on).toContain('"showGuides":true');
    expect(on).toContain('"paper":"a6"');
    expect(on).toContain('width={419} height={581}');
    expect((await h.run('a', false)).ok).toBe(true);
    expect(h.files.get(FILE)).toContain('"showGuides":false');
    expect((await h.run('a', null)).ok).toBe(true);
    expect(h.files.get(FILE)).toBe(
      SRC.replace(
        '{"paper":"a6","orientation":"portrait","bleedMm":3}',
        '{"paper":"a6","orientation":"portrait","bleedMm":3}'
      )
    );
  });
  test('a web page has no paper: refused in words, file untouched', async () => {
    const h = harness();
    const r = await h.run('web', true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('not a print artboard');
    expect(h.files.get(FILE)).toBe(SRC);
  });
  test('a value that is neither on, off nor null is refused', async () => {
    const h = harness();
    const r = await h.run('a', 'sometimes');
    expect(r.ok).toBe(false);
    expect(h.files.get(FILE)).toBe(SRC);
  });
});
