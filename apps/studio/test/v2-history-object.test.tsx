// S1.16 — Version history filtered to one object (V2-1.9 §5.9, 10 · co-vh): openHistory({ element }) /
// ({ annotation }) set the filter and show the panel; a missing id is stamped for an editor only; the header
// says "· this object" / "· this sticky"; rows carry who · time and the text then; Restore is per row, for
// editors, and posts the S1.13 object restore; "Found by matching" rows say "Restore the artboard instead.";
// "All versions" lifts the filter.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VersionHistoryHost } from '../client/v2/history/history-host.jsx';
import {
  historyScope,
  objectKey,
  objectUrl,
  openHistory,
  setHistoryOpener,
  tailFor,
} from '../client/v2/history/object-filter.js';

const PATH = '.design/ui/home.tsx';
const NOW = new Date(2026, 9, 18, 12, 0).getTime();
const at = (h: number) => new Date(2026, 9, 18, h, 0).getTime();

const rows = [
  {
    id: 'o4',
    ref: 'r4',
    rev: 4,
    who: { kind: 'person', actor: 'jonas', name: 'Jonas', you: false },
    madeAt: at(11),
    title: 'Sticky: “Číslo na zádech?” → “Číslo 25 cm”',
    lines: [],
    sub: 'Jonas · 11:00',
    what: 'changed',
    value: '“Číslo 25 cm”',
    matched: false,
    aside: false,
    restore: 'ok',
    chips: [],
  },
  {
    id: 'o3~aside',
    ref: 'r3',
    rev: 3,
    who: { kind: 'person', actor: 'me', name: 'You', you: true },
    madeAt: at(10),
    title: 'Your version, not kept',
    lines: [],
    sub: 'You · 10:00',
    what: 'changed',
    value: '“Číslo 28 cm”',
    matched: false,
    aside: true,
    restore: 'none',
    chips: ['Not kept'],
  },
  {
    id: 'o2',
    ref: 'r2',
    rev: 2,
    who: { kind: 'person', actor: 'tereza', name: 'Tereza', you: false },
    madeAt: at(9),
    title: 'Text “a” → “b”',
    lines: [],
    sub: 'Tereza · 09:00',
    what: 'changed',
    matched: true,
    aside: false,
    restore: 'artboard',
    chips: ['Found by matching'],
  },
];

type Call = { url: string; method: string; body?: Record<string, unknown> };
const calls: Call[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
const reset = () => {
  calls.length = 0;
  answer = {
    status: 200,
    body: { ok: true, key: 's1', header: 'this sticky', rows },
  };
};
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
  calls.push({
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(init.body) : undefined,
  });
  if (url.startsWith('/_api/project/object-history')) return j(answer.status, answer.body);
  if (url === '/_api/project/restore')
    return j(200, { ok: true, actionId: 'a_obj', line: 'Restored Sticky to 18 Oct, 11:00' });
  if (url.startsWith('/_api/project/versions')) return j(200, { ok: true, rows: [], now: null });
  return j(404, {});
}) as unknown as typeof fetch;

let host: HTMLElement;
let root: Root;
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {});
};
async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(el));
  await flush();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  historyScope.clear();
  setHistoryOpener(null);
  reset();
});
reset();

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
};
const toasts: Array<{ msg: string; ok: boolean; action?: { label: string } }> = [];
const toast = (msg: string, ok: boolean, action?: { label: string }) =>
  toasts.push({ msg, ok, action });
const base = { path: PATH, canvasLabel: 'Home', fetchImpl, toast, nowMs: NOW };

describe('openHistory', () => {
  test('keys: <artboard>/<id> for an element, the bare id for an annotation; bad ones are refused', () => {
    expect(objectKey({ element: { canvas: PATH, artboard: 'hero', element: 'cta' } })).toBe(
      'hero/cta'
    );
    expect(objectKey({ annotation: 's1' })).toBe('s1');
    expect(objectKey({ annotation: 'a/b' })).toBeNull();
    expect(objectKey({ element: { canvas: PATH, artboard: 'a/b', element: 'cta' } })).toBeNull();
    expect(tailFor('sticky')).toBe('this sticky');
    expect(tailFor(undefined)).toBe('this object');
    expect(objectUrl(PATH, 'hero/cta')).toBe(
      '/_api/project/object-history?path=.design%2Fui%2Fhome.tsx&object=hero%2Fcta'
    );
  });

  test('sets the filter and shows the panel; no target clears it', async () => {
    let shown = 0;
    setHistoryOpener(() => shown++);
    const r = await openHistory({ annotation: 's1', kind: 'sticky' }, { path: PATH });
    expect(r).toEqual({ ok: true, key: 's1', path: PATH });
    expect(historyScope.get()).toMatchObject({ path: PATH, key: 's1', tail: 'this sticky' });
    expect(shown).toBe(1);
    await openHistory();
    expect(historyScope.get()).toBeNull();
    expect(shown).toBe(2);
  });

  test('an element with no id: an editor stamps it first; a Can view person causes no write', async () => {
    const pending = {
      canvas: PATH,
      artboard: 'hero',
      print: { component: 'X', tag: 'p', chain: [], attrs: '' },
      hint: 'ab12cd34',
    };
    let stamps = 0;
    const queueStamp = async () => {
      stamps++;
      return { canvas: PATH, artboard: 'hero', element: 'lead' };
    };
    const viewer = await openHistory({ element: pending }, { canEdit: false, queueStamp });
    expect(viewer).toEqual({ ok: false, reason: 'unstamped' });
    expect(stamps).toBe(0);
    expect(historyScope.get()).toBeNull();
    const editor = await openHistory({ element: pending }, { canEdit: true, queueStamp });
    expect(editor).toMatchObject({ ok: true, key: 'hero/lead' });
    expect(stamps).toBe(1);
    const failed = await openHistory(
      { element: pending },
      { canEdit: true, queueStamp: async () => null }
    );
    expect(failed).toEqual({ ok: false, reason: 'stamp-failed' });
  });
});

describe('the filtered panel', () => {
  test('header says "· this sticky"; rows are who · time + the text then; chips and hints', async () => {
    historyScope.set({ path: PATH, key: 's1', tail: 'this object' });
    await mount(<VersionHistoryHost {...base} canEdit />);
    expect(calls[0]?.url).toBe(objectUrl(PATH, 's1'));
    expect(q('[data-testid="vh-scope"]')?.textContent).toBe('· this sticky'); // learned from the answer
    expect(q('[data-testid="vh-obj-row-r4"] strong')?.textContent).toBe('Jonas · 11:00');
    expect(q('[data-testid="vh-obj-row-r4"] .vh-obj-value')?.textContent).toBe('“Číslo 25 cm”');
    expect(q('[data-testid="vh-obj-row-r3-aside"] .chip')?.textContent).toBe('Not kept');
    expect(q('[data-testid="vh-obj-row-r2"] .chip')?.textContent).toBe('Found by matching');
    expect(q('[data-testid="vh-obj-hint-r2"]')?.textContent).toBe('Restore the artboard instead.');
    // the plain panel's Now row / filters are not drawn, and its versions are not read
    expect(q('[data-testid="vh-now"]')).toBeNull();
    expect(calls.some((c) => c.url.startsWith('/_api/project/versions'))).toBe(false);
  });

  test('Restore is per row for editors: the S1.13 object restore with Undo; not on matched / aside rows', async () => {
    toasts.length = 0;
    historyScope.set({ path: PATH, key: 's1', tail: 'this sticky' });
    await mount(<VersionHistoryHost {...base} canEdit />);
    expect(q('[data-testid="vh-obj-restore-r4"]')).not.toBeNull();
    expect(q('[data-testid="vh-obj-restore-r3-aside"]')).toBeNull();
    expect(q('[data-testid="vh-obj-restore-r2"]')).toBeNull();
    await click(q('[data-testid="vh-obj-restore-r4"]'));
    expect(calls.find((c) => c.url === '/_api/project/restore')?.body).toEqual({
      path: PATH,
      at: 'r4',
      element: 's1',
    });
    expect(toasts.at(-1)).toMatchObject({ msg: 'Restored Sticky to 18 Oct, 11:00', ok: true });
    expect(toasts.at(-1)?.action?.label).toBe('Undo');
  });

  test('Can view reads the same rows and sees no Restore (and no hint)', async () => {
    historyScope.set({ path: PATH, key: 's1', tail: 'this sticky' });
    await mount(<VersionHistoryHost {...base} canEdit={false} />);
    expect(document.querySelectorAll('.vh-obj-row').length).toBe(3);
    expect(document.querySelectorAll('[data-testid^="vh-obj-restore-"]').length).toBe(0);
    expect(q('[data-testid="vh-obj-hint-r2"]')).toBeNull();
  });

  test('"All versions" lifts the filter and the plain panel comes back', async () => {
    historyScope.set({ path: PATH, key: 's1', tail: 'this sticky' });
    await mount(<VersionHistoryHost {...base} canEdit />);
    await click(q('[data-testid="vh-scope-clear"]'));
    expect(historyScope.get()).toBeNull();
    expect(q('[data-testid="vh-scope"]')).toBeNull();
    expect(calls.some((c) => c.url.startsWith('/_api/project/versions'))).toBe(true);
  });

  test('another canvas in front drops the filter; an object with no versions says so; a failed read retries by hand', async () => {
    historyScope.set({ path: PATH, key: 's1', tail: 'this object' });
    answer = { status: 404, body: { ok: false, reason: 'not-found' } };
    await mount(<VersionHistoryHost {...base} canEdit />);
    expect(q('[data-testid="vh-obj-empty"] strong')?.textContent).toBe(
      'No versions of this object yet.'
    );
    await act(async () =>
      root.render(<VersionHistoryHost {...base} path=".design/ui/other.tsx" canEdit />)
    );
    await flush();
    expect(historyScope.get()).toBeNull();

    historyScope.set({ path: PATH, key: 's1', tail: 'this object' });
    answer = { status: 503, body: { ok: false } };
    await act(async () => root.render(<VersionHistoryHost {...base} canEdit />));
    await flush();
    expect(q('[data-testid="vh-obj-failed"]')).not.toBeNull();
    answer = { status: 200, body: { ok: true, key: 's1', header: 'this sticky', rows } };
    await click(q('[data-testid="vh-obj-retry"]'));
    expect(q('[data-testid="vh-obj-row-r4"]')).not.toBeNull();
  });
});
