// S11.8 — the pure halves of Inspector › Advanced: the row registry (append-only; a duplicate id throws), the
// JSX slicer behind "Copy code" (three fixtures, one of them a real canvas of this repo), and the text form of
// the CSS list. No DOM; the rendered fold is v2-inspector-advanced.test.tsx.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADVANCED_GROUPS,
  advancedRowIds,
  advancedRowsFor,
  registerAdvancedRow,
} from '../client/v2/inspector/advanced-rows.js';
import { parseCssText, patchFromText } from '../client/v2/inspector/css-text.js';
import { elementJsx } from '../client/v2/inspector/jsx-slice.js';

const Body = () => null;
const offs: Array<() => void> = [];
const reg = (group: string, e: Record<string, unknown>) => {
  const off = registerAdvancedRow(group, { Body, ...e } as never);
  offs.push(off);
  return off;
};
const cleanup = () => {
  for (const off of offs.splice(0)) off();
};

describe('registerAdvancedRow (S11-slices §2.3)', () => {
  test('a duplicate id throws — across groups, so two packages cannot both own a row', () => {
    try {
      reg('artboard', { id: 'test.theme' });
      expect(() => reg('artboard', { id: 'test.theme' })).toThrow(/already registered/);
      expect(() => reg('in-code', { id: 'test.theme' })).toThrow(/already registered/);
      // the id is free again once its owner lets go
      offs[0]();
      reg('in-code', { id: 'test.theme' });
    } finally {
      cleanup();
    }
  });

  test('an unknown group, a missing id and a missing body are refused', () => {
    expect(() => registerAdvancedRow('nope', { id: 'a', Body } as never)).toThrow(/unknown group/);
    expect(() => registerAdvancedRow('css', { Body } as never)).toThrow(/id required/);
    expect(() => registerAdvancedRow('css', { id: 'test.nobody' } as never)).toThrow(
      /Body required/
    );
  });

  test('rows come back by order, then by who registered first; kinds and when() filter', () => {
    try {
      reg('artboard', { id: 'test.b', order: 20, kinds: ['artboard'] });
      reg('artboard', { id: 'test.a', order: 10, kinds: ['artboard'] });
      reg('artboard', { id: 'test.c', order: 20, kinds: ['artboard'] });
      reg('artboard', { id: 'test.never', order: 5, kinds: ['artboard'], when: () => false });
      reg('artboard', { id: 'test.element-only', order: 1, kinds: ['element'] });
      const ids = advancedRowsFor('artboard', { kind: 'artboard' }).map(
        (r: { id: string }) => r.id
      );
      expect(ids).toEqual(['test.a', 'test.b', 'test.c']);
    } finally {
      cleanup();
    }
  });

  test('the groups are the six the contract names, in the order the fold draws them', () => {
    expect([...ADVANCED_GROUPS]).toEqual([
      'element',
      'used-in',
      'tokens',
      'css',
      'artboard',
      'in-code',
    ]);
    expect(advancedRowIds('artboard')).toEqual(advancedRowIds('artboard')); // stable
  });
});

describe('Copy code: the element JSX cut out of the canvas source', () => {
  test('fixture 1 — text with an apostrophe, a `<` inside a string, a self-closing sibling', () => {
    const src = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function Home() {
  const go = (to: string) => to;
  return (
    <DesignCanvas>
      <DCArtboard id="desktop">
        <nav data-cd-id="nav">
          <button data-cd-id="book-call" className="cta" onClick={() => go('a<b')}>
            Don't wait {count < 3 ? 'now' : 'later'}
          </button>
          <img data-cd-id="logo" src="x.svg" />
        </nav>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
    expect(elementJsx(src, 'logo')).toBe('<img data-cd-id="logo" src="x.svg" />');
    expect(elementJsx(src, 'book-call')).toBe(
      `<button data-cd-id="book-call" className="cta" onClick={() => go('a<b')}>
  Don't wait {count < 3 ? 'now' : 'later'}
</button>`
    );
    const nav = elementJsx(src, 'nav') ?? '';
    expect(nav.startsWith('<nav data-cd-id="nav">')).toBe(true);
    expect(nav.endsWith('</nav>')).toBe(true);
    expect(nav).toContain('<img data-cd-id="logo" src="x.svg" />');
    // the nav's own indentation is gone, its children keep theirs relative to it
    expect(nav.split('\n')[1]).toBe(
      '  <button data-cd-id="book-call" className="cta" onClick={() => go(\'a<b\')}>'
    );
  });

  test('fixture 2 — the same id twice: the index picks the occurrence (a .map or a branch)', () => {
    const src = `export default function C() {
  return (
    <ul>
      {ok ? <li data-cd-id="row" key="a">First</li> : <li data-cd-id="row" key="b">Second</li>}
      {items.map((it) => (
        <li data-cd-id="row" key={it}>
          {it}
        </li>
      ))}
    </ul>
  );
}`;
    expect(elementJsx(src, 'row', 0)).toBe('<li data-cd-id="row" key="a">First</li>');
    expect(elementJsx(src, 'row', 1)).toBe('<li data-cd-id="row" key="b">Second</li>');
    expect(elementJsx(src, 'row', 2)).toBe(`<li data-cd-id="row" key={it}>
  {it}
</li>`);
    // an index past the last falls back to the first rather than copying nothing
    expect(elementJsx(src, 'row', 9)).toBe('<li data-cd-id="row" key="a">First</li>');
  });

  test('fixture 3 — a real canvas of this repo: multi-line attributes, a style object, nested tags', () => {
    const file = join(import.meta.dir, '../../../.design/ui/Web Artboards Lab.tsx');
    const src = readFileSync(file, 'utf8');
    const nav = elementJsx(src, 'wal-hero-nav') ?? '';
    expect(nav.startsWith('<header\n  data-cd-id="wal-hero-nav"\n  style={{')).toBe(true);
    expect(nav).toContain('<strong>Acme</strong>');
    expect(nav).toContain('<span>Pricing</span>');
    expect(nav.endsWith('</header>')).toBe(true);
    // it stops at its own closing tag: the next sibling is not in it
    expect(nav).not.toContain('wal-hero-body');
    const body = elementJsx(src, 'wal-hero-body') ?? '';
    expect(body.startsWith('<section')).toBe(true);
    expect(body).toContain('Build responsibly.');
    expect(body.endsWith('</section>')).toBe(true);
  });

  test('an id that is not in the file, or a file that is not JSX, answers null — never half an element', () => {
    expect(elementJsx('export const a = 1;', 'x')).toBeNull();
    expect(elementJsx('<div data-cd-id="x">', 'x')).toBeNull(); // never closed
    expect(elementJsx('<div data-cd-id="y"/>', 'x')).toBeNull();
    expect(elementJsx('', 'x')).toBeNull();
    expect(elementJsx(null as never, 'x')).toBeNull();
    expect(elementJsx('<div data-cd-id="x"/>', '')).toBeNull();
  });
});

describe('Edit as text: the CSS block', () => {
  test('lines and semicolons end a declaration; a url(data:…;base64) stays whole', () => {
    const { decls, bad } = parseCssText(
      'padding: 12px 24px;\nBACKGROUND: url(data:image/png;base64,AAA=) no-repeat\n--ink: #111; color: red'
    );
    expect(bad).toEqual([]);
    expect(decls).toEqual([
      ['padding', '12px 24px'],
      ['background', 'url(data:image/png;base64,AAA=) no-repeat'],
      ['--ink', '#111'],
      ['color', 'red'],
    ]);
  });

  test('a line without a property and a value is named by its number', () => {
    expect(parseCssText('color: red;\njust words\nwidth:').bad).toEqual([2, 3]);
  });

  test('applying it writes only what changed; a line taken away resets that property', () => {
    const el = {
      authored: { padding: '12px 24px', background: 'var(--ink)' },
      customStyles: { 'letter-spacing': '1px' },
    };
    const { patch, bad } = patchFromText(
      el,
      'padding: 12px 24px;\nbackground: red;\ncursor: pointer;'
    );
    expect(bad).toEqual([]);
    expect(patch).toEqual({ background: 'red', cursor: 'pointer', 'letter-spacing': null });
  });

  test('canvas-only data-cd-* names never enter the text and never leave it', () => {
    const el = { authored: { 'data-cd-note': 'x', color: 'red' } };
    expect(patchFromText(el, 'color: red;\ndata-cd-note: y;').patch).toEqual({});
  });
});
