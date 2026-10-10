// V2-2.19 step 3 — `checkIds`, the id part of `maude design check` (contract V2-1.4 §5.3, T5).
// Each finding on a planted fixture; a clean rewrite passes. The rewrite-scale behaviour (and the
// §6 re-attach numbers) live in element-ids-rewrite.test.ts.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkIds } from '../element-ids.ts';

const BEFORE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="home" label="Home" width={800} height={500}>
        <header className="top">
          <img data-cd-id="logo" data-cd-locked className="logo" src="/logo.svg" alt="Acme" />
          <nav className="nav">
            <a className="nav-link" href="#a">Features</a>
          </nav>
        </header>
        <section data-cd-id="hero" className="hero">
          <h1 data-cd-id="hero-title" className="title">Design together</h1>
          <button data-cd-id="see-pricing" className="btn btn-primary" type="button">
            See pricing
          </button>
          <div data-cd-id="promo" data-cd-hidden="flex" style={{ display: 'none' }}>Sale</div>
        </section>
        <p data-cd-id="footer-note" className="foot">Made in Brno</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const P = 'ui/Home.tsx';
const codes = (r: ReturnType<typeof checkIds>) => r.findings.map((f) => f.code).sort();
const lineOf = (src: string, needle: string) =>
  src.slice(0, src.indexOf(needle)).split('\n').length;

describe('checkIds (T5)', () => {
  test('a clean rewrite passes: restyle + new text + an inserted element', () => {
    const after = BEFORE.replace(
      'className="title">Design together',
      'className="title big">Design, together'
    ).replace(
      '<p data-cd-id="footer-note"',
      '<span className="new">New</span>\n        <p data-cd-id="footer-note"'
    );
    const r = checkIds(after, { against: BEFORE, path: P });
    expect(r.parseError).toBeUndefined();
    expect(r.findings).toEqual([]);
    expect(r.lostIds).toEqual([]);
    expect(r.reattach).toEqual([]);
    expect(r.fixed).toBeUndefined();
  });

  test('id-lost names the element by role, label and id, plus the line; fix puts it back', () => {
    const after = BEFORE.replace(
      '<button data-cd-id="see-pricing" className="btn btn-primary"',
      '<button className="btn btn-primary"'
    );
    const r = checkIds(after, { against: BEFORE, path: P, fix: true });
    expect(codes(r)).toEqual(['id-lost']);
    const f = r.findings[0];
    const line = lineOf(after, '<button className');
    expect(f).toMatchObject({ code: 'id-lost', severity: 'error', id: 'see-pricing', line });
    expect(f?.where).toBe(`${P}:${line}:${f?.col}`);
    expect(f?.element).toEqual({ tag: 'button', label: 'See pricing', artboard: 'home' });
    expect(f?.what).toBe(`Button "See pricing" (line ${line}) lost data-cd-id="see-pricing".`);
    expect(f?.fix).toContain('data-cd-id="see-pricing"');
    expect(r.lostIds).toEqual(['see-pricing']);
    expect(r.reattach).toEqual([{ id: 'see-pricing', line }]);
    expect(r.fixed).toBe(BEFORE);
    expect(checkIds(r.fixed as string, { against: BEFORE, path: P }).findings).toEqual([]);
  });

  test('a deleted element is id-removed (info, not an error), and fix adds nothing', () => {
    const after = BEFORE.replace(
      '        <p data-cd-id="footer-note" className="foot">Made in Brno</p>\n',
      ''
    );
    const r = checkIds(after, { against: BEFORE, path: P, fix: true });
    expect(codes(r)).toEqual(['id-removed']);
    expect(r.findings[0]).toMatchObject({ severity: 'info', id: 'footer-note' });
    expect(r.findings[0]?.what).toContain('Removed Text "Made in Brno" (footer-note)');
    expect(r.lostIds).toEqual(['footer-note']);
    expect(r.fixed).toBe(after);
  });

  test('id-duplicate names both lines', () => {
    const after = BEFORE.replace(
      '<a className="nav-link"',
      '<a data-cd-id="hero" className="nav-link"'
    );
    const r = checkIds(after, { path: P });
    expect(codes(r)).toEqual(['id-duplicate']);
    const f = r.findings[0];
    expect(f?.severity).toBe('error');
    expect(f?.what).toBe(
      `data-cd-id="hero" is on two elements (lines ${lineOf(after, '<a data-cd-id')}, ${lineOf(after, '<section')}).`
    );
  });

  test('id-expression and id-format', () => {
    const exp = BEFORE.replace('<h1 data-cd-id="hero-title"', '<h1 data-cd-id={"hero-" + 1}');
    const r1 = checkIds(exp, { path: P });
    expect(codes(r1)).toEqual(['id-expression']);
    expect(r1.findings[0]?.what).toBe(
      `data-cd-id must be a plain string ("…"), line ${lineOf(exp, '<h1')}.`
    );
    const bad = BEFORE.replace('data-cd-id="hero-title"', 'data-cd-id="Hero Title"').replace(
      'data-cd-id="footer-note"',
      'data-cd-id="3807c330"'
    );
    expect(codes(checkIds(bad, { path: P }))).toEqual(['id-format', 'id-format']);
  });

  test('locked-changed: a changed print, a dropped lock, or a removed locked element', () => {
    const restyled = BEFORE.replace(
      'className="logo" src="/logo.svg"',
      'className="logo big" src="/logo.svg"'
    );
    const r1 = checkIds(restyled, { against: BEFORE, path: P });
    expect(codes(r1)).toEqual(['locked-changed']);
    expect(r1.findings[0]?.what).toBe('Image "Acme" is locked — leave it as it is.');
    expect(r1.findings[0]?.fix).toContain('⇧⌘L');
    const unlocked = BEFORE.replace('data-cd-id="logo" data-cd-locked', 'data-cd-id="logo"');
    expect(codes(checkIds(unlocked, { against: BEFORE, path: P }))).toEqual(['locked-changed']);
    const removed = BEFORE.replace(/ *<img data-cd-id="logo"[^\n]*\n/, '');
    const r3 = checkIds(removed, { against: BEFORE, path: P });
    expect(codes(r3)).toEqual(['id-removed', 'locked-changed']);
    // a locked element may move with its parent's restyle (its own print is unchanged)
    const parent = BEFORE.replace('<header className="top">', '<header className="top dark">');
    expect(checkIds(parent, { against: BEFORE, path: P }).findings).toEqual([]);
  });

  test('cd-attr-changed: any other data-cd-* on a kept element', () => {
    const after = BEFORE.replace('data-cd-hidden="flex"', 'data-cd-hidden="block"');
    const r = checkIds(after, { against: BEFORE, path: P });
    expect(codes(r)).toEqual(['cd-attr-changed']);
    expect(r.findings[0]?.id).toBe('promo');
    const dropped = BEFORE.replace(' data-cd-hidden="flex"', '');
    expect(codes(checkIds(dropped, { against: BEFORE, path: P }))).toEqual(['cd-attr-changed']);
  });

  test('a parse error is reported, not thrown', () => {
    const r = checkIds('export default () => <div>', { against: BEFORE, path: P });
    expect(typeof r.parseError).toBe('string');
    expect(r.findings).toEqual([]);
  });

  test('a new wrapper never inherits the id of the element it wraps', () => {
    // the AI wraps the button AND drops its id: the wrapper is a div, the button keeps its tag
    const after = BEFORE.replace(
      /<button data-cd-id="see-pricing"([\s\S]*?)<\/button>/,
      '<div className="wrap"><button$1</button></div>'
    );
    const r = checkIds(after, { against: BEFORE, path: P, fix: true });
    expect(r.reattach.map((x) => x.id)).toEqual(['see-pricing']);
    expect(r.fixed).toContain('<button data-cd-id="see-pricing"');
    expect(r.fixed).toContain('<div className="wrap">');
  });

  test('stays inside the budget on the largest v2 canvas (≤ 50 ms, two-sided)', () => {
    const big = readFileSync(
      join(import.meta.dir, '../../../.design/ui/v2/15 Annotations.tsx'),
      'utf8'
    );
    checkIds(big, { against: big, path: P }); // warm
    const t0 = performance.now();
    const r = checkIds(big, { against: big, path: P });
    const ms = performance.now() - t0;
    expect(r.parseError).toBeUndefined();
    console.log(`checkIds two-sided on 15 Annotations.tsx (${big.length} B): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
