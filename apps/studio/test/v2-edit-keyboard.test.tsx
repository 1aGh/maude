// S2.21 (artboard ed-edge-keys) — keyboard only: tab in reading order with its badges, what VoiceOver hears, the
// focus ring that is not the selection, F6 between the panels and the canvas, and R·T·F then ↵. The pieces are
// pure over small measurements, so the walker runs over a fixture without a layout engine.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { AGENT_PATHS } from '../actions/agents.ts';
import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { chordFromEvent } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { acceptFromCanvas } from '../bridge/dgn-protocol.ts';
import { sendAskSelection, subscribeAskSelection } from '../client/v2/ai/ask-selection.js';
import { createAskSelectionLane } from '../client/v2/ai/ask-selection-lane.js';
import { artboardScope, elementsScope } from '../client/v2/ai/scope.js';
import {
  cycleRegion,
  entryOf,
  nextIndex,
  onScreen,
  readingOrder,
  regionOf,
  regionsIn,
} from '../client/v2/shell/f6-cycle.js';
import { describeFocus, factsOf } from '../editing/aria-live.tsx';
import { artboardMenuSections } from '../editing/artboard-menu.tsx';
import { askArtboardPayload } from '../editing/ask-bubble.tsx';
import { planDraw } from '../editing/draw-tools.tsx';
import {
  centredClick,
  createDefault,
  createModality,
  createPoint,
  FOCUS_RING_CSS,
  FOCUS_RING_TOKEN,
  isCreateTool,
  isNavigationKey,
  SELECTION_TOKEN,
} from '../editing/focus-model.tsx';
import { selectionForElement } from '../editing/selection.tsx';
import {
  badgesFor,
  type Measure,
  orderBadge,
  positionOf,
  readsBefore,
  siblingsOf,
  stepFrom,
  stepSelection,
} from '../editing/tab-order.tsx';
import { TOOLBAR_INSERT_EVENT } from '../input-router.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => {
  document.body.innerHTML = '';
});

// ── the fixture: the design's "Services" page, its source order scrambled on purpose ──────────────────────

type R = { left: number; top: number; width: number; height: number };
const M: Measure = {
  rectOf(e) {
    const [left, top, width, height] = (e.getAttribute('data-r') ?? '0,0,0,0')
      .split(',')
      .map(Number);
    return { left, top, width, height } as R;
  },
  shown: (e) => e.getAttribute('data-hidden') == null,
};

function page() {
  document.body.innerHTML = `
  <article data-dc-screen="desk"><div class="dc-artboard-body">
    <footer data-cd-id="foot" data-dc-element="footer" data-r="0,1120,1440,100">Made in Brno</footer>
    <section data-cd-id="svc" data-dc-element="Services" data-r="0,520,1440,300" style="display:flex;flex-direction:row">
      <div data-cd-id="card-c" data-dc-element="Brand systems" data-r="980,540,400,240"><p data-cd-id="c-title" data-r="990,550,200,20">Brand</p></div>
      <div data-cd-id="card-a" data-dc-element="Websites" data-r="40,540,400,240"></div>
      <div data-cd-id="card-b" data-dc-element="Motion" data-r="510,541,400,239"></div>
    </section>
    <h1 data-cd-id="eyebrow" data-r="0,480,1440,40">Calm software</h1>
    <section data-cd-id="work" data-dc-element="Work" data-r="0,820,1440,300"><div data-cd-id="w1" data-r="0,830,100,100"></div></section>
    <nav data-cd-id="nav" data-dc-element="Navigation" data-r="0,0,1440,80"><a data-cd-id="logo" data-r="10,10,40,40">M</a></nav>
    <section data-cd-id="hero" data-dc-element="Hero" data-r="0,80,1440,400"></section>
  </div></article>`;
}
const el = (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as Element;
const sel = (id: string) => selectionForElement(el(id));
const idOf = (e: Element | null) => e?.getAttribute('data-cd-id');

describe('reading order', () => {
  test('a row reads left to right, a column top to bottom, a 1 px offset is still one row', () => {
    const r = (left: number, top: number): R => ({ left, top, width: 100, height: 100 });
    expect(Math.sign(readsBefore(r(0, 0), r(200, 0)))).toBe(-1);
    expect(Math.sign(readsBefore(r(200, 1), r(0, 0)))).toBe(1);
    expect(Math.sign(readsBefore(r(500, 0), r(0, 300)))).toBe(-1);
  });

  test('the top level is the page order 1…6, whatever the source order is', () => {
    page();
    expect(siblingsOf(el('nav'), M).map(idOf)).toEqual([
      'nav',
      'hero',
      'eyebrow',
      'svc',
      'work',
      'foot',
    ]);
  });

  test('inside Services the cards read 4.1…4.3 by where they are drawn', () => {
    page();
    expect(siblingsOf(el('card-a'), M).map(idOf)).toEqual(['card-a', 'card-b', 'card-c']);
    expect(
      ['svc', 'card-a', 'card-b', 'card-c', 'c-title'].map((i) => orderBadge(el(i), M))
    ).toEqual(['4', '4.1', '4.2', '4.3', '4.3.1']);
  });

  test('tab goes to the next object on the level, ⇧tab back; the ends wrap', () => {
    page();
    expect(idOf(stepFrom(document, [sel('hero')], 1, M))).toBe('eyebrow');
    expect(idOf(stepFrom(document, [sel('hero')], -1, M))).toBe('nav');
    expect(idOf(stepFrom(document, [sel('foot')], 1, M))).toBe('nav');
    expect(idOf(stepFrom(document, [sel('nav')], -1, M))).toBe('foot');
  });

  test('tab inside a frame stays inside it', () => {
    page();
    expect(idOf(stepFrom(document, [sel('card-a')], 1, M))).toBe('card-b');
    expect(idOf(stepFrom(document, [sel('card-c')], 1, M))).toBe('card-a');
  });

  test('nothing selected takes the first object of the first artboard; an artboard takes its first', () => {
    page();
    expect(idOf(stepFrom(document, [], 1, M))).toBe('nav');
    expect(idOf(stepFrom(document, [], -1, M))).toBe('foot');
    const board = { selector: '[data-dc-screen="desk"]', artboardId: 'desk' };
    expect(idOf(stepFrom(document, [board], 1, M))).toBe('nav');
  });

  test('a page with nothing stamped has nowhere to go', () => {
    document.body.innerHTML =
      '<article data-dc-screen="a"><div class="dc-artboard-body"></div></article>';
    expect(stepFrom(document, [], 1, M)).toBeNull();
  });

  test('a hidden object is skipped', () => {
    page();
    el('eyebrow').setAttribute('data-hidden', '1');
    expect(idOf(stepFrom(document, [sel('hero')], 1, M))).toBe('svc');
  });

  test('stepSelection returns a selection select-set can carry', () => {
    page();
    const next = stepSelection(document, [sel('nav')], 1, M);
    expect(next?.id).toBe('hero');
    expect(next?.artboardId).toBe('desk');
  });

  test('badges: 1…6 on the level (the focused one on), the children dashed 4.1…4.3', () => {
    page();
    const b = badgesFor(el('svc'), M);
    expect(b.filter((x) => !x.inside).map((x) => x.text)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(b.filter((x) => x.on).map((x) => x.text)).toEqual(['4']);
    expect(b.filter((x) => x.inside).map((x) => x.text)).toEqual(['4.1', '4.2', '4.3']);
  });

  test('a level inside a frame is numbered under its parent', () => {
    page();
    expect(
      badgesFor(el('card-b'), M)
        .filter((x) => !x.inside)
        .map((x) => x.text)
    ).toEqual(['4.1', '4.2', '4.3']);
  });
});

// V2-8.5 c7 (14 ed-edge-keys): an artboard's page is ONE stamped root that fills it — the artboard itself, not an
// object (input-router `pageRootOf`). Tab walks the sections under it as the top level (1…6), never the page as 1.
function pageWrapped() {
  page();
  const body = document.querySelector('.dc-artboard-body') as Element;
  body.setAttribute('data-r', '0,0,1440,1220');
  const root = document.createElement('div');
  root.setAttribute('data-cd-id', 'pg');
  root.setAttribute('data-dc-element', 'Page');
  root.setAttribute('data-r', '0,0,1440,1220');
  while (body.firstChild) root.appendChild(body.firstChild);
  body.appendChild(root);
}

describe('the page root is the artboard, not an object (14 ed-edge-keys)', () => {
  test('the sections under the page are the top level 1…6; the page is not one of them', () => {
    pageWrapped();
    expect(siblingsOf(el('nav'), M).map(idOf)).toEqual([
      'nav',
      'hero',
      'eyebrow',
      'svc',
      'work',
      'foot',
    ]);
    expect(['nav', 'svc', 'card-a', 'c-title'].map((i) => orderBadge(el(i), M))).toEqual([
      '1',
      '4',
      '4.1',
      '4.3.1',
    ]);
  });

  test('tab from nothing takes the first SECTION, and walks on to Services', () => {
    pageWrapped();
    expect(idOf(stepFrom(document, [], 1, M))).toBe('nav');
    const board = { selector: '[data-dc-screen="desk"]', artboardId: 'desk' };
    expect(idOf(stepFrom(document, [board], 1, M))).toBe('nav');
    expect(idOf(stepFrom(document, [sel('eyebrow')], 1, M))).toBe('svc');
  });

  test('the badges number the sections 1…6 with Services as 4 and its cards 4.1…4.3', () => {
    pageWrapped();
    const b = badgesFor(el('svc'), M);
    expect(b.filter((x) => !x.inside).map((x) => x.text)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(b.filter((x) => x.inside).map((x) => x.text)).toEqual(['4.1', '4.2', '4.3']);
  });

  test('the section discs sit in the page margin (edge); the cards’ own discs sit on the cards', () => {
    pageWrapped();
    const b = badgesFor(el('svc'), M);
    expect(b.filter((x) => !x.inside).every((x) => x.edge)).toBe(true);
    expect(b.filter((x) => x.inside).some((x) => x.edge)).toBe(false);
    expect(
      badgesFor(el('card-b'), M)
        .filter((x) => !x.inside)
        .some((x) => x.edge)
    ).toBe(false);
  });

  test('a lone card smaller than the artboard is an object like any other (no collapse)', () => {
    pageWrapped();
    el('pg').setAttribute('data-r', '100,100,400,300');
    expect(siblingsOf(el('pg'), M).map(idOf)).toEqual(['pg']);
  });
});

describe('what VoiceOver hears', () => {
  test('the design’s sentence, word for word', () => {
    page();
    expect(describeFocus(factsOf(el('svc'), M))).toBe(
      'Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside.'
    );
  });

  test('goldens for the other shapes of an answer', () => {
    const f = { name: 'Hero', kind: 'frame' as const, items: 0, layout: null, n: 2, of: 6 };
    expect(describeFocus(f)).toBe('Hero, frame — 2 of 6.');
    expect(describeFocus({ ...f, items: 1 })).toBe(
      'Hero, frame, 1 item — 2 of 6. Press Return to go inside.'
    );
    expect(describeFocus({ ...f, items: 4, layout: 'column' })).toBe(
      'Hero, frame, 4 items, in a column — 2 of 6. Press Return to go inside.'
    );
    expect(describeFocus({ ...f, items: 4, layout: 'grid' })).toBe(
      'Hero, frame, 4 items, in a grid — 2 of 6. Press Return to go inside.'
    );
    expect(describeFocus({ ...f, kind: 'text', name: 'Eyebrow' })).toBe(
      'Eyebrow, text — 2 of 6. Press Return to type.'
    );
    expect(describeFocus({ ...f, kind: 'image', name: 'Hero picture' })).toBe(
      'Hero picture, image — 2 of 6.'
    );
    expect(describeFocus({ ...f, kind: 'instance', items: 2, layout: 'row' })).toBe(
      'Hero, component, 2 items, in a row — 2 of 6. Press Return to go inside.'
    );
    expect(describeFocus({ ...f, n: 1, of: 1 })).toBe('Hero, frame.');
    expect(describeFocus({ ...f, name: '' })).toBe('Untitled, frame — 2 of 6.');
  });

  test('the facts of the DOM: a leaf text, a card, the position inside a frame', () => {
    page();
    expect(factsOf(el('eyebrow'), M)).toMatchObject({ kind: 'text', items: 0, n: 3, of: 6 });
    expect(describeFocus(factsOf(el('card-b'), M))).toBe('Motion, frame — 2 of 3.');
    expect(positionOf(el('card-c'), M)).toEqual({ n: 3, of: 3 });
  });
});

describe('the focus ring is not the selection', () => {
  const ring = FOCUS_RING_CSS.slice(FOCUS_RING_CSS.indexOf('.ed-focus-ring'));

  test('it reads its own token, never the selection’s', () => {
    expect(FOCUS_RING_TOKEN).not.toBe(SELECTION_TOKEN);
    expect(ring).toContain(`var(${FOCUS_RING_TOKEN})`);
    expect(ring).not.toContain(SELECTION_TOKEN);
  });

  test('thicker than the selection’s line, with a wider halo', () => {
    const shadows = [...ring.matchAll(/0 0 0 ([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(shadows.length).toBe(2);
    expect(shadows[0]).toBeGreaterThan(1.5);
    expect(shadows[1]).toBeGreaterThan(shadows[0] as number);
  });

  test('the token has a value in both themes', () => {
    expect(FOCUS_RING_CSS).toContain(':root[data-maude-theme="dark"]');
    expect(FOCUS_RING_CSS.match(new RegExp(`${FOCUS_RING_TOKEN}:`, 'g'))?.length).toBe(2);
  });

  test('the ring follows the keyboard: a key shows it, a pointer press takes it away', () => {
    const m = createModality();
    let n = 0;
    m.subscribe(() => n++);
    expect(m.get()).toBe(false);
    m.key();
    m.key();
    expect(m.get()).toBe(true);
    m.pointer();
    expect(m.get()).toBe(false);
    expect(n).toBe(2);
    expect(isNavigationKey('Tab')).toBe(true);
    expect(isNavigationKey('Shift')).toBe(false);
  });

  // 14 R3: the order pills + focus ring belong to a person WALKING with the keyboard. A tool letter, Esc or
  // a chord (⌘Z, ⌘/) is a key press on a POINTER selection: it must not flip the modality.
  test('only Tab and F6 walk the keyboard; letters, arrows, Esc and chords do not', () => {
    for (const k of ['Tab', 'F6']) expect(isNavigationKey(k)).toBe(true);
    // an arrow nudges the object the pointer selected; it does not walk
    for (const k of [
      'ArrowDown',
      'ArrowLeft',
      'Enter',
      ' ',
      'v',
      'z',
      'Escape',
      'Backspace',
      '/',
      'Shift',
      'Meta',
    ])
      expect(isNavigationKey(k)).toBe(false);
    expect(isNavigationKey('Tab', { shiftKey: true })).toBe(true);
    expect(isNavigationKey('z', { metaKey: true })).toBe(false);
    expect(isNavigationKey('Tab', { ctrlKey: true })).toBe(false);
    expect(isNavigationKey('Enter', { altKey: true })).toBe(false);
  });
});

describe('the registry rows', () => {
  const KEYS = canvasKeyIndex([
    'object.select-next',
    'object.select-prev',
    'ui.cycle-region',
    'tool.create-default',
    'object.enter',
  ]);
  type Ctx = Parameters<typeof canvasKeyCtx>[0];
  const run = (key: string, shiftKey: boolean, ctx: Ctx) =>
    resolveChord(
      KEYS,
      chordFromEvent({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey }),
      canvasKeyCtx(ctx)
    )?.action.id ?? null;
  const base: Ctx = { typing: false, readOnly: false, mode: 'edit' };

  test('tab and ⇧tab are two actions, in Edit mode', () => {
    expect(run('Tab', false, base)).toBe('object.select-next');
    expect(run('Tab', true, base)).toBe('object.select-prev');
    expect(run('Tab', false, { ...base, selection: 'object' })).toBe('object.select-next');
    expect(run('Tab', false, { ...base, mode: 'preview' })).toBeNull();
    expect(run('Tab', false, { ...base, typing: true })).toBeNull();
  });

  test('↵ goes inside — unless a create tool is armed, then it adds one', () => {
    expect(run('Enter', false, { ...base, selection: 'object' })).toBe('object.enter');
    expect(run('Enter', false, { ...base, selection: 'object', toolArmed: true })).toBe(
      'tool.create-default'
    );
    expect(run('Enter', false, { ...base, toolArmed: true })).toBe('tool.create-default');
    // rc.1 F33: Preview’s Comment tool is armed too — C then ↵ comments on the selection
    expect(run('Enter', false, { ...base, toolArmed: true, mode: 'preview' })).toBe(
      'tool.create-default'
    );
    expect(run('Enter', false, { ...base, mode: 'preview' })).toBeNull();
  });

  test('F6 is the shell’s, forwarded from the canvas', () => {
    const def = ACTIONS_BY_ID.get('ui.cycle-region');
    expect(def?.exec).toBe('shell');
    expect(def?.fromCanvas).toBe(true);
    expect(run('F6', false, base)).toBe('ui.cycle-region');
    expect(run('F6', true, base)).toBe('ui.cycle-region');
    expect(run('F6', false, { ...base, typing: true })).toBe('ui.cycle-region');
  });

  test('every new action has an agent path', () => {
    for (const id of ['object.select-prev', 'ui.cycle-region', 'tool.create-default'])
      expect(AGENT_PATHS[id], id).toBeDefined();
  });

  test('R · T · F are the create tools', () => {
    expect(['frame', 'el-shape', 'el-text'].every(isCreateTool)).toBe(true);
    expect(['move', 'browse', 'ellipse', null, undefined].some((t) => isCreateTool(t))).toBe(false);
  });

  test('the canvas’s forwarded chord passes the bridge (a key message names a chord, nothing else)', () => {
    const w = {} as Window;
    const accepted = acceptFromCanvas(
      { data: { dgn: 'key', v: 1, chord: '⇧F6' }, origin: 'http://c', source: w } as never,
      { canvasOrigin: 'http://c', active: w }
    );
    expect(accepted).toMatchObject({ dgn: 'key', chord: '⇧F6' });
  });
});

describe('F6 between the panels and the canvas', () => {
  const at = new Map<Element, number>();
  const opts = {
    shown: () => true,
    rectOf: (e: Element) => ({ left: at.get(e) ?? 0, top: 0, width: 10, height: 10 }),
  };
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  function shell() {
    document.body.innerHTML = `
      <aside aria-label="Inspector" id="insp"><button id="insp-b">A</button></aside>
      <nav aria-label="Canvases" id="nav"><button id="nav-b">N</button><button id="nav-c">M</button></nav>
      <div class="viewport"><iframe class="active" data-path="a.tsx" id="frame" title="Canvas: a.tsx"></iframe></div>`;
    at.set(byId('nav'), 0);
    at.set(byId('frame'), 300);
    at.set(byId('insp'), 1100);
  }

  test('the order is left to right, and wraps both ways', () => {
    expect(nextIndex(3, 0, 1)).toBe(1);
    expect(nextIndex(3, 2, 1)).toBe(0);
    expect(nextIndex(3, 0, -1)).toBe(2);
    expect(nextIndex(3, -1, 1)).toBe(0);
    expect(nextIndex(3, -1, -1)).toBe(2);
    expect(nextIndex(0, -1, 1)).toBe(-1);
    const r = readingOrder([
      { rect: { left: 500, top: 0 } },
      { rect: { left: 0, top: 0 } },
      { rect: { left: 3, top: 50 } },
    ]);
    expect(r.map((x: { rect: { left: number } }) => x.rect.left)).toEqual([0, 3, 500]);
  });

  test('panels and the canvas frame are the regions, in reading order', () => {
    shell();
    expect(regionsIn(document, opts).map((e: Element) => e.id)).toEqual(['nav', 'frame', 'insp']);
  });

  test('F6 from a panel lands on the canvas frame (the iframe), then the next panel', () => {
    shell();
    byId('nav-c').focus();
    expect(cycleRegion(document, 1, opts)).toBe(true);
    expect(document.activeElement?.id).toBe('frame');
    expect(cycleRegion(document, 1, opts)).toBe(true);
    expect(document.activeElement?.id).toBe('insp-b');
    expect(cycleRegion(document, 1, opts)).toBe(true);
    expect(document.activeElement?.id).toBe('nav-b');
  });

  test('⇧F6 goes back, and from nowhere takes the last', () => {
    shell();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(cycleRegion(document, -1, opts)).toBe(true);
    expect(document.activeElement?.id).toBe('insp-b');
    expect(cycleRegion(document, -1, opts)).toBe(true);
    expect(document.activeElement?.id).toBe('frame');
  });

  test('a hidden panel is not a stop; a region with nothing to press takes the keyboard itself', () => {
    shell();
    const shown = (e: Element) => e.id !== 'insp';
    expect(regionsIn(document, { ...opts, shown }).map((e: Element) => e.id)).toEqual([
      'nav',
      'frame',
    ]);
    document.body.innerHTML = '<aside aria-label="Empty" id="e"></aside>';
    const e = byId('e');
    expect(entryOf(e, () => true)).toBe(e);
    expect(e.getAttribute('tabindex')).toBe('-1');
    expect(regionOf([e], e)).toBe(0);
  });

  // K1 (wave-A gate): the canvas frame runs full-bleed under the side panels, so its LEFT edge sorted it
  // before the canvases list — F6 from the canvas went to the list, then the inspector, and never read
  // "panels, canvas, panels". The frame sits in the order where its middle is.
  test('a full-bleed canvas frame sits between the left and the right panels', () => {
    shell();
    at.set(byId('nav'), 16);
    at.set(byId('frame'), 0);
    at.set(byId('insp'), 1100);
    const wide = {
      shown: () => true,
      rectOf: (e: Element) => ({
        left: at.get(e) ?? 0,
        top: 0,
        width: e.id === 'frame' ? 1200 : 10,
        height: 10,
      }),
    };
    expect(regionsIn(document, wide).map((e: Element) => e.id)).toEqual(['nav', 'frame', 'insp']);
    byId('frame').focus();
    expect(cycleRegion(document, 1, wide)).toBe(true);
    expect(document.activeElement?.id).toBe('insp-b');
    expect(cycleRegion(document, 1, wide)).toBe(true);
    expect(document.activeElement?.id).toBe('nav-b');
    expect(cycleRegion(document, 1, wide)).toBe(true);
    expect(document.activeElement?.id).toBe('frame');
  });

  test('a panel slid off the window is not a stop', () => {
    const view = { w: 1400, h: 900 };
    expect(onScreen({ left: 4796, top: 0, width: 320, height: 800 }, view)).toBe(false);
    expect(onScreen({ left: -340, top: 0, width: 320, height: 800 }, view)).toBe(false);
    expect(onScreen({ left: 1200, top: 0, width: 320, height: 800 }, view)).toBe(true); // half out is still there
    expect(onScreen({ left: 0, top: 0, width: 0, height: 0 }, view)).toBe(false);
  });

  test('a nested labelled region is part of its outer one', () => {
    document.body.innerHTML =
      '<nav aria-label="Canvases" id="o"><aside aria-label="Inner" id="i"><button>x</button></aside></nav>';
    const flat = { shown: () => true, rectOf: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
    expect(regionsIn(document, flat).map((e: Element) => e.id)).toEqual(['o']);
  });
});

describe('R · T · F, then ↵', () => {
  const VP = { x: 0, y: 0, zoom: 1 };
  const box = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect;
  function board() {
    document.body.innerHTML =
      '<article data-dc-screen="desk"><div class="dc-artboard-body" id="body"><div data-cd-id="frame1" id="f1"></div></div></article>';
    const body = document.getElementById('body') as HTMLElement;
    body.getBoundingClientRect = () => box(0, 0, 800, 600);
    const f1 = document.getElementById('f1') as HTMLElement;
    f1.getBoundingClientRect = () => box(200, 100, 400, 300);
    return { body, f1 };
  }

  test('a rectangle is its default size, centred on the selected frame, inside it', () => {
    const { body, f1 } = board();
    const doc = { elementsFromPoint: () => [f1, body] } as unknown as Document;
    const at = createPoint(document, [sel('frame1')], { w: 1000, h: 800 });
    expect(at).toEqual({ x: 400, y: 250 });
    const live = centredClick(doc, 'el-shape', at);
    if (live === 'off-artboard') throw new Error('should be on the artboard');
    const plan = planDraw(live, VP);
    expect(plan.type).toBe('op');
    if (plan.type !== 'op') return;
    expect(plan.ask.op).toBe('object.insert-shape');
    expect(plan.ask.params).toMatchObject({
      kind: 'rectangle',
      artboard: 'desk',
      rect: { x: 150, y: 100, w: 100, h: 100 },
    });
  });

  test('with nothing selected it lands in the middle of the view', () => {
    expect(createPoint(document, [], { w: 1000, h: 800 })).toEqual({ x: 500, y: 400 });
  });

  test('F on empty canvas is a new artboard; R there is refused', () => {
    const doc = { elementsFromPoint: () => [] } as unknown as Document;
    const f = centredClick(doc, 'frame', { x: 500, y: 400 }, 1);
    expect(f).not.toBe('off-artboard');
    if (f !== 'off-artboard')
      expect(planDraw(f, VP)).toMatchObject({ type: 'op', ask: { op: 'artboard.draw' } });
    expect(centredClick(doc, 'el-shape', { x: 500, y: 400 })).toBe('off-artboard');
  });

  test('T asks the toolbar’s insert-text and the tool steps back', async () => {
    let kind: unknown = null;
    document.addEventListener(TOOLBAR_INSERT_EVENT, (e) => {
      kind = (e as CustomEvent).detail?.kind;
    });
    let done = 0;
    const ok = await createDefault('el-text', {
      doc: document,
      selected: [],
      record: () => {},
      replace: () => {},
      done: () => done++,
    });
    expect(ok).toBe(true);
    expect(kind).toBe('text');
    expect(done).toBe(1);
  });
});

describe('Ask AI about this artboard', () => {
  const w = {} as Window;
  const lane = () =>
    createAskSelectionLane({
      canvasOrigin: () => 'http://c',
      activePath: () => 'a.tsx',
      frameOf: () => ({ contentWindow: w }),
    });
  const post = (data: unknown) => ({ data, origin: 'http://c', source: w }) as never;

  test('the menu row is live: it announces the artboard and is no longer greyed', () => {
    const sections = artboardMenuSections([], {
      duplicate() {},
      duplicateAtWidth() {},
      customWidth() {},
      rename() {},
      resetPosition() {},
    });
    const ask = (sections[0] ?? [])[0];
    expect(ask?.id).toBe('ask-ai');
    expect(ask?.disabled).toBeUndefined();
    let got: unknown = null;
    window.addEventListener('maude:ask-artboard', (e) => {
      got = (e as CustomEvent).detail;
    });
    ask?.onSelect({
      kind: 'artboard-chrome',
      el: null,
      cdId: null,
      artboardId: 'desk',
      clientX: 0,
      clientY: 0,
    } as never);
    expect(got).toEqual({ artboardId: 'desk' });
  });

  test('the canvas says which artboard and where; nothing else', () => {
    document.body.innerHTML = '<article data-dc-screen="desk" id="a"></article>';
    (document.getElementById('a') as HTMLElement).getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300 }) as DOMRect;
    expect(askArtboardPayload('desk', document)).toEqual({
      refs: [],
      artboard: 'desk',
      rect: { x: 10, y: 20, w: 400, h: 300 },
    });
    expect(askArtboardPayload('missing', document)).toBeNull();
  });

  test('the bridge takes it, and the shell lane opens the bubble with an artboards scope', () => {
    const msg = {
      dgn: 'ask-selection',
      v: 1,
      refs: [],
      artboard: 'desk',
      rect: { x: 1, y: 2, w: 3, h: 4 },
    };
    expect(acceptFromCanvas(post(msg), { canvasOrigin: 'http://c', active: w })).toMatchObject({
      artboard: 'desk',
      refs: [],
    });
    const l = lane();
    l.onMessage(post(msg));
    expect(l.get()).toMatchObject({ phase: 'input', scope: { kind: 'artboards', ids: ['desk'] } });
  });

  test('elements still win when there are refs (⌘/ on a selection is unchanged)', () => {
    const l = lane();
    l.onMessage(
      post({
        dgn: 'ask-selection',
        v: 1,
        refs: [{ artboard: 'desk', element: 'card' }],
        rect: { x: 1, y: 2, w: 3, h: 4 },
      })
    );
    expect(l.get()).toMatchObject({ scope: { kind: 'elements', ids: ['desk'] } });
  });

  test('the composer’s door takes an artboards scope and refuses a malformed one', () => {
    expect(artboardScope('desk')).toEqual({ kind: 'artboards', ids: ['desk'] });
    expect(artboardScope('bad id!')).toBeNull();
    expect(artboardScope(undefined)).toBeNull();
    const target = new EventTarget() as unknown as typeof globalThis;
    const seen: unknown[] = [];
    subscribeAskSelection((d: unknown) => seen.push(d), target);
    expect(
      sendAskSelection(
        { text: 'make it calmer', scope: { kind: 'artboards', ids: ['desk'] } },
        target
      )
    ).toBe(true);
    expect(
      sendAskSelection({ text: 'x', scope: { kind: 'artboards', ids: ['a', 'b'] } }, target)
    ).toBe(false);
    expect(
      sendAskSelection({ text: '', scope: { kind: 'artboards', ids: ['desk'] } }, target)
    ).toBe(false);
    expect(seen).toEqual([{ text: 'make it calmer', scope: { kind: 'artboards', ids: ['desk'] } }]);
    expect(elementsScope([], [])).toBeNull();
  });
});
