// S10.8 (13 · ds-edit-review, ds-edit-master) — "Update N canvases": the review a design-system change goes
// through before any canvas moves. The model is pure (defaults, words, request body); the sheet is real markup.
// Pinned here: followers ticked, left-out unticked, pinned/blocked unticked WITH a reason and not tickable;
// the words are CONTRACT §3 ("Update 4 canvases", "Update 1 canvas") and the copy from canvas 13.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  canvasCount,
  defaultTicks,
  fineInBoth,
  finePrint,
  groupByFolder,
  headWords,
  keepsWords,
  noteFor,
  primaryWords,
  publishBody,
  reasonWords,
  refusalWords,
  reviewTitle,
  rowsOf,
  tickState,
  updatedWords,
  withTicks,
} from '../client/v2/ds/review-model.js';

const H = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const ACCENT = {
  css: '--accent',
  label: 'Accent',
  before: { light: 'oklch(0.55 0.17 255)', dark: 'oklch(0.65 0.15 255)' },
  after: { light: 'oklch(0.5 0.19 255)', dark: 'oklch(0.6 0.175 255)' },
};
// The five canvases of 13 · ds-edit-review, plus one that is pinned.
const CANVASES = [
  { path: 'ui/Homepage.tsx', folder: 'ui', state: 'follows', dsRev: null, ticked: true },
  { path: 'ui/Pricing.tsx', folder: 'ui', state: 'follows', dsRev: null, ticked: true },
  { path: 'ui/Onboarding.tsx', folder: 'ui', state: 'follows', dsRev: null, ticked: true },
  { path: 'ui/Mobile — detail.tsx', folder: 'ui', state: 'follows', dsRev: null, ticked: true },
  { path: 'ui/Landing page.tsx', folder: 'ui', state: 'left-out', dsRev: OLD, ticked: false },
  {
    path: 'ui/Brand sheet.tsx',
    folder: 'ui',
    state: 'pinned',
    dsRev: null,
    ticked: false,
    reason: 'pinned',
  },
];
const REVIEW = { system: 'studio', expectHead: H, changes: [ACCENT], canvases: CANVASES };

describe('the review model — defaults and words', () => {
  test('followers are ticked, left-out are not, pinned are not and say why', () => {
    const rows = rowsOf(CANVASES, { 'ui/Homepage.tsx': 14 });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.Homepage).toMatchObject({ ticked: true, locked: false, places: 14 });
    expect(by.Pricing.ticked).toBe(true);
    expect(by['Landing page']).toMatchObject({ ticked: false, locked: false, state: 'left-out' });
    expect(by['Brand sheet']).toMatchObject({ ticked: false, locked: true, reason: 'pinned' });
    expect(defaultTicks(rows)).toMatchObject({
      'ui/Homepage.tsx': true,
      'ui/Landing page.tsx': false,
      'ui/Brand sheet.tsx': false,
    });
  });

  test('a blocked canvas (the schema level) is unticked with its reason, not tickable', () => {
    const rows = rowsOf([
      { path: 'ui/Old.tsx', folder: 'ui', state: 'blocked', ticked: false, reason: 'ds-level-11' },
    ]);
    expect(rows[0]).toMatchObject({ locked: true, ticked: false, reason: 'ds-level-11' });
    expect(noteFor(rows[0])).toBe('Made before the schema — keeps its look');
    // a tick the person asks for never lands on a locked row
    expect(withTicks(rows, { 'ui/Old.tsx': true })[0].ticked).toBe(false);
  });

  test('words: CONTRACT §3 — the title asks with the verb the button does; counts read for 1 and many', () => {
    expect(reviewTitle({ changes: [ACCENT] })).toBe('Update canvases with the new Accent?');
    expect(reviewTitle({ components: ['Tlačítko'] })).toBe(
      'Update canvases with the new Tlačítko?'
    );
    expect(reviewTitle({ changes: [ACCENT, { ...ACCENT, css: '--fg-0', label: 'Ink' }] })).toBe(
      'Update canvases with 2 changes?'
    );
    expect(primaryWords(4)).toBe('Update 4 canvases');
    expect(primaryWords(1)).toBe('Update 1 canvas');
    expect(primaryWords(0)).toBe('Update no canvases');
    expect(canvasCount(1)).toBe('1 canvas');
    expect(headWords(withTicks(rowsOf(CANVASES.slice(0, 5)), {}), 'Studio site')).toBe(
      '4 of 5 canvases in Studio site'
    );
  });

  test('copy goldens from 13 · ds-edit-review', () => {
    expect(finePrint({ changes: [ACCENT] })).toBe(
      'Unticked canvases keep the old Accent and show an update dot. Cancel puts the swatch back — nothing changes.'
    );
    expect(finePrint({ changes: [ACCENT], openBy: { name: 'Tereza', canvas: 'Pricing' } })).toBe(
      "Unticked canvases keep the old Accent and show an update dot. Cancel puts the swatch back — nothing changes. Tereza's open Pricing updates when Tereza next looks at it."
    );
    expect(keepsWords([ACCENT])).toBe('the old Accent');
    const rows = rowsOf(CANVASES, { 'ui/Pricing.tsx': 11 });
    const left = withTicks(rows, { 'ui/Pricing.tsx': false }).find((r) => r.name === 'Pricing');
    expect(noteFor(rows.find((r) => r.name === 'Pricing') as never)).toBe('11 places');
    expect(noteFor(left as never, { keeps: 'the old Accent' })).toBe(
      'Left out — keeps the old Accent, gets an update dot'
    );
    expect(reasonWords('pinned')).toBe('Pinned — keeps its look');
  });

  test('"Fine in Light and Dark" needs a value in both themes and no failed contrast', () => {
    expect(fineInBoth(ACCENT)).toBe(true);
    expect(fineInBoth({ ...ACCENT, after: { light: 'red' } })).toBe(false);
    expect(fineInBoth({ ...ACCENT, contrast: { light: true, dark: false } })).toBe(false);
  });

  test('tick state and the request body', () => {
    const rows = rowsOf(CANVASES);
    expect(tickState(rows)).toBe('mixed');
    expect(tickState(withTicks(rows, Object.fromEntries(rows.map((r) => [r.path, true]))))).toBe(
      'all'
    );
    const body = publishBody({ ds: 'studio', expectHead: H }, rows);
    // the pinned canvas is not part of the ask; the left-out one is, unticked
    expect(body.canvases.map((c) => c.path)).not.toContain('ui/Brand sheet.tsx');
    expect(body.canvases.find((c) => c.path === 'ui/Landing page.tsx')).toEqual({
      path: 'ui/Landing page.tsx',
      ticked: false,
    });
    expect(body).toMatchObject({ ds: 'studio', expectHead: H });
  });

  test('refusals have words, and Updated says how many stayed out', () => {
    expect(refusalWords('ds-head-moved')).toContain('changed while this was open');
    expect(refusalWords('ds-outside-unreviewed')).toContain('outside the app');
    expect(refusalWords('nope')).toBe('Not updated. Nothing changed; try again.');
    expect(updatedWords(4, 1)).toBe('Updated 4 canvases. 1 left out keeps the old look.');
    expect(updatedWords(1, 0)).toBe('Updated 1 canvas.');
  });

  test('more than twelve canvases group by folder; a folder with every row off reads "left out"', () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) => ({
        path: `club-web/p${i}.tsx`,
        folder: 'club-web',
        state: 'follows',
        ticked: true,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        path: `2026/combine/c${i}.tsx`,
        folder: '2026/combine',
        state: 'left-out',
        ticked: false,
      })),
    ];
    const groups = groupByFolder(rowsOf(many));
    expect(groups.map((g) => [g.folder, g.state])).toEqual([
      ['2026/combine', 'none'],
      ['club-web', 'all'],
    ]);
  });
});

// ── the sheet ────────────────────────────────────────────────────────────────────────────────

let Sheet: typeof import('../client/v2/ds/review-sheet.jsx').DsReviewSheet;
const roots: Root[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Sheet = (await import('../client/v2/ds/review-sheet.jsx')).DsReviewSheet;
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

type Calls = { updated: unknown[][]; cancelled: number; closed: number };
async function mount(over: Record<string, unknown> = {}, calls?: Calls) {
  const c = calls ?? { updated: [], cancelled: 0, closed: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <Sheet
        review={REVIEW}
        places={{ 'ui/Homepage.tsx': 14, 'ui/Pricing.tsx': 11 }}
        scope="Studio site"
        onUpdate={async (rows: unknown[]) => {
          c.updated.push(rows);
          return { ok: true };
        }}
        onCancel={async () => {
          c.cancelled++;
          return { ok: true };
        }}
        onClose={() => {
          c.closed++;
        }}
        {...over}
      />
    )
  );
  return { host, calls: c };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, id: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const rowTick = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLButtonElement>(
    `[data-testid="ds-review-tick"][data-path="ui/${name}.tsx"]`
  ) as HTMLButtonElement;
const click = async (el: Element | null) => {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

describe('the sheet', () => {
  test('canvas 13 · ds-edit-review: title, swatch line, head count, five rows, fine print', async () => {
    const { host } = await mount({
      review: { ...REVIEW, canvases: CANVASES.slice(0, 5) },
    });
    expect(q(host, 'ds-review-title')?.textContent).toBe('Update canvases with the new Accent?');
    expect(q(host, 'ds-review-swatch')?.textContent).toContain('Accent');
    expect(q(host, 'ds-review-ok')?.textContent).toBe('Fine in Light and Dark');
    expect(q(host, 'ds-review-head')?.textContent).toBe('4 of 5 canvases in Studio site');
    expect(all(host, 'ds-review-row')).toHaveLength(5);
    expect(q(host, 'ds-review-update')?.textContent).toBe('Update 4 canvases');
    expect(q(host, 'ds-review-cancel')?.textContent).toBe('Cancel');
    expect(q(host, 'ds-review-fine')?.textContent).toBe(
      'Unticked canvases keep the old Accent and show an update dot. Cancel puts the swatch back — nothing changes.'
    );
  });

  test('defaults: followers ticked, the left-out one is not, the pinned one says why and cannot be ticked', async () => {
    const { host } = await mount();
    for (const n of ['Homepage', 'Pricing', 'Onboarding', 'Mobile — detail'])
      expect(rowTick(host, n).getAttribute('aria-checked')).toBe('true');
    expect(rowTick(host, 'Landing page').getAttribute('aria-checked')).toBe('false');
    const pinned = rowTick(host, 'Brand sheet');
    expect(pinned.getAttribute('aria-checked')).toBe('false');
    expect(pinned.disabled).toBe(true);
    const row = host.querySelector('[data-path="ui/Brand sheet.tsx"][data-testid="ds-review-row"]');
    expect(row?.querySelector('[data-testid="ds-review-note"]')?.textContent).toBe(
      'Pinned — keeps its look'
    );
    expect(q(host, 'ds-review-update')?.textContent).toBe('Update 4 canvases');
  });

  test('unticking a follower counts down; Update sends the ticks, Landing page stays out', async () => {
    const { host, calls } = await mount();
    await click(rowTick(host, 'Onboarding'));
    expect(q(host, 'ds-review-update')?.textContent).toBe('Update 3 canvases');
    expect(q(host, 'ds-review-head')?.textContent).toBe('3 of 5 canvases in Studio site');
    await click(q(host, 'ds-review-update'));
    expect(calls.updated).toHaveLength(1);
    const rows = calls.updated[0] as Array<{ path: string; ticked: boolean }>;
    expect(rows.find((r) => r.path === 'ui/Onboarding.tsx')?.ticked).toBe(false);
    expect(rows.find((r) => r.path === 'ui/Landing page.tsx')?.ticked).toBe(false);
    expect(rows.find((r) => r.path === 'ui/Homepage.tsx')?.ticked).toBe(true);
  });

  test('the head tick flips every row that can tick; Before / After flips the swatch view', async () => {
    const { host } = await mount();
    await click(q(host, 'ds-review-head-tick'));
    expect(q(host, 'ds-review-update')?.textContent).toBe('Update 5 canvases');
    expect(rowTick(host, 'Brand sheet').getAttribute('aria-checked')).toBe('false');
    await click(q(host, 'ds-review-head-tick'));
    expect(q(host, 'ds-review-update')?.textContent).toBe('Update no canvases');
    expect(q(host, 'ds-review-seg-after')?.getAttribute('aria-pressed')).toBe('true');
    await click(q(host, 'ds-review-seg-before'));
    expect(q(host, 'ds-review-seg-before')?.getAttribute('aria-pressed')).toBe('true');
    expect(q(host, 'ds-review')?.getAttribute('data-view')).toBe('before');
  });

  test('Cancel asks the host to put the swatch back; Esc only closes', async () => {
    const { host, calls } = await mount();
    await click(q(host, 'ds-review-cancel'));
    expect(calls.cancelled).toBe(1);
    await act(async () => {
      host
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls.cancelled).toBe(1);
    expect(calls.closed).toBeGreaterThan(0);
  });

  test('a refusal prints under the list, in words, and the sheet stays', async () => {
    const { host } = await mount({
      onUpdate: async () => ({ ok: false, message: refusalWords('ds-head-moved') }),
    });
    await click(q(host, 'ds-review-update'));
    expect(q(host, 'ds-review-error')?.textContent).toContain('changed while this was open');
    expect(q(host, 'ds-review')).not.toBeNull();
  });

  test('canvas 13 · ds-edit-master: past twelve canvases the list is by folder and a folder ticks as one', async () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) => ({
        path: `club-web/p${i}.tsx`,
        folder: 'club-web',
        state: 'follows',
        ticked: true,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        path: `2026/combine/c${i}.tsx`,
        folder: '2026/combine',
        state: 'left-out',
        ticked: false,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        path: `print/q${i}.tsx`,
        folder: 'print',
        state: 'follows',
        ticked: true,
      })),
    ];
    const { host, calls } = await mount({ review: { ...REVIEW, canvases: many } });
    expect(q(host, 'ds-review-list')?.getAttribute('data-grouped')).toBe('true');
    expect(q(host, 'ds-review-head')?.textContent).toBe('8 of 14 canvases in Studio site');
    const combine = host.querySelector(
      '[data-testid="ds-review-folder"][data-folder="2026/combine"]'
    );
    expect(combine?.textContent).toContain('6 canvases · left out');
    await click(combine?.querySelector('[data-testid="ds-review-folder-tick"]') ?? null);
    expect(q(host, 'ds-review-head')?.textContent).toBe('14 of 14 canvases in Studio site');
    await click(q(host, 'ds-review-update'));
    const rows = calls.updated[0] as Array<{ ticked: boolean }>;
    expect(rows.every((r) => r.ticked)).toBe(true);
  });

  test('a colour value is painted only when it is a plain colour (never a url)', async () => {
    const { safeColour } = await import('../client/v2/ds/review-sheet.jsx');
    expect(safeColour('oklch(0.5 0.19 255)')).toBe('oklch(0.5 0.19 255)');
    expect(safeColour('#1f5fd0')).toBe('#1f5fd0');
    expect(safeColour('url(https://x.test/a.png)')).toBeNull();
    expect(safeColour('red; background: url(x)')).toBeNull();
    expect(safeColour('10px')).toBeNull();
  });
});
