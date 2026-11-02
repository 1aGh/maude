// P8 stage C round 10 (14 ed-pen): a Pen path is a Path — in Layers, in the inspector's name, with its Stroke read
// from the file (colour, width, Ends) — not an "Icon" with "Stroke: None".
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('14 ed-pen: the name of a drawn path', () => {
  test('an svg the Pen drew is "Path" in Layers; a named one keeps its name; a plain svg is still an Icon', async () => {
    const { serializeArtboardTree } = await import('../canvas-shell.tsx');
    document.body.innerHTML = `<div id="root">
      <svg data-cd-id="p1" data-shape="path"><path d="M0 0L9 9"/></svg>
      <svg data-cd-id="p2" data-shape="path" data-dc-element="swoosh"><path d="M0 0L9 9"/></svg>
      <svg data-cd-id="i1"><path d="M0 0L9 9"/></svg>
      <div data-cd-id="r1" data-shape="rectangle"></div>
    </div>`;
    const nodes = serializeArtboardTree(document.getElementById('root') as Element);
    const label = (id: string) => nodes.find((n) => n.id === id)?.label;
    expect(label('p1')).toBe('Path');
    expect(label('p2')).toBe('Swoosh');
    expect(label('i1')).toBe('Icon');
    expect(label('r1')).toBe('Rectangle');
  });
});

describe('14 ed-pen: the path’s stroke is read into the selection', () => {
  test('stroke, width, ends and joins land in `authored` (the Stroke and Ends rows read them)', async () => {
    const { hoverTargetToSelection } = await import('../dom-selection.ts');
    document.body.innerHTML = `<svg data-cd-id="aaaaaaaa" data-shape="path" style="stroke: var(--accent); stroke-width: 4px; stroke-linecap: butt; stroke-linejoin: round; fill: none"><path d="M0 0L9 9"/></svg>`;
    const el = document.querySelector('[data-cd-id]') as Element;
    const sel = hoverTargetToSelection({ el, cdId: 'aaaaaaaa', artboardId: null } as never);
    expect(sel.authored?.stroke).toBe('var(--accent)');
    expect(sel.authored?.['stroke-width']).toBe('4px');
    expect(sel.authored?.['stroke-linecap']).toBe('butt');
    expect(sel.authored?.['stroke-linejoin']).toBe('round');
    // …and are no longer double-listed as custom CSS
    expect(sel.customStyles?.stroke).toBeUndefined();
  });
});
