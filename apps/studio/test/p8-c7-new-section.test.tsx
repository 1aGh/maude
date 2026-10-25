// V2-8.5 c7 (08 ak-web-hug) — the page grew: the new section is framed and named beside "+ 373 px".
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ArtboardNewSection,
  freshChildren,
  sectionHost,
  sectionName,
} from '../artboard-new-section.tsx';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const dom = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
};

describe('sectionHost', () => {
  test('goes down through single-child wrappers to the container of the sections', () => {
    const body = dom('<main><div class="page"><header></header><section></section></div></main>');
    expect(sectionHost(body)?.className).toBe('page');
  });

  test('a page that is one block has no sections to compare', () => {
    expect(sectionHost(dom('<main><p>x</p></main>'))).toBeNull();
  });
});

describe('freshChildren', () => {
  test('the first look is the baseline: nothing is new', () => {
    expect(freshChildren(null, ['a', 'b'])).toEqual([]);
    expect(freshChildren(new Set<string>(), ['a', 'b'])).toEqual([]);
  });

  test('a child that was not seen before is the new one', () => {
    expect(freshChildren(new Set(['a', 'b']), ['a', 'c', 'b'])).toEqual(['c']);
  });
});

describe('sectionName', () => {
  test('authored name, aria-label, first heading, then the plain word', () => {
    const one = (html: string) => dom(html).firstElementChild as Element;
    expect(sectionName(one('<section data-dc-element="match-table"></section>'))).toBe(
      'Match Table'
    );
    expect(sectionName(one('<section aria-label="Rozpis"></section>'))).toBe('Rozpis');
    expect(sectionName(one('<section><h2>Rozpis zápasů</h2><p>x</p></section>'))).toBe(
      'Rozpis zápasů'
    );
    expect(sectionName(one('<section></section>'))).toBe('Section');
    expect(sectionName(one('<div></div>'))).toBe('Frame');
  });
});

describe('ArtboardNewSection', () => {
  test('nothing without a new section', () => {
    expect(renderToStaticMarkup(<ArtboardNewSection x={0} y={0} section={null} />)).toBe('');
  });

  test('a frame at the section, named "<name> · new section", exporter-hidden and inert', () => {
    const out = renderToStaticMarkup(
      <ArtboardNewSection
        x={100}
        y={50}
        section={{ name: 'Rozpis zápasů', x: 0, y: 205, w: 432, h: 112 }}
      />
    );
    expect(out).toContain('Rozpis zápasů · new section');
    expect(out).toContain('left:100px');
    expect(out).toContain('top:255px');
    expect(out).toContain('dc-artboard-guides');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('pointer-events:none');
    expect(out).toContain('var(--dc-zoom, 1)');
  });
});

describe('wiring', () => {
  const root = new URL('../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

  test('canvas-lib watches the page body and draws the frame; the growth tag is screen-sized', () => {
    const lib = read('canvas-lib.tsx');
    expect(lib).toContain('useNewSection(bodyRef');
    expect(lib).toContain('<ArtboardNewSection');
    expect(read('artboard-growth-tag.tsx')).toContain('var(--dc-zoom, 1)');
  });
});
