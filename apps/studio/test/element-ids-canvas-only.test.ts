// V2-2.19 step 4 — canvas-only metadata (contract V2-1.4 §5.5): the `data-cd-*` namespace on the
// element, in the versioned TSX. Lock / unlock (T2), Hide / Show keeps an inline display (T8),
// readCanvasOnly, the D18 rule (the generic attribute writer never writes `data-cd-*`), and the
// export strip (T7, source + markup + the HTML export's DOM pass).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyDuplicateElement,
  applyEdit,
  applySetHidden,
  applySetLocked,
  CanvasEditError,
  elementPrint,
  listElements,
} from '../canvas-edit.ts';
import { readCanvasOnly, stripCanvasOnly, stripCanvasOnlyMarkup } from '../element-ids.ts';
import { stripDataCdId } from '../handoff.ts';

const CANVAS = '/x/Meta.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="home" label="Home" width={800} height={500}>
        <header className="top">
          <img className="logo" src="/logo.svg" alt="Acme" />
          <nav className="nav" style={{ display: 'flex', gap: 8 }}>
            <a href="#a">Features</a>
          </nav>
          <p className="note">Made in Brno</p>
        </header>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const idOf = (src: string, tag: string) =>
  listElements(CANVAS, src).find((e) => e.print.tag === tag)?.id as string;

describe('lock (T2)', () => {
  test('locking an unstamped element stamps a readable id and adds data-cd-locked', () => {
    const before = elementPrint(CANVAS, SRC, idOf(SRC, 'img'));
    const out = applySetLocked(CANVAS, SRC, idOf(SRC, 'img'), true);
    expect(out.id).toBe('logo');
    expect(out.source).toContain('<img data-cd-id="logo" data-cd-locked className="logo"');
    expect(readCanvasOnly(out.source, 'logo')).toEqual({ locked: true, hiddenPrevDisplay: null });
    // prints ignore every data-cd-* — a lock never re-points a print (T12)
    expect(elementPrint(CANVAS, out.source, 'logo')).toEqual(before);
    // locking again is a no-op
    expect(applySetLocked(CANVAS, out.source, 'logo', true).source).toBe(out.source);
    // unlock removes only the lock; the id stays
    const un = applySetLocked(CANVAS, out.source, 'logo', false);
    expect(un.source).toBe(out.source.replace(' data-cd-locked', ''));
    expect(readCanvasOnly(un.source, 'logo')).toEqual({ locked: false, hiddenPrevDisplay: null });
  });

  test('⌘D on a locked element: the copy has a new id and no lock', () => {
    const locked = applySetLocked(CANVAS, SRC, idOf(SRC, 'img'), true).source;
    const dup = applyDuplicateElement(CANVAS, locked, 'logo');
    expect(dup.newId).toBe('logo-2');
    expect(readCanvasOnly(dup.source, 'logo')?.locked).toBe(true);
    expect(readCanvasOnly(dup.source, 'logo-2')?.locked).toBe(false);
  });

  test('reserved ids are skipped when stamping', () => {
    const out = applySetLocked(CANVAS, SRC, idOf(SRC, 'img'), true, { reserved: ['logo'] });
    expect(out.id).toBe('logo-2');
  });
});

describe('hide / show (T8)', () => {
  test('Hide remembers an inline display: flex, Show restores it', () => {
    const hidden = applySetHidden(CANVAS, SRC, idOf(SRC, 'nav'), true);
    expect(hidden.id).toBe('nav');
    expect(hidden.source).toContain(
      `<nav data-cd-id="nav" data-cd-hidden="flex" className="nav" style={{ display: 'none', gap: 8 }}>`
    );
    expect(readCanvasOnly(hidden.source, 'nav')).toEqual({
      locked: false,
      hiddenPrevDisplay: 'flex',
    });
    expect(applySetHidden(CANVAS, hidden.source, 'nav', true).source).toBe(hidden.source);
    const shown = applySetHidden(CANVAS, hidden.source, 'nav', false);
    expect(shown.source).toContain(
      `<nav data-cd-id="nav" className="nav" style={{ display: 'flex', gap: 8 }}>`
    );
    expect(readCanvasOnly(shown.source, 'nav')).toEqual({ locked: false, hiddenPrevDisplay: null });
  });

  test('Hide with no inline display stores "" and Show removes the display it added', () => {
    const hidden = applySetHidden(CANVAS, SRC, idOf(SRC, 'p'), true);
    expect(hidden.id).toBe('made-in-brno');
    expect(hidden.source).toContain('data-cd-hidden=""');
    expect(hidden.source).toContain(
      `<p style={{ display: 'none' }} data-cd-id="made-in-brno" data-cd-hidden="" className="note">`
    );
    const shown = applySetHidden(CANVAS, hidden.source, 'made-in-brno', false);
    expect(readCanvasOnly(shown.source, 'made-in-brno')).toEqual({
      locked: false,
      hiddenPrevDisplay: null,
    });
    expect(shown.source).toContain(
      '<p data-cd-id="made-in-brno" className="note">Made in Brno</p>'
    );
  });
});

describe('D18: the generic attribute writer never writes data-cd-*', () => {
  test('applyEdit refuses a data-cd-* attribute', () => {
    expect(() => applyEdit(CANVAS, SRC, idOf(SRC, 'img'), 'data-cd-locked', '')).toThrow(
      CanvasEditError
    );
    expect(() => applyEdit(CANVAS, SRC, idOf(SRC, 'img'), 'data-cd-id', 'x')).toThrow(
      CanvasEditError
    );
  });
});

describe('export strip (T7)', () => {
  const marked = applySetHidden(
    CANVAS,
    applySetLocked(CANVAS, SRC, idOf(SRC, 'img'), true).source,
    idOf(SRC, 'nav'),
    true
  ).source;

  test('stripCanvasOnly removes every data-cd-* from TSX, keeps display: none', () => {
    expect(marked).toContain('data-cd-locked');
    const out = stripCanvasOnly(marked, CANVAS);
    expect(out).not.toContain('data-cd-');
    expect(out).toContain("display: 'none'");
    expect(out).toContain('<img className="logo" src="/logo.svg" alt="Acme" />');
  });

  test('the handoff strip is the same prefix strip', () => {
    expect(stripDataCdId(CANVAS, marked)).toBe(stripCanvasOnly(marked, CANVAS));
  });

  test('stripCanvasOnlyMarkup removes data-cd-* from serialized HTML / SVG, nothing else', () => {
    const html =
      '<div data-cd-id="nav" data-cd-hidden="flex" style="display: none"><img data-cd-locked data-cd-id=\'acme\' alt="data-cd-id is text"><p>data-cd-id="x" in prose</p></div>';
    expect(stripCanvasOnlyMarkup(html)).toBe(
      '<div style="display: none"><img alt="data-cd-id is text"><p>data-cd-id="x" in prose</p></div>'
    );
  });

  test('the HTML export strips the data-cd- prefix from its cloned DOM', () => {
    const src = readFileSync(join(import.meta.dir, '../bin/_html-playwright.mjs'), 'utf8');
    const body = src.slice(src.indexOf('const neutralize'), src.indexOf('neutralize(clone)'));
    expect(body).toContain("name.startsWith('data-cd-')");
  });
});
