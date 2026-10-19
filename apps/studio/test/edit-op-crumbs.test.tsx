// S2.1 (artboard ed-obj-enter) — the selection model: crumbs from a nested fixture, the esc ladder
// (one level out, then nothing to step to), a click on a locked object selects its parent, the kind
// rule, refs on select-set, and the inspector crumbs (clickable rungs + esc).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { buildCrumbs, crumbsText, nameTag, selectionKind } from '../editing/crumbs.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

// The ed-obj-enter fixture: Desktop › Services › Brand systems (+ a locked logo, a text leaf).
const FIXTURE = `
<article class="dc-artboard" data-dc-screen="desktop">
  <header class="dc-artboard-label sku">Desktop</header>
  <div class="dc-artboard-body">
    <section data-cd-id="services" data-dc-element="services">
      <article data-cd-id="brand-systems" data-dc-element="brand-systems">
        <h3 data-cd-id="title">Brand systems for growing studios</h3>
        <img data-cd-id="logo" data-cd-locked src="/logo.svg" alt="" />
      </article>
    </section>
    <footer data-cd-id="footer" data-cd-locked>Footer</footer>
  </div>
</article>`;

const sel = (id: string) => ({
  id,
  selector: `[data-dc-screen="desktop"] [data-cd-id="${id}"]`,
  artboardId: 'desktop',
  index: 0,
});

describe('crumbs (pure)', () => {
  test('artboard › frames › object, with refs; the artboard rung has none', () => {
    const c = buildCrumbs('desktop', [
      { id: null, tag: 'article', artboardLabel: 'Desktop' },
      { id: 'services', tag: 'section', name: 'services' },
      { id: 'brand-systems', tag: 'article', name: 'brand-systems' },
    ]);
    expect(crumbsText(c)).toBe('Desktop › Services › Brand systems');
    expect(c.map((x) => x.ref)).toEqual([
      null,
      { artboard: 'desktop', element: 'services' },
      { artboard: 'desktop', element: 'brand-systems' },
    ]);
  });
  test('labels fall back: layer name → aria → first three words → tag', () => {
    const c = buildCrumbs('a', [
      { id: 'x1', tag: 'div', aria: 'Main menu' },
      { id: 'x2', tag: 'p', text: 'Made in Brno, Czechia' },
      { id: 'x3', tag: 'div' },
    ]);
    expect(c.map((x) => x.label)).toEqual(['Main menu', 'Made in Brno,', 'div']);
  });
  test('G8: a shape the drawing tools made is named by its id, a name or text still wins', () => {
    const c = buildCrumbs('a', [
      { id: 'rectangle', tag: 'div' },
      { id: 'ellipse-2', tag: 'div' },
      { id: 'rectangle-3', tag: 'div', name: 'Hero card' },
      { id: 'frame', tag: 'div', text: 'Hello there friend' },
      { id: 'rectangles', tag: 'div' },
    ]);
    expect(c.map((x) => x.label)).toEqual([
      'Rectangle',
      'Ellipse',
      'Hero card',
      'Hello there friend',
      'div',
    ]);
    expect(nameTag(c[0].label, 120, 27)).toBe('Rectangle · 120 × 27');
  });
  test('name tag and kind', () => {
    expect(nameTag('Brand systems', 400.4, 231.6)).toBe('Brand systems · 400 × 232');
    expect(selectionKind(3, null)).toBe('multi');
    expect(selectionKind(1, null)).toBe('artboard');
    expect(selectionKind(1, { tag: 'P', elements: 0, hasText: true })).toBe('text');
    expect(selectionKind(1, { tag: 'img', elements: 0, hasText: false })).toBe('image');
    expect(selectionKind(1, { tag: 'section', elements: 2, hasText: false })).toBe('frame');
    expect(selectionKind(1, { tag: 'div', elements: 1, hasText: false, component: true })).toBe(
      'instance'
    );
  });
});

describe('the selection model on the DOM', () => {
  test('crumbs and kind from the nested fixture; refs on every selection', async () => {
    document.body.innerHTML = FIXTURE;
    const { describeSelection } = await import('../editing/selection.tsx');
    const d = describeSelection(document, [sel('brand-systems')]);
    expect(crumbsText(d.crumbs ?? [])).toBe('Desktop › Services › Brand systems');
    expect(d.kind).toBe('frame');
    expect(d.refs).toEqual([{ artboard: 'desktop', element: 'brand-systems' }]);
    const two = describeSelection(document, [sel('services'), sel('footer')]);
    expect(two.kind).toBe('multi');
    expect(two.crumbs).toBeUndefined();
    expect(two.refs.length).toBe(2);
  });

  test('esc ladder: one level out per press, then nothing to step to (deselect)', async () => {
    document.body.innerHTML = FIXTURE;
    const { stepOut } = await import('../editing/selection.tsx');
    let selected = [sel('title')] as Array<ReturnType<typeof sel>>;
    const set = {
      get selected() {
        return selected;
      },
      replace: (s: ReturnType<typeof sel>) => {
        selected = [s];
      },
    };
    expect(stepOut(set, document)).toBe(true);
    expect(selected[0]?.id).toBe('brand-systems');
    expect(stepOut(set, document)).toBe(true);
    expect(selected[0]?.id).toBe('services');
    expect(stepOut(set, document)).toBe(false); // at the top: the caller deselects
  });

  test('↵ goes inside: the first object of the frame', async () => {
    document.body.innerHTML = FIXTURE;
    const { enterSelection } = await import('../editing/selection.tsx');
    expect(enterSelection(document, sel('services'))?.id).toBe('brand-systems');
    expect(enterSelection(document, sel('title'))).toBeNull();
  });

  test('a click on a locked object selects its nearest unlocked parent, or the artboard', async () => {
    document.body.innerHTML = FIXTURE;
    const { isLockedDom, lockedClickSelection } = await import('../editing/selection.tsx');
    const logo = document.querySelector('[data-cd-id="logo"]') as Element;
    expect(lockedClickSelection(logo, isLockedDom)?.id).toBe('brand-systems');
    const footer = document.querySelector('[data-cd-id="footer"]') as Element;
    const up = lockedClickSelection(footer, isLockedDom);
    expect(up?.id).toBeUndefined();
    expect(up?.artboardId).toBe('desktop');
  });
});

describe('inspector crumbs', () => {
  async function mount(el: React.ReactElement): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
    return host;
  }
  test('every rung above the object selects that level; esc shows for an object', async () => {
    const { InspectorCrumbs } = await import('../client/v2/inspector/crumbs.jsx');
    const picked: unknown[] = [];
    const crumbs = buildCrumbs('desktop', [
      { id: null, tag: 'article', artboardLabel: 'Desktop' },
      { id: 'services', tag: 'section', name: 'services' },
      { id: 'brand-systems', tag: 'article', name: 'brand-systems' },
    ]);
    const host = await mount(
      <InspectorCrumbs crumbs={crumbs} onPick={(r: unknown) => picked.push(r)} />
    );
    const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    expect(q('inspector-crumbs').textContent).toContain('Desktop');
    expect(q('inspector-crumb-2').tagName).toBe('SPAN');
    expect(q('inspector-crumb-2').getAttribute('aria-current')).toBe('location');
    expect(q('inspector-crumbs-esc').textContent).toBe('esc');
    await act(async () => q('inspector-crumb-1').click());
    await act(async () => q('inspector-crumb-0').click());
    expect(picked).toEqual([{ artboard: 'desktop', element: 'services' }, null]);
  });
});
