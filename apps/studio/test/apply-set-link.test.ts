// S3.10a — the link writers (contract client/v2/contracts/S3-links-format.md §3, §10 row 2).
//
// One write stamps the id (when the element has none) and sets `data-cd-link`; the byte diff is the id plus the
// link and nothing else. Idempotent; replaces in place; clear keeps the id; a copy keeps the link and gets a new
// id; the refused schemes never reach the file; every exporter strips the link.

import { describe, expect, test } from 'bun:test';
import {
  applyClearLink,
  applyDuplicateElement,
  applySetLink,
  CanvasEditError,
  LinkTargetError,
  listElements,
  readLinks,
} from '../canvas-edit.ts';
import { CLEAR_LINK_OP } from '../edit-ops/clear-link.ts';
import { SET_LINK_OP } from '../edit-ops/set-link.ts';
import { stripCanvasOnly, stripCanvasOnlyMarkup } from '../element-ids.ts';
import { stripDataCdId } from '../handoff.ts';

const CANVAS = '/x/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <button className="cta">See pricing</button>
        <a data-cd-id="book" href="#x">Book a call</a>
      </DCArtboard>
      <DCArtboard id="pricing" label="Pricing" width={800} height={500}>
        <p>Plans</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const idOf = (src: string, tag: string) =>
  listElements(CANVAS, src).find((e) => e.print.tag === tag)?.id as string;

describe('applySetLink', () => {
  test('one write stamps the id and adds the link; the diff is the id + link only', () => {
    const out = applySetLink(CANVAS, SRC, idOf(SRC, 'button'), '#pricing');
    expect(out.id).toBe('see-pricing');
    expect(out.source).toBe(
      SRC.replace(
        '<button className="cta">',
        '<button data-cd-id="see-pricing" data-cd-link="#pricing" className="cta">'
      )
    );
    expect(readLinks(out.source, CANVAS)).toEqual([
      {
        id: 'see-pricing',
        artboardId: 'desktop',
        line: 6,
        raw: '#pricing',
        target: { kind: 'artboard', artboard: 'pricing' },
      },
    ]);
  });

  test('an element that has an id gets the link right after it', () => {
    const out = applySetLink(CANVAS, SRC, 'book', 'https://Cal.com/studio');
    expect(out.source).toContain(
      '<a data-cd-id="book" data-cd-link="https://cal.com/studio" href="#x">'
    );
  });

  test('idempotent, and a new value replaces the old one in place', () => {
    const once = applySetLink(CANVAS, SRC, 'book', 'site/pricing.tsx#desktop').source;
    expect(applySetLink(CANVAS, once, 'book', 'site/pricing.tsx#desktop').source).toBe(once);
    const changed = applySetLink(CANVAS, once, 'book', '#pricing').source;
    expect(changed).toBe(
      once.replace('data-cd-link="site/pricing.tsx#desktop"', 'data-cd-link="#pricing"')
    );
    expect(changed.match(/data-cd-link/g)?.length).toBe(1);
  });

  test('refused targets never reach the file', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      '../outside.tsx',
      '_draw/x.tsx',
      'http://localhost/',
      'https://cal.com/a&amp;b',
    ]) {
      let err: unknown = null;
      try {
        applySetLink(CANVAS, SRC, 'book', bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(LinkTargetError);
      expect(err).toBeInstanceOf(CanvasEditError); // the dispatcher answers `invalid`
      expect((err as LinkTargetError).code).toBe('link-format');
    }
  });

  test('a copy keeps the link and gets a new id', () => {
    const linked = applySetLink(CANVAS, SRC, 'book', '#pricing').source;
    const dup = applyDuplicateElement(CANVAS, linked, 'book');
    const links = readLinks(dup.source, CANVAS);
    expect(links.map((l) => [l.id, l.raw])).toEqual([
      ['book', '#pricing'],
      [dup.newId, '#pricing'],
    ]);
    expect(dup.newId).not.toBe('book');
  });
});

describe('applyClearLink', () => {
  test('removes the link and keeps the id', () => {
    const linked = applySetLink(CANVAS, SRC, idOf(SRC, 'button'), '#pricing');
    const cleared = applyClearLink(CANVAS, linked.source, linked.id);
    expect(cleared.source).toBe(linked.source.replace(' data-cd-link="#pricing"', ''));
    expect(cleared.source).toContain('data-cd-id="see-pricing"');
  });

  test('no-op when there is no link (no id is stamped either)', () => {
    expect(applyClearLink(CANVAS, SRC, 'book').source).toBe(SRC);
    expect(applyClearLink(CANVAS, SRC, idOf(SRC, 'button')).source).toBe(SRC);
  });
});

describe('readLinks', () => {
  test('an expression value is reported invalid with its source text', () => {
    const src = SRC.replace('href="#x"', 'data-cd-link={to} href="#x"');
    const [l] = readLinks(src, CANVAS);
    expect(l?.id).toBe('book');
    expect(l?.target).toBeNull();
    expect(l?.raw).toBe('{to}');
  });
});

describe('edit-op writers (S2 dispatch)', () => {
  const req = (params: Record<string, unknown>, element = 'book') => ({
    file: 'Home.tsx',
    op: 'element.set-link',
    targets: [{ artboard: 'desktop', element }],
    params,
  });

  test('element.set-link is one returned source', () => {
    expect(SET_LINK_OP.id).toBe('element.set-link');
    const out = SET_LINK_OP.apply(SRC, req({ target: '#pricing' }));
    expect(out.source).toBe(
      SRC.replace('<a data-cd-id="book"', '<a data-cd-id="book" data-cd-link="#pricing"')
    );
  });

  test('element.set-link refuses a missing or bad target, and more than one object', () => {
    expect(() => SET_LINK_OP.apply(SRC, req({}))).toThrow(CanvasEditError);
    expect(() => SET_LINK_OP.apply(SRC, req({ target: 'javascript:x' }))).toThrow(LinkTargetError);
    expect(() =>
      SET_LINK_OP.apply(SRC, {
        ...req({ target: '#pricing' }),
        targets: [
          { artboard: 'desktop', element: 'book' },
          { artboard: 'desktop', element: 'book' },
        ],
      })
    ).toThrow(CanvasEditError);
  });

  test('element.clear-link removes it', () => {
    expect(CLEAR_LINK_OP.id).toBe('element.clear-link');
    const linked = SET_LINK_OP.apply(SRC, req({ target: '#pricing' })).source;
    expect(CLEAR_LINK_OP.apply(linked, { ...req({}), op: 'element.clear-link' }).source).toBe(SRC);
  });
});

describe('export strip (handoff, HTML, copy-as-code)', () => {
  const linked = applySetLink(CANVAS, SRC, 'book', 'https://cal.com/studio').source;
  test('TSX exporters carry no data-cd-link', () => {
    expect(stripCanvasOnly(linked, CANVAS)).not.toContain('data-cd-link');
    expect(stripDataCdId(CANVAS, linked)).not.toContain('data-cd-link');
  });
  test('serialized markup carries no data-cd-link', () => {
    expect(
      stripCanvasOnlyMarkup(
        '<a data-cd-id="book" data-cd-link="https://cal.com/studio" href="#x">Book</a>'
      )
    ).toBe('<a href="#x">Book</a>');
  });
});
