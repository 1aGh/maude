// S2.22 G5 / G7 — the right-click menus say what the canvas says (14 Editing, ed-ab-menu / ed-obj-order):
//   Ask AI about “Desktop” ⌘/        (the artboard's own name, typographic quotes)
//   Ask AI about “Book a call” ⌘/    (the object's words) · Select matching, "same style"
// The static `label` stays the word lists and screen readers rely on; `labelOf` names the click.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import { ContextMenuView, type ContextTarget, type MenuItem } from '../context-menu.tsx';
import { artboardMenuSections, artboardNameOf } from '../editing/artboard-menu.tsx';
import { ASK_OBJECTS_EVENT, askAboutWords } from '../editing/ask-bubble.tsx';
import { objectMenuSections, objectNameOf } from '../editing/object-menu.tsx';

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const FIXTURE = `
<article class="dc-artboard" data-dc-screen="desktop" data-dc-label="Desktop">
  <button class="dc-artboard-label">Desktop</button>
  <div class="dc-artboard-body">
    <a data-cd-id="cta" class="nav">  Book   a call </a>
    <div data-cd-id="plain"></div>
  </div>
</article>`;
const q = (sel: string) => document.querySelector(sel) as Element;
const target = (el: Element, kind: ContextTarget['kind']): ContextTarget => ({
  kind,
  el,
  cdId: null,
  artboardId: 'desktop',
  clientX: 10,
  clientY: 10,
});

async function draw(sections: MenuItem[][], t: ContextTarget): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(<ContextMenuView target={t} sections={sections} onClose={() => {}} />)
  );
  return document.body;
}

describe('G5 — the artboard menu names the artboard', () => {
  const noop = () => {};
  const deps = {
    duplicate: noop,
    duplicateAtWidth: noop,
    customWidth: noop,
    rename: noop,
    resetPosition: noop,
  };

  test('the name is read off the board', () => {
    document.body.innerHTML = FIXTURE;
    expect(artboardNameOf(target(q('.dc-artboard-label'), 'artboard-chrome'))).toBe('Desktop');
    // no element under the pointer: the artboard id finds the board
    expect(artboardNameOf({ ...target(q('body'), 'artboard-chrome'), el: null })).toBe('Desktop');
  });

  test('the drawn row reads Ask AI about “Desktop” with typographic quotes, ⌘/ beside it', async () => {
    document.body.innerHTML = FIXTURE;
    const body = await draw(
      artboardMenuSections([], deps),
      target(q('.dc-artboard-label'), 'artboard-chrome')
    );
    const row = body.querySelector('[data-testid="canvas-menu-item-ask-ai"]');
    expect(row?.textContent).toContain('Ask AI about “Desktop”');
    expect(row?.textContent).toContain('⌘/');
  });

  test('an artboard that says no name keeps the static words; Add comment is still there', () => {
    document.body.innerHTML = '<article data-dc-screen="x"></article>';
    const sections = artboardMenuSections(
      [[{ id: 'add-comment', label: 'Add comment', shortcut: 'C', onSelect: noop }]],
      deps
    );
    const ask = sections.flat().find((i) => i.id === 'ask-ai') as MenuItem;
    expect(ask.label).toBe('Ask AI about this artboard');
    expect(
      ask.labelOf?.({ ...target(q('article'), 'artboard-chrome'), artboardId: 'x' })
    ).toBeNull();
    expect(sections.flat().some((i) => i.id === 'add-comment')).toBe(true);
  });
});

describe('G7 — the object menu opens with Ask AI and hints Select matching', () => {
  const sections = () =>
    objectMenuSections([], {
      elementsFor: () => [q('[data-cd-id="cta"]')],
      run: () => {},
      selectMatching: () => {},
    });

  test('the object’s own words name the row', () => {
    document.body.innerHTML = FIXTURE;
    expect(objectNameOf([q('[data-cd-id="cta"]')])).toBe('Book a call');
    expect(objectNameOf([q('[data-cd-id="plain"]')])).toBe('div');
    expect(objectNameOf([q('[data-cd-id="cta"]'), q('[data-cd-id="plain"]')])).toBe('2 objects');
    expect(objectNameOf([])).toBeNull();
    expect(askAboutWords('Book a call')).toBe('Ask AI about “Book a call”');
  });

  test('the first row of the list is Ask AI ⌘/, and it asks about the selection', async () => {
    document.body.innerHTML = FIXTURE;
    const s = sections();
    const first = s[0]?.[0] as MenuItem;
    expect(first.id).toBe('ask-ai-object');
    expect(first.shortcut).toBe('⌘/');
    let asked = 0;
    window.addEventListener(ASK_OBJECTS_EVENT, () => asked++);
    first.onSelect(target(q('[data-cd-id="cta"]'), 'element'));
    expect(asked).toBe(1);
    const body = await draw(s, target(q('[data-cd-id="cta"]'), 'element'));
    expect(
      body.querySelector('[data-testid="canvas-menu-item-ask-ai-object"]')?.textContent
    ).toContain('Ask AI about “Book a call”');
  });

  test('Select matching carries the quiet hint “same style”', async () => {
    document.body.innerHTML = FIXTURE;
    const body = await draw(sections(), target(q('[data-cd-id="cta"]'), 'element'));
    const row = body.querySelector('[data-testid="canvas-menu-item-select-matching"]');
    expect(row?.textContent).toContain('Select matching');
    expect(row?.querySelector('.dc-menu-note')?.textContent).toBe('same style');
  });
});
