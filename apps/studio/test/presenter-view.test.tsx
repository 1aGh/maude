// S3.6b — Presenter view on the Mac (04 md-presenter). The order map is the canvas layout, numbered in
// run order; a click jumps both screens; End closes both; one display hides every way in; and nothing a
// canvas posts can open a window on the second display (only the person's gesture in the shell does).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { AUDIENCE_LOCK } from '../client/v2/present/follow-location.js';
import { ShellPresentChrome } from '../client/v2/present/present-chrome-host.jsx';
import { PresenterViewHost } from '../client/v2/present/presenter-host.jsx';
import { presenterStore, presentRunStore } from '../client/v2/present/presenter-store.js';
import { PresenterView } from '../client/v2/present/presenter-view.jsx';
import { ModeSwitch } from '../client/v2/shell/mode-switch.jsx';
import { shellMode } from '../client/v2/shell/use-canvas-mode-lane.js';

const TWO = [
  { id: 'aaaaaaaaaaaaaaaa', name: 'Built-in Retina Display', primary: true, current: true },
  { id: 'bbbbbbbbbbbbbbbb', name: 'LG UltraFine', primary: false, current: false },
];
const ONE = [TWO[0]];

// Canvas order: Cover, Reel (same row), Poster (row below).
const BOARDS = [
  { id: 'a', label: 'Cover', x: 0, y: 0, w: 400, h: 300 },
  { id: 'b', label: 'Reel', x: 500, y: 0, w: 400, h: 300 },
  { id: 'c', label: 'Poster', x: 0, y: 400, w: 400, h: 300 },
];
const SAVED = {
  present: { order: ['c', 'a'], skip: ['b'] },
  notes: { c: 'Loni přišlo 86 hráčů.\nLetos nově U15.' },
};

let root: Root | null = null;
let host: HTMLElement | null = null;
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

function render(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(ui));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

// ── the presentational half ────────────────────────────────────────────────────────────────────────
function view(over: Record<string, unknown> = {}) {
  const calls = { steps: [] as unknown[], ends: 0, retries: 0 };
  render(
    <PresenterView
      canvasName="Combine-kampan"
      position={{ index: 0, total: 2, artboardId: 'c' }}
      artboards={BOARDS}
      saved={SAVED}
      elapsedMs={768_000}
      now={new Date(2026, 9, 18, 14, 5)}
      audience={{ status: 'on', displayName: 'LG UltraFine' }}
      onStep={(to: unknown) => calls.steps.push(to)}
      onEnd={() => {
        calls.ends += 1;
      }}
      onRetry={() => {
        calls.retries += 1;
      }}
      {...over}
    />
  );
  return calls;
}

describe('<PresenterView> order map', () => {
  test('cells sit where the artboards sit on the canvas (positions and sizes in proportion)', () => {
    view();
    const a = q('presenter-cell-a');
    const b = q('presenter-cell-b');
    const c = q('presenter-cell-c');
    if (!a || !b || !c) throw new Error('cells missing');
    const px = (el: HTMLElement, k: 'left' | 'top' | 'width' | 'height') =>
      Number.parseFloat(el.style[k]);
    // The layout is 900 × 700 world units; one scale for every cell.
    const k = px(a, 'width') / 400;
    expect(px(a, 'left')).toBeCloseTo(0, 5);
    expect(px(b, 'left')).toBeCloseTo(500 * k, 3);
    expect(px(b, 'top')).toBeCloseTo(0, 5);
    expect(px(c, 'top')).toBeCloseTo(400 * k, 3);
    expect(px(c, 'height')).toBeCloseTo(300 * k, 3);
    // …and the map keeps the canvas's shape: wider than tall, rows above one another.
    expect(px(c, 'top')).toBeGreaterThan(px(a, 'top') + px(a, 'height'));
  });

  test('numbered in the order Present plays; skipped is dimmed with an eye-off and has no number', () => {
    view();
    expect(q('presenter-cell-c')?.textContent).toContain('1');
    expect(q('presenter-cell-a')?.textContent).toContain('2');
    const b = q('presenter-cell-b');
    expect(b?.getAttribute('data-skip')).toBe('true');
    expect(b?.querySelector('[data-testid="presenter-skipped-mark"]')).not.toBeNull();
    expect(b?.textContent).not.toMatch(/[0-9]/);
    expect(b?.hasAttribute('disabled')).toBe(true);
    expect(q('presenter-order-count')?.textContent).toBe('Order · 3 artboards · 1 skipped');
  });

  test('the presented artboard is the current cell', () => {
    view();
    expect(q('presenter-cell-c')?.getAttribute('aria-current')).toBe('true');
    expect(q('presenter-cell-a')?.hasAttribute('aria-current')).toBe(false);
    act(() => root?.unmount());
    host?.remove();
    view({ position: { index: 1, total: 2, artboardId: 'a' } });
    expect(q('presenter-cell-a')?.getAttribute('aria-current')).toBe('true');
    expect(q('presenter-cell-c')?.hasAttribute('aria-current')).toBe(false);
  });

  test('a click on a cell jumps to its place in the run (present-step to); a skipped one does nothing', () => {
    const calls = view();
    act(() => q('presenter-cell-a')?.click());
    expect(calls.steps).toEqual([1]);
    act(() => q('presenter-cell-c')?.click());
    expect(calls.steps).toEqual([1, 0]);
    act(() => q('presenter-cell-b')?.click());
    expect(calls.steps).toEqual([1, 0]);
  });

  test('a canvas that reported no layout gets a plain grid, still numbered', () => {
    view({ artboards: BOARDS.map(({ id, label }) => ({ id, label })), saved: null });
    expect(all('[data-testid^="presenter-cell-"][data-n]').map((e) => e.dataset.n)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});

describe('<PresenterView> now, next, notes, clock, audience, End', () => {
  test('Now is the presented artboard, Next the one after it in the run, Notes are its speaker notes', () => {
    view();
    expect(q('presenter-now-label')?.textContent).toBe('Now · 1 of 2 · Poster');
    expect(q('presenter-next-label')?.textContent).toBe('Next · Cover');
    expect(q('presenter-notes')?.textContent).toContain('Loni přišlo 86 hráčů.');
    expect(q('presenter-notes')?.querySelectorAll('p').length).toBe(2);
    act(() => root?.unmount());
    host?.remove();
    view({ position: { index: 1, total: 2, artboardId: 'a' } });
    expect(q('presenter-next-label')?.textContent).toBe('Next · the end');
    expect(q('presenter-notes')?.textContent).toContain('No notes');
  });

  test('the clock shows elapsed and wall time; the top bar names the canvas and the audience display', () => {
    view();
    expect(q('presenter-elapsed')?.textContent).toBe('12:48');
    expect(q('presenter-wall')?.textContent).toBe('14:05');
    expect(q('presenter-view')?.textContent).toContain('Combine-kampan');
    expect(q('presenter-audience')?.textContent).toBe('Audience on LG UltraFine');
  });

  test('an audience screen that would not open says so, with a way to try again', () => {
    const calls = view({
      audience: { status: 'failed', displayName: 'LG UltraFine', message: 'That display went away.' },
    });
    expect(q('presenter-audience')?.textContent).toContain('That display went away.');
    act(() => q('presenter-audience-retry')?.click());
    expect(calls.retries).toBe(1);
  });

  test('End leaves; Previous and Next step; Previous is out at the first artboard', () => {
    const calls = view();
    act(() => q('presenter-end')?.click());
    expect(calls.ends).toBe(1);
    expect(q('presenter-end')?.textContent).toContain('esc');
    expect(q('presenter-prev')?.hasAttribute('disabled')).toBe(true);
    act(() => q('presenter-next')?.click());
    expect(calls.steps).toEqual(['next']);
  });
});

// ── the host: displays, the audience window, End ───────────────────────────────────────────────────
type Call = { cmd: string; args: unknown };
const g = globalThis as unknown as { window: Record<string, unknown>; fetch: unknown };
let calls: Call[] = [];
let exits = 0;
const realFetch = globalThis.fetch;

function shell(displays: unknown[]) {
  calls = [];
  g.window.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: unknown) => {
        calls.push({ cmd, args });
        return cmd === 'present_displays' ? displays : null;
      },
    },
  };
}
const opened = () => calls.filter((c) => c.cmd === 'present_audience_open');
const closed = () => calls.filter((c) => c.cmd === 'present_audience_close');
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const store = () => ({
  shellCore: { activePath: '.design/ui/campaign.tsx', cfg: { designRel: '.design' } },
  photoAndTimeline: {
    exitPresent: () => {
      exits += 1;
    },
  },
});

beforeEach(() => {
  exits = 0;
  shellMode.back();
  presenterStore.reset();
  presentRunStore.set(null);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        present: SAVED.present,
        artboardMeta: { c: { notes: SAVED.notes.c } },
      })
    )) as unknown as typeof fetch;
});
afterEach(() => {
  g.window.__TAURI__ = undefined;
  globalThis.fetch = realFetch;
  act(() => {
    shellMode.back();
  });
  presenterStore.reset();
  presentRunStore.set(null);
});

async function mountHost(over: { presenting?: boolean; sid?: string | null } = {}) {
  presentRunStore.set({ file: '.design/ui/campaign.tsx', artboards: BOARDS });
  render(
    <ShellStoreContext.Provider value={store() as never}>
      <PresenterViewHost />
    </ShellStoreContext.Provider>
  );
  if (over.presenting !== false)
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'start' });
    });
  if (over.sid !== null)
    act(() => {
      shellMode.position({ index: 0, total: 2, artboardId: 'c', sid: over.sid ?? 'abcd1234' });
    });
  await flush();
}

describe('<PresenterViewHost>', () => {
  test('person turned it on, two displays, the canvas reported a session: opens the audience window with the follower lock', async () => {
    shell(TWO);
    await mountHost();
    expect(q('presenter-view')).toBeNull(); // not asked for yet
    expect(opened()).toEqual([]);
    act(() => presenterStore.setWanted(true));
    await flush();
    expect(q('presenter-view')).not.toBeNull();
    expect(opened()).toEqual([
      {
        cmd: 'present_audience_open',
        // the display this window is NOT on; the canvas without the design root; the canvas's own session
        args: { displayId: 'bbbbbbbbbbbbbbbb', canvas: 'ui/campaign.tsx', sid: 'abcd1234', lock: AUDIENCE_LOCK },
      },
    ]);
    expect(AUDIENCE_LOCK).toBe(1);
    expect(q('presenter-audience')?.textContent).toBe('Audience on LG UltraFine');
  });

  test('no session from the canvas yet: the view is up but no window opens', async () => {
    shell(TWO);
    act(() => presenterStore.setWanted(true));
    await mountHost({ sid: null });
    expect(q('presenter-view')).not.toBeNull();
    expect(opened()).toEqual([]);
    act(() => {
      shellMode.position({ index: 1, total: 2, artboardId: 'a', sid: 'abcd1234' });
    });
    await flush();
    expect(opened().length).toBe(1);
  });

  test('nothing a canvas posts opens a window — only the person turning it on does', async () => {
    shell(TWO);
    await mountHost();
    for (const data of [
      { dgn: 'present-audience-open', displayId: 'bbbbbbbbbbbbbbbb' },
      { dgn: 'present-position', index: 0, total: 2, artboardId: 'c', sid: 'abcd1234' },
      { dgn: 'present-follow-state', live: true },
    ])
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data }));
      });
    await flush();
    expect(opened()).toEqual([]);
    expect(presenterStore.get().wanted).toBe(false);
  });

  test('End leaves Present and closes the audience window; so does the view going away', async () => {
    shell(TWO);
    act(() => presenterStore.setWanted(true));
    await mountHost();
    expect(opened().length).toBe(1);
    act(() => q('presenter-end')?.click());
    expect(exits).toBe(1);
    await flush();
    expect(closed().length).toBeGreaterThanOrEqual(1);
    const before = closed().length;
    act(() => root?.unmount());
    await flush();
    expect(closed().length).toBeGreaterThan(before);
  });

  test('one display: no view, no window — the preference alone changes nothing', async () => {
    shell(ONE);
    act(() => presenterStore.setWanted(true));
    await mountHost();
    expect(q('presenter-view')).toBeNull();
    expect(opened()).toEqual([]);
  });

  test('Present the canvas never shows the presenter view', async () => {
    shell(TWO);
    act(() => presenterStore.setWanted(true));
    presentRunStore.set({ file: '.design/ui/campaign.tsx', artboards: BOARDS });
    render(
      <ShellStoreContext.Provider value={store() as never}>
        <PresenterViewHost />
      </ShellStoreContext.Provider>
    );
    act(() => {
      shellMode.present({ kind: 'canvas' });
    });
    await flush();
    expect(q('presenter-view')).toBeNull();
    expect(opened()).toEqual([]);
  });
});

describe('the audience lock', () => {
  test('the host takes the lock from the follower root, never a literal; only the host calls openAudience', () => {
    const src = (f: string) => readFileSync(join(import.meta.dir, '..', 'client/v2/present', f), 'utf8');
    const host = src('presenter-host.jsx');
    expect(host).toMatch(/import \{ AUDIENCE_LOCK \} from '\.\/follow-location\.js'/);
    expect(host).toMatch(/lock: AUDIENCE_LOCK/);
    expect(host).not.toMatch(/lock:\s*\d/);
    for (const f of ['presenter-view.jsx', 'order-map.jsx', 'presenter-button.jsx', 'presenter-store.js'])
      expect(src(f)).not.toMatch(/openAudience\s*\(/);
  });
});

// ── the ways in: the controls button and the Present ⌄ row ─────────────────────────────────────────
describe('the ways in are hidden with one display', () => {
  const chrome = () =>
    render(
      <ShellStoreContext.Provider value={store() as never}>
        <ShellPresentChrome />
      </ShellStoreContext.Provider>
    );

  test('controls: one display shows no presenter button (and no divider for it)', async () => {
    shell(ONE);
    chrome();
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'start' });
    });
    await flush();
    expect(q('present-controls')).not.toBeNull();
    expect(q('present-slot-presenter')).toBeNull();
  });

  test('controls: two displays show the button; a click turns presenter view on', async () => {
    shell(TWO);
    chrome();
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'start' });
    });
    await flush();
    const btn = q('present-presenter-view');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    act(() => btn?.click());
    expect(presenterStore.get().wanted).toBe(true);
  });

  test('controls give way to the presenter view while it is on', async () => {
    shell(TWO);
    act(() => presenterStore.setWanted(true));
    chrome();
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'start' });
    });
    await flush();
    expect(q('present-controls')).toBeNull();
  });

  test('Present ⌄: no row without the prop; with it, the name and a check, and a click runs it', () => {
    const MODE = { edit: true, annotate: true, comment: true, present: true };
    let ran = 0;
    const row = (presenterView: unknown) =>
      render(
        <ModeSwitch
          mode="edit"
          caps={MODE as never}
          onSelect={() => {}}
          onPresent={() => {}}
          presenterView={presenterView as never}
          onPresenterView={() => {
            ran += 1;
          }}
        />
      );
    row(null);
    act(() => q('mode-present-menu')?.click());
    expect(q('mode-present-list')).not.toBeNull();
    expect(q('mode-present-presenter-view')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    row({ name: 'LG UltraFine', on: true });
    act(() => q('mode-present-menu')?.click());
    const r = q('mode-present-presenter-view');
    expect(r?.textContent).toContain('Presenter view on another display');
    expect(r?.textContent).toContain('LG UltraFine');
    expect(r?.getAttribute('aria-checked')).toBe('true');
    act(() => r?.click());
    expect(ran).toBe(1);
  });
});
