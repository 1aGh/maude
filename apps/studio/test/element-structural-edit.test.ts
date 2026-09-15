// canvas-edit.ts — Stage I (feature-element-editing-robustness). Structural
// element edits: delete / insert / new-artboard + free-hand artboard resize
// (D4). Round-trips ids through transpileCanvasSource the same way
// canvas-edit.test.ts does, so the positional data-cd-id arithmetic stays in
// lockstep with the pipeline.

import { describe, expect, test } from 'bun:test';

import {
  applyDeleteElement,
  applyDuplicateArtboard,
  applyInsertArtboard,
  applyInsertElement,
  applyInsertElementIntoArtboard,
  applyResizeArtboard,
  applySetArtboardGuides,
  applySetArtboardHug,
  applySetArtboardKind,
  applySetArtboardLabel,
  applySetArtboardPrint,
  applySetArtboardStyle,
  CanvasEditError,
  readArtboardPrintProp,
} from '../canvas-edit.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';

const CANVAS = '/abs/Canvas.tsx';

/** Map data-cd-id by element-type name (first occurrence), like canvas-edit.test.ts. */
function idsOf(source: string): Record<string, string> {
  const { withIds } = transpileCanvasSource(CANVAS, source);
  const out: Record<string, string> = {};
  for (const m of withIds.matchAll(/<(\w+)([^>]*?)data-cd-id="([0-9a-f]{8})"/g)) {
    if (!out[m[1] as string]) out[m[1] as string] = m[3] as string;
  }
  return out;
}

/** Parse-clean assertion — a structural edit must never emit invalid source. */
function parses(source: string): boolean {
  try {
    transpileCanvasSource(CANVAS, source);
    return true;
  } catch {
    return false;
  }
}

describe('canvas-edit / applyDeleteElement', () => {
  test('removes the target element and leaves valid source', () => {
    const src = [
      'function Demo() {',
      '  return (',
      '    <section>',
      '      <button>Keep</button>',
      '      <span>Drop</span>',
      '    </section>',
      '  );',
      '}',
    ].join('\n');
    const id = idsOf(src).span as string;
    const out = applyDeleteElement(CANVAS, src, id);
    expect(out.source).not.toContain('<span>Drop</span>');
    expect(out.source).toContain('<button>Keep</button>');
    expect(parses(out.source)).toBe(true);
    // No blank line left behind (framed span removed the leading newline+indent).
    expect(out.source).not.toMatch(/\n\s*\n\s*<\/section>/);
  });

  test('reparse gate rejects a delete that would break JSX (sole parenthesized return)', () => {
    // Deleting the only element of `return ( … )` leaves `return ();` — invalid.
    const src = 'function Demo() { return (<span>x</span>); }';
    const id = idsOf(src).span as string;
    expect(() => applyDeleteElement(CANVAS, src, id)).toThrow(CanvasEditError);
  });

  test('unknown id throws', () => {
    const src = 'function Demo() { return <div>x</div>; }';
    expect(() => applyDeleteElement(CANVAS, src, 'deadbeef')).toThrow(CanvasEditError);
  });

  test('shared-component instance delete targets the specific usage', () => {
    const src = [
      'function Card() { return <article>card</article>; }',
      'function Demo() {',
      '  return (',
      '    <section>',
      '      <Card />',
      '      <Card />',
      '      <Card />',
      '    </section>',
      '  );',
      '}',
    ].join('\n');
    // The inner <article> id is shared across all three <Card/> usages.
    const innerId = idsOf(src).article as string;
    const out = applyDeleteElement(CANVAS, src, innerId, 1); // delete the 2nd usage
    // Exactly one <Card /> usage removed, two remain.
    expect(out.source.match(/<Card \/>/g)?.length).toBe(2);
    // The component definition is untouched.
    expect(out.source).toContain('function Card()');
    expect(parses(out.source)).toBe(true);
  });
});

describe('canvas-edit / applyInsertElement', () => {
  const base = [
    'function Demo() {',
    '  return (',
    '    <section>',
    '      <button>Anchor</button>',
    '    </section>',
    '  );',
    '}',
  ].join('\n');

  test('inserts a div AFTER the anchor and returns its new id', () => {
    const id = idsOf(base).button as string;
    const out = applyInsertElement(CANVAS, base, id, 'after', 'div');
    expect(out.source).toContain("background: 'var(--bg-2)'");
    expect(parses(out.source)).toBe(true);
    expect(out.newId).toMatch(/^[0-9a-f]{8}$/);
    // The recomputed id matches the pipeline-stamped id of the new <div>.
    expect(idsOf(out.source).div).toBe(out.newId);
  });

  test('inserts a text node BEFORE the anchor', () => {
    const id = idsOf(base).button as string;
    const out = applyInsertElement(CANVAS, base, id, 'before', 'text');
    expect(out.source).toContain('<p style={{ margin: 0 }}>Text</p>');
    // Order: the <p> precedes the <button> in source.
    expect(out.source.indexOf('<p ')).toBeLessThan(out.source.indexOf('<button'));
    expect(parses(out.source)).toBe(true);
  });

  test('inserts INSIDE the anchor (inside-end)', () => {
    const id = idsOf(base).section as string;
    const out = applyInsertElement(CANVAS, base, id, 'inside-end', 'div');
    // The new div is nested within <section>…</section>.
    expect(out.source).toMatch(/<section>[\s\S]*var\(--bg-2\)[\s\S]*<\/section>/);
    expect(parses(out.source)).toBe(true);
  });

  test('image insert requires a contained asset src', () => {
    const id = idsOf(base).button as string;
    expect(() => applyInsertElement(CANVAS, base, id, 'after', 'image')).toThrow(CanvasEditError);
    expect(() =>
      applyInsertElement(CANVAS, base, id, 'after', 'image', { src: '../etc/passwd' })
    ).toThrow(CanvasEditError);
    const ok = applyInsertElement(CANVAS, base, id, 'after', 'image', {
      src: 'assets/ab12cd34.png',
    });
    expect(ok.source).toContain('src="assets/ab12cd34.png"');
    expect(ok.source).toContain("objectFit: 'cover'");
    expect(parses(ok.source)).toBe(true);
  });

  test('refuses to nest inside a self-closing target', () => {
    const src = 'function Demo() { return <section><img src="assets/a.png" /></section>; }';
    const id = idsOf(src).img as string;
    expect(() => applyInsertElement(CANVAS, src, id, 'inside-end', 'div')).toThrow(CanvasEditError);
  });
});

describe('canvas-edit / applyInsertElementIntoArtboard (empty-artboard fallback)', () => {
  const emptyCanvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test("inserts a div as the artboard's only child (inside-end)", () => {
    const out = applyInsertElementIntoArtboard(CANVAS, emptyCanvas, 'home', 'inside-end', 'div');
    expect(out.source).toMatch(
      /<DCArtboard id="home"[^>]*>[\s\S]*var\(--bg-2\)[\s\S]*<\/DCArtboard>/
    );
    expect(parses(out.source)).toBe(true);
    expect(out.newId).toMatch(/^[0-9a-f]{8}$/);
  });

  test('inside-start lands the new element right after the opening tag', () => {
    const out = applyInsertElementIntoArtboard(CANVAS, emptyCanvas, 'home', 'inside-start', 'text');
    expect(out.source).toContain('<p style={{ margin: 0 }}>Text</p>');
    expect(parses(out.source)).toBe(true);
  });

  test('image insert requires a contained asset src', () => {
    expect(() =>
      applyInsertElementIntoArtboard(CANVAS, emptyCanvas, 'home', 'inside-end', 'image')
    ).toThrow(CanvasEditError);
    const ok = applyInsertElementIntoArtboard(CANVAS, emptyCanvas, 'home', 'inside-end', 'image', {
      src: 'assets/ab12cd34.png',
    });
    expect(ok.source).toContain('src="assets/ab12cd34.png"');
    expect(parses(ok.source)).toBe(true);
  });

  test('unknown artboard id throws', () => {
    expect(() =>
      applyInsertElementIntoArtboard(CANVAS, emptyCanvas, 'nope', 'inside-end', 'div')
    ).toThrow(CanvasEditError);
  });
});

describe('canvas-edit / applyResizeArtboard (D4)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('rewrites width + height numeric props (not string literals)', () => {
    const out = applyResizeArtboard(CANVAS, canvas, 'home', 1200, 900);
    expect(out.source).toContain('width={1200}');
    expect(out.source).toContain('height={900}');
    expect(out.source).not.toContain('width="1200"'); // never a string literal
    expect(parses(out.source)).toBe(true);
  });

  test('rounds + clamps and can change one axis only', () => {
    const out = applyResizeArtboard(CANVAS, canvas, 'home', 800.7, undefined);
    expect(out.source).toContain('width={801}');
    expect(out.source).toContain('height={1024}'); // untouched
  });

  test('unknown artboard id throws', () => {
    expect(() => applyResizeArtboard(CANVAS, canvas, 'nope', 100, 100)).toThrow(CanvasEditError);
  });
});

describe('canvas-edit / applySetArtboardHug (Hug ⇄ Fixed toggle)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('fixed=true adds the bare boolean prop, no string/expr value', () => {
    const out = applySetArtboardHug(CANVAS, canvas, 'home', true);
    expect(out.source).toMatch(/<DCArtboard\b[^>]*\bfixed\b(?!=)[^>]*>/);
    expect(out.source).not.toContain('fixed={true}');
    expect(out.source).not.toContain('fixed="true"');
    expect(parses(out.source)).toBe(true);
  });

  test('fixed=true with freezeHeight also pins height (numeric prop)', () => {
    const out = applySetArtboardHug(CANVAS, canvas, 'home', true, 777);
    expect(out.source).toContain('fixed');
    expect(out.source).toContain('height={777}');
    expect(parses(out.source)).toBe(true);
  });

  test('fixed=true is idempotent — no duplicate attr on a board already pinned', () => {
    const once = applySetArtboardHug(CANVAS, canvas, 'home', true);
    const twice = applySetArtboardHug(CANVAS, once.source, 'home', true);
    expect(twice.source.match(/\bfixed\b/g)?.length).toBe(1);
  });

  test('fixed=false removes the prop, height untouched', () => {
    const pinned = applySetArtboardHug(CANVAS, canvas, 'home', true, 777);
    const out = applySetArtboardHug(CANVAS, pinned.source, 'home', false);
    expect(out.source).not.toContain('fixed');
    expect(out.source).toContain('height={777}'); // stays as the hug floor
    expect(parses(out.source)).toBe(true);
  });

  test('fixed=false on an already-hug board is a no-op', () => {
    const out = applySetArtboardHug(CANVAS, canvas, 'home', false);
    expect(out.source).toBe(canvas);
  });

  test('unknown artboard id throws', () => {
    expect(() => applySetArtboardHug(CANVAS, canvas, 'nope', true)).toThrow(CanvasEditError);
  });
});

describe('canvas-edit / applySetArtboardStyle (background/padding/layout/gap)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('writes background/layout as string literals, padding/gap as numeric', () => {
    const out = applySetArtboardStyle(CANVAS, canvas, 'home', {
      background: 'var(--bg-1)',
      layout: 'flex-col',
      padding: 16,
      gap: 8,
    });
    expect(out.source).toContain('background="var(--bg-1)"');
    expect(out.source).toContain('layout="flex-col"');
    expect(out.source).toContain('padding={16}');
    expect(out.source).toContain('gap={8}');
    expect(parses(out.source)).toBe(true);
  });

  test('padding/gap of 0 is written verbatim, not clamped to 1', () => {
    const out = applySetArtboardStyle(CANVAS, canvas, 'home', { padding: 0, gap: 0 });
    expect(out.source).toContain('padding={0}');
    expect(out.source).toContain('gap={0}');
  });

  test('null resets a previously-set prop (removes the attribute)', () => {
    const styled = applySetArtboardStyle(CANVAS, canvas, 'home', { background: 'red' });
    const out = applySetArtboardStyle(CANVAS, styled.source, 'home', { background: null });
    expect(out.source).not.toContain('background=');
    expect(parses(out.source)).toBe(true);
  });

  test('an absent key leaves that prop untouched', () => {
    const styled = applySetArtboardStyle(CANVAS, canvas, 'home', { background: 'red', padding: 4 });
    const out = applySetArtboardStyle(CANVAS, styled.source, 'home', { padding: 8 });
    expect(out.source).toContain('background="red"'); // untouched
    expect(out.source).toContain('padding={8}');
  });

  test('unknown artboard id throws', () => {
    expect(() => applySetArtboardStyle(CANVAS, canvas, 'nope', { padding: 4 })).toThrow(
      CanvasEditError
    );
  });

  // Dogfood (artboard panel ↔ shared inspector controls) — padding/gap accept
  // a var(--token) STRING binding alongside raw px numbers.
  test('padding/gap accept a var(--token) string (space-token binding)', () => {
    const out = applySetArtboardStyle(CANVAS, canvas, 'home', {
      padding: 'var(--space-4)',
      gap: 'var(--space-2)',
    });
    expect(out.source).toContain('padding="var(--space-4)"');
    expect(out.source).toContain('gap="var(--space-2)"');
    expect(parses(out.source)).toBe(true);
  });

  test('a token binding round-trips back to a raw number (detach) and vice versa', () => {
    const bound = applySetArtboardStyle(CANVAS, canvas, 'home', { padding: 'var(--space-4)' });
    const detached = applySetArtboardStyle(CANVAS, bound.source, 'home', { padding: 24 });
    expect(detached.source).toContain('padding={24}');
    expect(detached.source).not.toContain('var(--space-4)');
    const rebound = applySetArtboardStyle(CANVAS, detached.source, 'home', {
      padding: 'var(--space-6)',
    });
    expect(rebound.source).toContain('padding="var(--space-6)"');
    expect(rebound.source).not.toContain('padding={24}');
    expect(parses(rebound.source)).toBe(true);
  });
});

// Plan T25/L08 — rename an artboard (double-click its name).
describe('canvas-edit / applySetArtboardLabel', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '      <DCArtboard id="other" width={390} height={844} />',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('rewrites only the addressed artboard label, escaping quotes and dropping control characters', () => {
    const out = applySetArtboardLabel(CANVAS, canvas, 'home', 'Home "v2"\u0007');
    expect(out.source).toContain('label="Home &quot;v2&quot;"');
    expect(out.source).toContain('<DCArtboard id="other" width={390}');
    expect(parses(out.source)).toBe(true);
  });

  test('adds a label to an artboard that had none', () => {
    const out = applySetArtboardLabel(CANVAS, canvas, 'other', 'Mobile');
    expect(out.source).toMatch(
      /<DCArtboard[^>]*label="Mobile"[^>]*id="other"|<DCArtboard[^>]*id="other"[^>]*label="Mobile"/
    );
  });

  test('refuses an empty name and an unknown artboard', () => {
    expect(() => applySetArtboardLabel(CANVAS, canvas, 'home', '  ')).toThrow(CanvasEditError);
    expect(() => applySetArtboardLabel(CANVAS, canvas, 'nope', 'X')).toThrow(CanvasEditError);
  });
});

// feature-1-artboard-kinds-foundation, T5/T8 — kind-switch write lane.
describe('canvas-edit / applySetArtboardKind', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('writes kind as a plain string-literal prop', () => {
    const out = applySetArtboardKind(CANVAS, canvas, 'home', 'print');
    expect(out.source).toContain('kind="print"');
    expect(parses(out.source)).toBe(true);
  });

  test('switching kind replaces the previous value, no duplicate attr', () => {
    const printed = applySetArtboardKind(CANVAS, canvas, 'home', 'print');
    const out = applySetArtboardKind(CANVAS, printed.source, 'home', 'web');
    expect(out.source).toContain('kind="web"');
    expect(out.source).not.toContain('kind="print"');
    expect(out.source.match(/\bkind=/g)?.length).toBe(1);
  });

  test('kind=null clears back to the implicit default', () => {
    const printed = applySetArtboardKind(CANVAS, canvas, 'home', 'print');
    const out = applySetArtboardKind(CANVAS, printed.source, 'home', null);
    expect(out.source).not.toContain('kind=');
    expect(parses(out.source)).toBe(true);
  });

  test('an invalid kind value throws rather than writing garbage', () => {
    expect(() => applySetArtboardKind(CANVAS, canvas, 'home', 'poster')).toThrow(CanvasEditError);
  });

  test('unknown artboard id throws', () => {
    expect(() => applySetArtboardKind(CANVAS, canvas, 'nope', 'print')).toThrow(CanvasEditError);
  });
});

// feature-1-artboard-kinds-foundation, T5 — generic layout guides write lane.
describe('canvas-edit / applySetArtboardGuides (replace-whole-prop)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('inserts guides as a {{...}} object-expression prop', () => {
    const out = applySetArtboardGuides(CANVAS, canvas, 'home', {
      columns: { count: 12, gutter: 24, margin: 80 },
    });
    expect(out.source).toContain('guides={{"columns":{"count":12,"gutter":24,"margin":80}}}');
    expect(parses(out.source)).toBe(true);
  });

  test('a second write REPLACES the whole prop rather than merging', () => {
    const first = applySetArtboardGuides(CANVAS, canvas, 'home', {
      columns: { count: 12, gutter: 24, margin: 80 },
    });
    const out = applySetArtboardGuides(CANVAS, first.source, 'home', { grid: { size: 8 } });
    expect(out.source).toContain('guides={{"grid":{"size":8}}}');
    expect(out.source).not.toContain('columns');
    expect(out.source.match(/\bguides=/g)?.length).toBe(1);
    expect(parses(out.source)).toBe(true);
  });

  test('guides=null removes the prop', () => {
    const written = applySetArtboardGuides(CANVAS, canvas, 'home', { grid: { size: 8 } });
    const out = applySetArtboardGuides(CANVAS, written.source, 'home', null);
    expect(out.source).not.toContain('guides=');
    expect(parses(out.source)).toBe(true);
  });

  test('unknown artboard id throws', () => {
    expect(() => applySetArtboardGuides(CANVAS, canvas, 'nope', { grid: { size: 8 } })).toThrow(
      CanvasEditError
    );
  });
});

// feature-2-print-artboards T2 — print prop write lane (same replace-whole-
// prop shape as applySetArtboardGuides).
describe('canvas-edit / applySetArtboardPrint (replace-whole-prop)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('inserts print as a {{...}} object-expression prop', () => {
    const out = applySetArtboardPrint(CANVAS, canvas, 'home', { paper: 'a4', bleedMm: 3 });
    expect(out.source).toContain('print={{"paper":"a4","bleedMm":3}}');
    expect(parses(out.source)).toBe(true);
  });

  test('a second write REPLACES the whole prop rather than merging', () => {
    const first = applySetArtboardPrint(CANVAS, canvas, 'home', { paper: 'a4', bleedMm: 3 });
    const out = applySetArtboardPrint(CANVAS, first.source, 'home', {
      paper: 'letter',
      orientation: 'landscape',
    });
    expect(out.source).toContain('print={{"paper":"letter","orientation":"landscape"}}');
    expect(out.source).not.toContain('a4');
    expect(out.source.match(/\bprint=/g)?.length).toBe(1);
    expect(parses(out.source)).toBe(true);
  });

  test('print=null removes the prop', () => {
    const written = applySetArtboardPrint(CANVAS, canvas, 'home', { paper: 'a4' });
    const out = applySetArtboardPrint(CANVAS, written.source, 'home', null);
    expect(out.source).not.toContain('print=');
    expect(parses(out.source)).toBe(true);
  });

  test('unknown artboard id throws', () => {
    expect(() => applySetArtboardPrint(CANVAS, canvas, 'nope', { paper: 'a4' })).toThrow(
      CanvasEditError
    );
  });
});

// feature-2-print-artboards T5 — the AST-only (no-eval) reader the PDF
// exporter uses to resolve an artboard's print geometry.
describe('canvas-edit / readArtboardPrintProp (no-eval AST read)', () => {
  test('reads a JSON-shaped print prop on a kind="print" artboard (the picker\'s own write shape)', () => {
    const canvas = [
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" kind="print" width={816} height={1146} print={{"paper":"a4","bleedMm":3}}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'home')).toEqual({ paper: 'a4', bleedMm: 3 });
  });

  test('reads a hand-authored JS-literal print prop (unquoted keys, nested object)', () => {
    const canvas = [
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" kind="print" width={816} height={1146} print={{ paper: \'a4\', orientation: \'landscape\', marginsMm: { top: 10, left: 5 } }}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'home')).toEqual({
      paper: 'a4',
      orientation: 'landscape',
      marginsMm: { top: 10, left: 5 },
    });
  });

  test('no print prop → null', () => {
    const canvas = [
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" kind="print" width={1440} height={1024}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'home')).toBeNull();
  });

  test('unknown artboard id → null (not a throw — read-only, best-effort)', () => {
    const canvas = [
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" kind="print" width={1440} height={1024}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'nope')).toBeNull();
  });

  test('dogfood regression — a print prop present but kind NOT "print" → null (a stale prop from a prior kind switch must never leak into export)', () => {
    const canvas = [
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" width={1440} height={1024} print={{"paper":"a4","bleedMm":3}}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'home')).toBeNull();
  });

  test('resolves a print prop shared via a top-level const reference (RCA issue-pdf-print-export-marks-missing)', () => {
    const canvas = [
      'const A1_PRINT = { paper: "a1", orientation: "portrait", bleedMm: 3 } as const;',
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="acko-front" label="A" kind="print" width={816} height={1146} print={A1_PRINT}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '      <DCArtboard id="acko-back" label="B" kind="print" width={816} height={1146} print={A1_PRINT as any}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    const expected = { paper: 'a1', orientation: 'portrait', bleedMm: 3 };
    // Both the bare reference and the `as any`-cast reference (the shape
    // AlligatorsAcko.tsx actually shipped, since a plain `print={A1_PRINT}`
    // would fail TSX's own type check against the JSX prop's declared type)
    // must resolve to the same object as an equivalent inline literal.
    expect(readArtboardPrintProp(CANVAS, canvas, 'acko-front')).toEqual(expected);
    expect(readArtboardPrintProp(CANVAS, canvas, 'acko-back')).toEqual(expected);
  });

  test('an unresolvable print reference (imported, not declared in this file) → null', () => {
    const canvas = [
      'import { A1_PRINT } from "./print-specs.ts";',
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" kind="print" width={816} height={1146} print={A1_PRINT}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'home')).toBeNull();
  });

  test('a genuinely computed print prop (function call) → null, never guessed', () => {
    const canvas = [
      'function computePrint() { return { paper: "a4" }; }',
      'export default function Demo() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="home" label="Home" kind="print" width={816} height={1146} print={computePrint()}>',
      '        <div>content</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
    ].join('\n');
    expect(readArtboardPrintProp(CANVAS, canvas, 'home')).toBeNull();
  });
});

describe('canvas-edit / applyInsertArtboard (I4)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024}>',
    '        <div>content</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('appends an empty artboard after the last one', () => {
    const out = applyInsertArtboard(CANVAS, canvas, {
      id: 'mobile',
      label: 'Mobile',
      width: 390,
      height: 844,
    });
    expect(out.artboardId).toBe('mobile');
    expect(out.source).toContain(
      '<DCArtboard id="mobile" label="Mobile" width={390} height={844}></DCArtboard>'
    );
    // It lands AFTER the existing artboard.
    expect(out.source.indexOf('id="mobile"')).toBeGreaterThan(out.source.indexOf('id="home"'));
    expect(parses(out.source)).toBe(true);
  });

  test('rejects a duplicate artboard id', () => {
    expect(() =>
      applyInsertArtboard(CANVAS, canvas, { id: 'home', label: 'Dup', width: 390, height: 844 })
    ).toThrow(CanvasEditError);
  });

  test('rejects an invalid artboard id (injection guard)', () => {
    expect(() =>
      applyInsertArtboard(CANVAS, canvas, {
        id: 'a" onload="x',
        label: 'X',
        width: 390,
        height: 844,
      })
    ).toThrow(CanvasEditError);
  });
});

describe('canvas-edit / applyDuplicateArtboard (feature-3-web-artboards T3)', () => {
  const canvas = [
    'export default function Demo() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="home" label="Home" width={1440} height={1024} kind="web">',
    '        <div>content</div>',
    '      </DCArtboard>',
    '      <DCArtboard id="other" label="Other" width={800} height={600}>',
    '        <div>other</div>',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

  test('clones the artboard with a suffixed id/label + new width, right after the source', () => {
    const out = applyDuplicateArtboard(CANVAS, canvas, 'home', 390);
    expect(out.artboardId).toBe('home-390');
    expect(out.source).toContain('id="home-390"');
    expect(out.source).toContain('label="Home (390px)"');
    expect(out.source).toContain('width={390}');
    // Preserves kind + children verbatim.
    expect(out.source).toContain('kind="web"');
    const homeIdx = out.source.indexOf('id="home"');
    const cloneIdx = out.source.indexOf('id="home-390"');
    const otherIdx = out.source.indexOf('id="other"');
    expect(cloneIdx).toBeGreaterThan(homeIdx);
    // Lands right after the source — BEFORE the sibling that followed it — so
    // it inherits the "beside the source" default-grid slot (DDR-027).
    expect(cloneIdx).toBeLessThan(otherIdx);
    expect((out.source.match(/<div>content<\/div>/g) ?? []).length).toBe(2);
    expect(parses(out.source)).toBe(true);
  });

  test('de-dupes the new id when the same breakpoint is duplicated twice', () => {
    const once = applyDuplicateArtboard(CANVAS, canvas, 'home', 390);
    const twice = applyDuplicateArtboard(CANVAS, once.source, 'home', 390);
    expect(twice.artboardId).toBe('home-390-2');
    expect(twice.source).toContain('id="home-390-2"');
    expect(parses(twice.source)).toBe(true);
  });

  test('height/other props are untouched — only id/label/width change', () => {
    const out = applyDuplicateArtboard(CANVAS, canvas, 'home', 390);
    // The clone keeps the SOURCE's height (390px is a width-only breakpoint
    // change — height stays hug-driven per Design Decision 1).
    expect(out.source).toContain('id="home-390" label="Home (390px)" width={390} height={1024}');
  });

  test('throws on an unknown artboard id', () => {
    expect(() => applyDuplicateArtboard(CANVAS, canvas, 'nope', 390)).toThrow(CanvasEditError);
  });
});
