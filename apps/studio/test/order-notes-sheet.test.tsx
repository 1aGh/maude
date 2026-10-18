// S3.5 — "Order and notes…": the model (client/v2/present/order-notes-model.js) and the sheet
// (order-notes-sheet.jsx, happy-dom + React). The sheet reorders, skips and annotates, and a save
// sends only what changed, with the ETag it read (S3-slices row S3.5 done-when).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import {
  countsLine,
  initialModel,
  moveRow,
  patchBody,
  runNumbers,
  setNote,
  stepRow,
  toCanvasOrder,
  toggleSkip,
} from '../client/v2/present/order-notes-model.js';

const BOARDS = [
  { id: 'a', label: 'Cover' },
  { id: 'b', label: 'Reel' },
  { id: 'c', label: 'Poster' },
  { id: 'd.x', label: 'Not storable' },
];
const ids = (m: { rows: { id: string }[] }) => m.rows.map((r) => r.id);

describe('the model', () => {
  test('no stored order = canvas order; a stored one goes first, the rest follow in canvas order', () => {
    expect(ids(initialModel(BOARDS, { present: null, notes: {} }))).toEqual(['a', 'b', 'c', 'd.x']);
    const m = initialModel(BOARDS, {
      present: { order: ['c', 'gone', 'a'], skip: ['b'] },
      notes: { a: 'Hi', gone: 'x' },
    });
    expect(ids(m)).toEqual(['c', 'a', 'b', 'd.x']);
    expect(m.custom).toBe(true);
    expect(m.rows.find((r) => r.id === 'b')?.skipped).toBe(true);
    expect(m.rows.find((r) => r.id === 'a')?.notes).toBe('Hi');
    expect(countsLine(m)).toBe('4 artboards · 1 skipped');
    expect([...runNumbers(m).values()]).toEqual([1, 2, null, 3]);
  });

  test('moving back onto canvas order is not a custom order', () => {
    const m0 = initialModel(BOARDS, {});
    const m1 = moveRow(m0, 0, 2);
    expect(ids(m1)).toEqual(['b', 'c', 'a', 'd.x']);
    expect(m1.custom).toBe(true);
    expect(moveRow(m1, 2, 0).custom).toBe(false);
    expect(toCanvasOrder(m1)).toMatchObject({ custom: false });
    expect(ids(toCanvasOrder(m1))).toEqual(ids(m0));
    expect(stepRow(m0, 'a', -1)).toBe(m0); // clamped: nothing moves
  });

  test('the save body holds only what changed', () => {
    const start = initialModel(BOARDS, { present: { skip: ['c'] }, notes: { a: 'Old' } });
    expect(patchBody(start, start)).toBeNull();
    // a note: one note
    expect(patchBody(start, setNote(start, 'b', 'New'))).toEqual({ notes: { b: 'New' } });
    // emptied (or whitespace) note: removed
    expect(patchBody(start, setNote(start, 'a', '  '))).toEqual({ notes: { a: null } });
    // order: the storable ids only; canvas order again = null
    const moved = stepRow(start, 'c', -1);
    expect(patchBody(start, moved)).toEqual({ present: { order: ['a', 'c', 'b'] } });
    const custom = initialModel(BOARDS, { present: { order: ['b', 'a'] } });
    expect(patchBody(custom, toCanvasOrder(custom))).toEqual({ present: { order: null } });
    // skip: the whole list, or null when none is left
    expect(patchBody(start, toggleSkip(start, 'a'))).toEqual({ present: { skip: ['a', 'c'] } });
    expect(patchBody(start, toggleSkip(start, 'c'))).toEqual({ present: { skip: null } });
  });

  test('an id the sidecar cannot store is shown but never skipped, noted or written', () => {
    const m = initialModel(BOARDS, {});
    expect(toggleSkip(m, 'd.x').rows[3]?.skipped).toBe(false);
    expect(setNote(m, 'd.x', 'n').rows[3]?.notes).toBe('');
    expect(patchBody(m, moveRow(m, 3, 0))).toEqual({ present: { order: ['a', 'b', 'c'] } });
  });
});

// ── the sheet ────────────────────────────────────────────────────────────────────────────────
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
const tick = () => new Promise((r) => setTimeout(r, 10));

type Sent = Record<string, unknown>;
async function mount(answer: (body: Sent) => { status: number; data: unknown }) {
  const { OrderNotesSheet } = await import('../client/v2/present/order-notes-sheet.jsx');
  const sent: Sent[] = [];
  const events: string[] = [];
  const request = async (body: Sent) => {
    sent.push(body);
    return answer(body);
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <OrderNotesSheet
        file=".design/ui/Deck.tsx"
        canvasName="Deck"
        artboards={BOARDS}
        request={request}
        onClose={() => events.push('close')}
        onSaved={() => events.push('saved')}
      />
    );
    await tick();
  });
  const $ = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = async (id: string) => {
    await act(async () => {
      $(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await tick();
    });
  };
  return { sent, events, $, click };
}
const STATE = { ok: true, present: null, notes: { a: 'Hi' }, etag: 'm-1' };

describe('the sheet', () => {
  test('reads once, reorders, skips, annotates and saves only the change with the ETag', async () => {
    const s = await mount((b) =>
      Object.keys(b).length === 1 ? { status: 200, data: STATE } : { status: 200, data: STATE }
    );
    expect(s.sent).toEqual([{ file: '.design/ui/Deck.tsx' }]);
    expect(s.$('present-order-notes')?.getAttribute('role')).toBe('dialog');
    expect(s.$('present-order-counts')?.textContent).toBe('4 artboards');
    expect((s.$('present-order-save') as HTMLButtonElement).disabled).toBe(true);

    await s.click('present-order-down-a');
    const rows = [...(host?.querySelectorAll('[data-testid^="present-order-row-"]') ?? [])].map(
      (r) => r.getAttribute('data-testid')
    );
    expect(rows).toEqual([
      'present-order-row-b',
      'present-order-row-a',
      'present-order-row-c',
      'present-order-row-d.x',
    ]);
    expect(s.$('present-order-reset')).not.toBeNull();
    await s.click('present-order-skip-c');
    expect(s.$('present-order-skip-c')?.getAttribute('aria-pressed')).toBe('true');
    expect(s.$('present-order-counts')?.textContent).toBe('4 artboards · 1 skipped');
    // the notes field follows the selected row (a: first row at open)
    const field = s.$('present-order-notes-field') as HTMLTextAreaElement;
    expect(field.value).toBe('Hi');

    await s.click('present-order-save');
    expect(s.sent[1]).toEqual({
      file: '.design/ui/Deck.tsx',
      present: { order: ['b', 'a', 'c'], skip: ['c'] },
      expected: 'm-1',
    });
    expect(s.events).toEqual(['saved', 'close']);
  });

  test('a stale save keeps the sheet open and says why', async () => {
    let n = 0;
    const s = await mount(() =>
      n++ === 0 ? { status: 200, data: STATE } : { status: 409, data: { error: 'stale' } }
    );
    await s.click('present-order-skip-a');
    await s.click('present-order-save');
    expect(s.$('present-order-error')?.textContent).toContain('changed somewhere else');
    expect(s.events).toEqual([]);
  });

  test('a read that fails says so and offers only Cancel', async () => {
    const s = await mount(() => ({ status: 403, data: null }));
    expect(s.$('present-order-error')).not.toBeNull();
    expect(s.$('present-order-save')).toBeNull();
    await s.click('present-order-cancel');
    expect(s.events).toEqual(['close']);
  });

  test('esc closes without saving', async () => {
    const s = await mount(() => ({ status: 200, data: STATE }));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await tick();
    });
    expect(s.events).toEqual(['close']);
    expect(s.sent.length).toBe(1);
  });
});
