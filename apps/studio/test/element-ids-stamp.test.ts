// V2-2.19 step 2 — the source rules of contract V2-1.4 §5.2: the readable id generator (T3), the
// locator entry for authored ids (T4), lazy stamping (`stampIds`), and the writers that create
// elements (insert / duplicate) stamping their new element while a copy never inherits an id or a
// lock. Prints ignore every `data-cd-*`, so stamping never changes a print (T12 guard).

import { describe, expect, test } from 'bun:test';
import {
  applyDuplicateElement,
  applyInsertElement,
  applyInsertElementIntoArtboard,
  CanvasEditError,
  elementPrint,
  listElements,
  stampIds,
} from '../canvas-edit.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { generateElementId, isValidElementId, walkIdElements } from '../element-ids.ts';

const CANVAS = '/x/Stamp.tsx';

describe('generateElementId (T3)', () => {
  const gen = (seed: Parameters<typeof generateElementId>[0], used: string[] = []) =>
    generateElementId(seed, new Set(used));

  test('data-dc-element first, then own text (three words, accents folded), class, tag', () => {
    expect(gen({ tag: 'section', dcElement: 'Hero Panel', text: 'Ignored', className: 'x' })).toBe(
      'hero-panel'
    );
    expect(gen({ tag: 'button', text: 'Přihlásit se teď, prosím' })).toBe('prihlasit-se-ted');
    expect(gen({ tag: 'div', className: 'card-grid wide' })).toBe('card-grid');
    expect(gen({ tag: 'div' })).toBe('div');
    expect(gen({ tag: 'PricingCard' })).toBe('pricing-card');
    expect(gen({ tag: 'motion.div' })).toBe('motion-div');
  });

  test('always valid: starts with a letter, ≤ 48 chars, never exactly 8 hex', () => {
    expect(gen({ tag: 'p', text: '2026 plans' })).toBe('p-2026-plans');
    expect(gen({ tag: 'span', text: 'deadbeef' })).toBe('deadbeef-el');
    expect(gen({ tag: 'span', text: '42' })).toBe('span-42');
    expect(gen({ tag: 'span', text: '!!!' })).toBe('span');
    const long = gen({ tag: 'p', dcElement: `${'a'.repeat(30)} ${'b'.repeat(30)}` });
    expect(long.length).toBeLessThanOrEqual(48);
    for (const id of ['p-2026-plans', 'deadbeef-el', 'span-42', long]) {
      expect(isValidElementId(id)).toBe(true);
    }
    expect(isValidElementId('3807c330')).toBe(false);
    expect(isValidElementId('Hero')).toBe(false);
    expect(isValidElementId('hero--x')).toBe(false);
    expect(isValidElementId('')).toBe(false);
  });

  test('-N suffix on a collision, deterministic, and the id joins `used`', () => {
    const used = new Set(['div', 'div-2']);
    expect(generateElementId({ tag: 'div' }, used)).toBe('div-3');
    expect(used.has('div-3')).toBe(true);
    expect(generateElementId({ tag: 'div' }, used)).toBe('div-4');
    expect(gen({ tag: 'button', text: 'See pricing' })).toBe(
      gen({ tag: 'button', text: 'See pricing' })
    );
  });
});

const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="home" label="Home" width={800} height={500}>
        <main className="page">
          <h1 data-cd-id="hero-title">Hero</h1>
          <button className="btn" type="button">See pricing</button>
          <button className="btn" type="button">See pricing</button>
          <p>Body copy</p>
        </main>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('the pipeline locator (T4)', () => {
  test('authored ids get a _locator.json entry as well as injected ones', () => {
    const r = transpileCanvasSource(CANVAS, HOME);
    expect(r.locator['hero-title']).toBeDefined();
    expect(r.locator['hero-title']?.line).toBe(7);
    expect(r.locator['hero-title']?.jsxPath.at(-1)).toBe('h1');
    // the injected ones are still there
    expect(Object.keys(r.locator).filter((k) => /^[0-9a-f]{8}$/.test(k)).length).toBe(6);
  });
});

describe('stampIds (lazy stamping)', () => {
  const idOf = (src: string, pred: (p: { tag: string; text?: string }) => boolean) =>
    listElements(CANVAS, src).find((e) => pred(e.print))?.id as string;

  test('stamps the element at the hint, readable, and leaves its print unchanged', () => {
    const hint = idOf(HOME, (p) => p.tag === 'p');
    const print = elementPrint(CANVAS, HOME, hint);
    expect(print).not.toBeNull();
    const out = stampIds(HOME, [{ hint, print: print as never }], { path: CANVAS });
    expect(out.ids.get(hint)).toBe('body-copy');
    expect(out.source).toContain('<p data-cd-id="body-copy">Body copy</p>');
    expect(elementPrint(CANVAS, out.source, 'body-copy')).toEqual(print);
    // only that line changed
    expect(out.source.replace(' data-cd-id="body-copy"', '')).toBe(HOME);
  });

  test('re-finds the element by print after the hint moved, refuses an ambiguous print', () => {
    const hint = idOf(HOME, (p) => p.tag === 'p');
    const print = elementPrint(CANVAS, HOME, hint) as never;
    const shifted = HOME.replace(
      '<main className="page">',
      '<main className="page">\n          <hr />'
    );
    expect(idOf(shifted, (p) => p.tag === 'p')).not.toBe(hint);
    expect(stampIds(shifted, [{ hint, print }], { path: CANVAS }).ids.get(hint)).toBe('body-copy');
    const btn = idOf(HOME, (p) => p.tag === 'button');
    const bprint = elementPrint(CANVAS, HOME, btn) as never;
    const moved = stampIds(shifted, [{ hint: btn, print: bprint }], { path: CANVAS });
    expect(moved.ids.size).toBe(0);
    expect(moved.source).toBe(shifted);
  });

  test('an already-stamped element returns its id and writes nothing; no targets = byte-identical', () => {
    const print = elementPrint(CANVAS, HOME, 'hero-title') as never;
    const out = stampIds(HOME, [{ hint: 'hero-title', print }], { path: CANVAS });
    expect(out.ids.get('hero-title')).toBe('hero-title');
    expect(out.source).toBe(HOME);
    expect(stampIds(HOME, [], { path: CANVAS }).source).toBe(HOME);
  });

  test('reserved ids (held by detached references) are never handed out again', () => {
    const hint = idOf(HOME, (p) => p.tag === 'p');
    const print = elementPrint(CANVAS, HOME, hint) as never;
    const out = stampIds(HOME, [{ hint, print }], { path: CANVAS, reserved: ['body-copy'] });
    expect(out.ids.get(hint)).toBe('body-copy-2');
  });

  test('an expression-valued data-cd-id is refused', () => {
    const src = HOME.replace('<p>Body copy</p>', '<p data-cd-id={"x"}>Body copy</p>');
    const p = listElements(CANVAS, src).find((e) => e.print.tag === 'p');
    expect(() =>
      stampIds(src, [{ hint: (p as { id: string }).id, print: (p as { print: never }).print }], {
        path: CANVAS,
      })
    ).toThrow(CanvasEditError);
  });
});

describe('writers that create elements stamp them; a copy never inherits an id or a lock', () => {
  test('duplicate: descendants lose their ids and locks; an unstamped root copy stays lazy', () => {
    const src = HOME.replace(
      '<h1 data-cd-id="hero-title">Hero</h1>',
      '<h1 data-cd-id="hero-title" data-cd-locked>Hero</h1>'
    );
    const main = listElements(CANVAS, src).find((e) => e.print.tag === 'main')?.id as string;
    const out = applyDuplicateElement(CANVAS, src, main);
    expect(out.newId).toMatch(/^[0-9a-f]{8}$/); // positional, as in v1 (the v1 key golden pins it)
    const w = walkIdElements(out.source, CANVAS);
    if (!w.ok) throw new Error(w.error);
    expect(w.elements.filter((e) => e.tag === 'main').map((m) => m.id)).toEqual([null, null]);
    const h1s = w.elements.filter((e) => e.tag === 'h1');
    expect(h1s.map((h) => [h.id, h.locked])).toEqual([
      ['hero-title', true],
      [null, false],
    ]);
    // the original is byte-identical
    const end = src.indexOf('</main>') + 7;
    expect(out.source.slice(0, end)).toBe(src.slice(0, end));
  });

  test('duplicate: a stamped root copy gets a fresh readable id, never the original one', () => {
    const once = applyDuplicateElement(CANVAS, HOME, 'hero-title');
    // the readable rule (§4.2) names the copy from its own text
    expect(once.newId).toBe('hero');
    expect(once.source).toContain('<h1 data-cd-id="hero-title">Hero</h1>');
    expect(once.source).toContain('<h1 data-cd-id="hero">Hero</h1>');
    expect(applyDuplicateElement(CANVAS, once.source, 'hero-title').newId).toBe('hero-2');
  });

  test('insert: the new element carries a readable id, which is the returned newId', () => {
    const btn = listElements(CANVAS, HOME).find((e) => e.print.tag === 'button')?.id as string;
    const a = applyInsertElement(CANVAS, HOME, btn, 'after', 'div');
    expect(a.newId).toBe('div');
    expect(a.source).toContain('<div data-cd-id="div" style=');
    const b = applyInsertElement(CANVAS, a.source, btn, 'before', 'text');
    expect(b.newId).toBe('text');
    expect(b.source).toContain('<p data-cd-id="text" style={{ margin: 0 }}>Text</p>');
    const c = applyInsertElementIntoArtboard(CANVAS, b.source, 'home', 'inside-end', 'div');
    expect(c.newId).toBe('div-2');
  });
});
