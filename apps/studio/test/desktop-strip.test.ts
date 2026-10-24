// S1.22b — the desktop tab strip page (apps/desktop/src/strip.{html,js}; canvas 11 pn-tab-b,
// pn-tab-b20, pn-tab-menu). The page only draws the TabStripState Rust sends it and asks Rust to
// act; this drives it with a fake `__TAURI__` and asserts what it draws and what it invokes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const SRC = join(import.meta.dir, '..', '..', 'desktop', 'src');
const HTML = readFileSync(join(SRC, 'strip.html'), 'utf8');
const JS = readFileSync(join(SRC, 'strip.js'), 'utf8');

type Tab = {
  label: string;
  kind: string;
  name: string;
  dot: null | string;
  resting: boolean;
  closing: boolean;
  initial: string;
  tone: string;
  account: null | { initial: string; tone: string; label: string };
  place: string;
};

const tab = (i: number, extra: Partial<Tab> = {}): Tab => ({
  label: `p-l${String(i).padStart(16, '0')}`,
  kind: 'project',
  name: `Project ${i}`,
  dot: null,
  resting: false,
  closing: false,
  initial: 'P',
  tone: 'sky',
  account: null,
  place: 'mac',
  ...extra,
});

const state = (tabs: Tab[], extra: Record<string, unknown> = {}) => ({
  tabs,
  home: { label: 'home' },
  active: tabs[0]?.label ?? 'home',
  overview: false,
  renaming: null,
  ...extra,
});

let calls: [string, Record<string, unknown> | undefined][] = [];
let push: (s: unknown) => void = () => {};

function mount(initial: unknown) {
  calls = [];
  const body = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script src="strip.js">'));
  document.body.innerHTML = body;
  (window as unknown as Record<string, unknown>).__TAURI__ = {
    core: {
      Channel: class {
        onmessage: ((s: unknown) => void) | null = null;
      },
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push([cmd, args]);
        if (cmd === 'tabs_state') {
          const ch = args?.onState as { onmessage: (s: unknown) => void };
          push = (s) => ch.onmessage(s);
          return Promise.resolve(initial);
        }
        return Promise.resolve();
      },
    },
  };
  new Function(JS)();
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const invoked = (cmd: string) => calls.filter(([c]) => c === cmd).map(([, a]) => a);

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the tab strip page (S1.22b)', () => {
  test('a tab draws its square, its name as text, its account badge and one state mark', async () => {
    const tabs = [
      tab(1, { name: '<b>Alligators</b>', initial: 'A', tone: 'lilac' }),
      tab(2, { account: { initial: 'W', tone: 'sky', label: 'Work' }, dot: 'needs-you' }),
      tab(3, { resting: true }),
      tab(4, { resting: true, dot: 'working' }),
    ];
    mount(state(tabs));
    await tick();
    const t1 = $(`tab-${tabs[0].label}`)!;
    expect(t1.querySelector('[data-testid="tab-square"]')?.textContent).toBe('A');
    expect(t1.querySelector('[data-testid="tab-square"]')?.getAttribute('data-tone')).toBe('lilac');
    expect(t1.querySelector('.name')?.textContent).toBe('<b>Alligators</b>');
    expect(t1.querySelector('b')).toBeNull();
    expect(t1.querySelector('[data-testid="tab-account"]')).toBeNull();
    const t2 = $(`tab-${tabs[1].label}`)!;
    const badge = t2.querySelector('[data-testid="tab-account"]')!;
    expect(badge.textContent).toBe('W');
    expect(badge.getAttribute('data-tone')).toBe('sky');
    expect(badge.getAttribute('aria-label')).toBe('Account: Work');
    expect(t2.querySelector('[data-testid="tab-dot"]')?.textContent).toBe('?');
    // A resting tab wears the ring; an AI mark wins over it (one mark per tab).
    const t3 = $(`tab-${tabs[2].label}`)!;
    expect(t3.querySelector('[data-testid="tab-rest"]')).not.toBeNull();
    expect(t3.title).toBe('Project 3 — resting, opens in a second');
    const t4 = $(`tab-${tabs[3].label}`)!;
    expect(t4.querySelectorAll('[data-testid="tab-dot"], [data-testid="tab-rest"]').length).toBe(1);
    expect($('tab-more')!.hidden).toBe(true);
  });

  test('at 20 tabs the row keeps square + name and "N more" holds the rest, the active one in the row', async () => {
    const tabs = Array.from({ length: 20 }, (_, i) => tab(i));
    mount(state(tabs, { active: tabs[15].label }));
    await tick();
    const shown = $$('.tab').map((e) => e.getAttribute('data-label'));
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThan(20);
    expect(shown).toContain(tabs[15].label);
    const more = $('tab-more')!;
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe(`${20 - shown.length} more`);
    // "N more" opens the tab list on the rest only.
    more.click();
    expect(invoked('tab_overview').at(-1)).toEqual({ open: true });
    push(state(tabs, { active: tabs[15].label, overview: true }));
    const rows = $$('[data-testid^="tab-overview-row-"]').map((r) => r.getAttribute('data-testid'));
    expect(rows.length).toBe(20 - shown.length);
    expect(rows).not.toContain('tab-overview-row-home');
    expect(document.getElementById('overview-title')?.textContent).toBe(
      `${20 - shown.length} more`
    );
  });

  test('Show All Tabs lists Home and every tab; Find narrows, Enter opens, Esc closes', async () => {
    const tabs = [
      tab(1, { name: 'Matchday 2026' }),
      tab(2, { name: 'Trenérský manuál', resting: true }),
    ];
    mount(state(tabs));
    await tick();
    push(state(tabs, { overview: true }));
    expect($('tab-overview')!.hidden).toBe(false);
    expect(
      $$('[data-testid^="tab-overview-row-"]').map((r) => r.getAttribute('data-testid'))
    ).toEqual([
      'tab-overview-row-home',
      `tab-overview-row-${tabs[0].label}`,
      `tab-overview-row-${tabs[1].label}`,
    ]);
    expect($(`tab-overview-row-${tabs[1].label}`)!.textContent).toContain('Resting');
    const find = $('tab-overview-find') as HTMLInputElement;
    find.value = 'trenersky';
    find.dispatchEvent(new window.Event('input'));
    const rows = $$('[data-testid^="tab-overview-row-"]');
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      `tab-overview-row-${tabs[1].label}`,
    ]);
    find.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(invoked('tab_activate').at(-1)).toEqual({ label: tabs[1].label });
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(invoked('tab_overview').at(-1)).toEqual({ open: false });
    push(state(tabs));
    expect($('tab-overview')!.hidden).toBe(true);
  });

  test('right-click asks Rust for the native tab menu; Rename… edits the name in place', async () => {
    const tabs = [tab(1), tab(2, { name: 'Portfolio 2026' })];
    mount(state(tabs));
    await tick();
    const t2 = $(`tab-${tabs[1].label}`)!;
    const ev = new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 20,
    });
    t2.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(invoked('tab_menu').at(-1)).toEqual({ label: tabs[1].label, x: 300, y: 20 });
    // The menu's Rename… comes back as one push naming the tab.
    push(state(tabs, { renaming: tabs[1].label }));
    const input = $('tab-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Portfolio 2026');
    input.value = 'Portfolio ’26';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    expect(invoked('tab_rename')).toEqual([{ label: tabs[1].label, name: 'Portfolio ’26' }]);
    expect($('tab-rename-input')).toBeNull();
    // Esc leaves the name alone.
    push(state(tabs, { renaming: tabs[0].label }));
    const again = $('tab-rename-input') as HTMLInputElement;
    again.value = 'nope';
    again.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(invoked('tab_rename').length).toBe(1);
  });

  test('dragging a tab along the strip asks Rust to reorder it (tab_reorder)', async () => {
    const tabs = [tab(1), tab(2), tab(3)];
    mount(state(tabs));
    await tick();
    const first = $(`tab-${tabs[0].label}`)!;
    const P = window.PointerEvent ?? window.MouseEvent;
    first.dispatchEvent(
      new P('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        pointerId: 7,
      } as PointerEventInit)
    );
    window.dispatchEvent(
      new P('pointermove', { bubbles: true, clientX: 600, pointerId: 7 } as PointerEventInit)
    );
    expect(first.classList.contains('dragging')).toBe(true);
    window.dispatchEvent(
      new P('pointerup', { bubbles: true, clientX: 600, pointerId: 7 } as PointerEventInit)
    );
    expect(invoked('tab_reorder')).toEqual([{ label: tabs[0].label, to: 2 }]);
    expect(first.classList.contains('dragging')).toBe(false);
  });
});

// S1.22c (lead decision maude/v2-lead-home-tab-first; CONTRACT §1 / §6, amended 2026-10-14):
// Home is the pinned, icon-only FIRST tab — the left-most slot after the traffic lights.
describe('Home is the pinned first tab (S1.22c)', () => {
  const before = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  /** Lay the strip out like WebKit would: lights 0–78, Home 78–116, tab i at 120 + 130·i. */
  function layOut() {
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 33,
        height: 33,
        x: left,
        y: 0,
      }) as DOMRect;
    $('tab-home')!.getBoundingClientRect = () => rect(78, 38);
    $$('.tab').forEach((el, i) => {
      el.getBoundingClientRect = () => rect(120 + 130 * i, 120);
    });
  }

  test('Home is the left-most slot: before every tab and before "N more"', async () => {
    const tabs = Array.from({ length: 20 }, (_, i) => tab(i));
    mount(state(tabs, { active: tabs[19].label }));
    await tick();
    const home = $('tab-home')!;
    const strip = $('tab-strip')!;
    // The first slot after the traffic lights.
    const slots = Array.from(strip.children).filter((e) => !e.classList.contains('lights'));
    expect(slots[0]).toBe(home);
    for (const t of $$('.tab')) expect(before(home, t)).toBe(true);
    expect(before(home, $('tab-more')!)).toBe(true);
    // Home never folds into "N more"; the active tab still shows in the row.
    expect(home.hidden).toBe(false);
    expect($('tab-more')!.hidden).toBe(false);
    expect($$('.tab').map((e) => e.getAttribute('data-label'))).toContain(tabs[19].label);
    expect(home.getAttribute('aria-label')).toBe('Home');
    expect((home.textContent || '').trim()).toBe('');
  });

  test('a tab dragged past Home lands first after it, never before (and never slides over it)', async () => {
    const tabs = [tab(1), tab(2), tab(3)];
    mount(state(tabs));
    await tick();
    layOut();
    const third = $(`tab-${tabs[2].label}`)!;
    const P = window.PointerEvent ?? window.MouseEvent;
    third.dispatchEvent(
      new P('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 400,
        pointerId: 9,
      } as PointerEventInit)
    );
    window.dispatchEvent(
      new P('pointermove', { bubbles: true, clientX: 10, pointerId: 9 } as PointerEventInit)
    );
    // Clamped at Home's right edge (116): the tab starts at 380, so at most 264 px left.
    expect(third.style.transform).toBe('translateX(-264px)');
    window.dispatchEvent(
      new P('pointerup', { bubbles: true, clientX: 10, pointerId: 9 } as PointerEventInit)
    );
    expect(invoked('tab_reorder')).toEqual([{ label: tabs[2].label, to: 0 }]);
  });
});
