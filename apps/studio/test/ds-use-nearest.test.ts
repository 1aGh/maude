// S10.17 (13 · ds-edge-suggest, "Use Accent"): the colour somebody picked by hand becomes the system colour — only
// that colour, only where the question named, and never a different colour if the canvas moved since.
import { describe, expect, test } from 'bun:test';

import { CanvasEditError } from '../canvas-edit.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { dsUseNearest } from '../edit-ops/ds-use-nearest.ts';
import type { ResolvedEditOp } from '../edit-ops/types.ts';

const FILE = 'ui/Pricing.tsx';
const SRC = `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';
export default () => (
  <DesignCanvas>
    <DCSection id="s" title="S">
      <DCArtboard id="a" label="Pricing" width={400} height={300}>
        <div data-cd-id="badge" style={{ background: '#3b6fe0', color: '#3b6fe0' }}>Save</div>
        <p data-cd-id="plain" style={{ color: '#3b6fe0' }}>Plain</p>
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);
`;

const req = (params: Record<string, unknown>, element = 'badge'): ResolvedEditOp => ({
  file: FILE,
  op: 'ds.use-nearest',
  targets: [{ artboard: 'a', element }],
  params,
});
const col = (line: number, needle: string, nth = 0) => {
  const text = SRC.split('\n')[line - 1];
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(needle, at + 1);
  return at + 1;
};
const ok = (over: Record<string, unknown> = {}) => ({
  literal: '#3b6fe0',
  css: '--accent',
  line: 6,
  col: col(6, '#3b6fe0'),
  ...over,
});
const refusal = (r: ResolvedEditOp) => {
  try {
    dsUseNearest.apply(SRC, r);
    return null;
  } catch (e) {
    return e instanceof CanvasEditError ? e.message : String(e);
  }
};

describe('ds.use-nearest', () => {
  test('is in the op table', () => {
    expect(EDIT_OPS.some((o) => o.id === 'ds.use-nearest')).toBe(true);
  });

  test('writes var(--token) over exactly the colour that was named', () => {
    const out = dsUseNearest.apply(SRC, req(ok())).source;
    expect(out).toContain("style={{ background: 'var(--accent)', color: '#3b6fe0' }}");
    // the same colour on the next place of the same line, and on the other element, are not touched
    expect(out.split('#3b6fe0').length - 1).toBe(2);
    expect(out.replace('var(--accent)', '#3b6fe0')).toBe(SRC);
  });

  test('the second place of the same line is addressed by its column', () => {
    const out = dsUseNearest.apply(SRC, req(ok({ col: col(6, '#3b6fe0', 1) }))).source;
    expect(out).toContain("style={{ background: '#3b6fe0', color: 'var(--accent)' }}");
  });

  test('a stale question is refused: the colour moved, or is not in the target element', () => {
    expect(refusal(req(ok({ col: 3 })))).toMatch(/no longer there/);
    expect(refusal(req(ok({ line: 7, col: col(7, '#3b6fe0') })))).toMatch(/no longer there/); // that is `plain`, not `badge`
    expect(refusal(req(ok({ literal: '#000000' })))).toMatch(/no longer there/);
    expect(refusal(req(ok(), 'nobody'))).toMatch(/not on this canvas/);
    expect(
      dsUseNearest.apply(SRC, req(ok({ line: 7, col: col(7, '#3b6fe0') }), 'plain')).source
    ).toContain('<p data-cd-id="plain" style={{ color: \'var(--accent)\' }}>');
  });

  test('only a token name and a plain colour literal are accepted', () => {
    expect(refusal(req(ok({ css: 'accent' })))).toMatch(/colour of the system/);
    expect(refusal(req(ok({ css: '--a); alert(1' })))).toMatch(/colour of the system/);
    expect(refusal(req(ok({ literal: 'var(--x)' })))).toMatch(/not a colour/);
    expect(refusal(req(ok({ line: 0 })))).toMatch(/where the colour is/);
    expect(refusal({ ...req(ok()), targets: [] })).toMatch(/Select the element/);
  });

  test('a fallback of a token is not a hand-picked colour', () => {
    const src = SRC.replace("'#3b6fe0', color", "'var(--accent, #3b6fe0)', color");
    const at = src.split('\n')[5].indexOf('#3b6fe0') + 1;
    expect(() => dsUseNearest.apply(src, req(ok({ col: at })))).toThrow(/fallback/);
  });
});
