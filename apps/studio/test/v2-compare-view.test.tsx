// S1.15 — Compare, drawn (11 · pn-compare): two read-only frames (Side by side / Overlay), the changes in words
// with who made each, the A / B marks on the rows, Stop comparing, "Restore only <artboard>" and
// "Restore this version" — and Version history › Advanced › Compare pictures.
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
import { compareStore, nowWords } from '../client/v2/history/compare-store.js';
import {
  CompareHost,
  CompareView,
  changesUrl,
  useFrameTheme,
} from '../client/v2/history/compare-view.jsx';
import { VersionHistoryHost } from '../client/v2/history/history-host.jsx';
import { VersionHistoryPanel } from '../client/v2/history/history-panel.jsx';
import { shellMode } from '../client/v2/shell/use-canvas-mode-lane.js';

const PATH = '.design/ui/Uniformy-2027.tsx';
const NOW = new Date(2026, 9, 18, 15, 0).getTime();
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();

const row = (o: Record<string, unknown>) => ({
  id: `a${o.ref}`,
  from: null,
  canvas: 'ui/Uniformy-2027.tsx',
  who: { kind: 'person', actor: 'you', name: 'You', you: true },
  kind: 'edit',
  title: 'Číslo 27 větší',
  sub: '14:05 · You',
  chips: [],
  artboards: ['front'],
  changes: 1,
  actions: [],
  thumb: null,
  ...o,
});
const ROWS = [
  row({
    ref: 'r43',
    title: 'Venkovní dres v zelené',
    who: { kind: 'ai', actor: 'ai:you', name: 'AI', you: true },
    kind: 'ai',
    chatId: 'c1',
    chips: ['Made by AI'],
    madeAt: at(18, 14, 32),
  }),
  row({ ref: 'r42', madeAt: at(18, 14, 5) }),
  row({
    ref: 'r40',
    title: 'Logo na helmě',
    who: { kind: 'person', actor: 'tereza', name: 'Tereza', you: false },
    madeAt: at(18, 11, 20),
  }),
  row({
    ref: 'r41',
    title: 'Schváleno trenéry',
    sub: '18:40 · Jonas',
    who: { kind: 'person', actor: 'jonas', name: 'Jonas', you: false },
    named: { name: 'Schváleno trenéry', by: 'jonas', at: at(17, 18, 40) },
    chips: ['Named'],
    madeAt: at(17, 18, 40),
  }),
];

const CHANGES = [
  { artboards: ['front'], grade: 'W1', kind: 'style', words: 'Dres: černá → zelená' },
  { artboards: ['front'], grade: 'W1', kind: 'style', words: 'Číslo 27: 120 → 150 px' },
  { artboards: ['helmet'], grade: 'W1', kind: 'added', words: 'Logo na helmě: added' },
];
const CHANGED = {
  ok: true,
  from: 'r41',
  to: 'r43',
  changes: CHANGES,
  detail: {},
  blame: { 0: 'ar43', 1: 'ar42', 2: 'ar40' },
  labels: { front: 'Venkovní dres', helmet: 'Helma z boku' },
};

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let changes: { status: number; body: unknown } = { status: 200, body: CHANGED };
let restore: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true, actionId: 'a_restore', line: 'Restored Venkovní dres to 17 Oct, 18:40' },
};
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
  if (url.startsWith('/_api/project/versions'))
    return j(200, {
      ok: true,
      source: 'accepted',
      rows: ROWS,
      now: { canvas: 'ui/Uniformy-2027.tsx', ref: 'r43', status: 'Saved', canName: true },
    });
  if (url.startsWith('/_api/project/changes')) return j(changes.status, changes.body);
  if (url === '/_api/project/restore') return j(restore.status, restore.body);
  if (url === '/_api/project/undo') return j(200, { ok: true, actionId: 'a_undo' });
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
const reset = () => {
  calls = [];
  changes = { status: 200, body: CHANGED };
  restore = {
    status: 200,
    body: { ok: true, actionId: 'a_restore', line: 'Restored Venkovní dres to 17 Oct, 18:40' },
  };
};
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  compareStore.stop();
  shellMode.leaveViewing();
  reset();
});
reset();

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
};
const toasts: Array<{ msg: string; ok: boolean }> = [];
const toast = (msg: string, ok: boolean) => toasts.push({ msg, ok });

const A = { at: 'r41', title: 'Schváleno trenéry', when: '17 Oct, 18:40', who: 'Jonas' };
const cfg = { designRel: '.design' };
const ready = {
  status: 'ready',
  changes: CHANGES,
  detail: {},
  blame: CHANGED.blame,
  labels: CHANGED.labels,
};
const state = (o: Record<string, unknown> = {}) => ({
  path: PATH,
  a: A,
  b: nowWords(NOW),
  mode: 'side',
  focus: null,
  rows: ROWS,
  answer: ready,
  ...o,
});

describe('the two frames', () => {
  test('A is the version, read-only; B is Now, read-only — neither persists a camera or a layout', async () => {
    await mount(<CompareView state={state()} cfg={cfg} />);
    const a = q('[data-testid="cmp-frame-a"]') as HTMLIFrameElement;
    const b = q('[data-testid="cmp-frame-b"]') as HTMLIFrameElement;
    const qa_ = new URL(a.getAttribute('src') as string, 'http://x').searchParams;
    expect(qa_.get('sha')).toBe('r41');
    expect(qa_.get('ro')).toBe('1');
    expect(qa_.get('comments')).toBe('0');
    expect(qa_.get('hide-chrome')).toBe('1');
    const qb = new URL(b.getAttribute('src') as string, 'http://x').searchParams;
    expect(qb.get('sha')).toBeNull(); // Now is the canvas as it is
    expect(qb.get('ro')).toBe('1');
    expect(qb.get('comments')).toBe('0');
    expect(qb.get('embed')).toBe('1'); // the embed keeps its camera to itself
    expect(qb.get('hide-chrome')).toBe('1');
    expect(q('[data-testid="cmp-frame-a-cap"]')?.textContent).toBe(
      'A · Schváleno trenéry · 17 Oct, 18:40 · Jonas'
    );
    expect(q('[data-testid="cmp-frame-b-cap"]')?.textContent).toBe('B · Now · 18 Oct, 15:00');
  });

  test('a second version as B is framed at its own ref', async () => {
    await mount(
      <CompareView
        state={state({ b: { at: 'r42', title: 'Číslo 27 větší', when: 'x', who: '' } })}
        cfg={cfg}
      />
    );
    const qb = new URL(
      (q('[data-testid="cmp-frame-b"]') as HTMLIFrameElement).getAttribute('src') as string,
      'http://x'
    ).searchParams;
    expect(qb.get('sha')).toBe('r42');
  });

  test('Side by side | Overlay: the mode is the person’s; Overlay adds the slider', async () => {
    const seen: string[] = [];
    await mount(<CompareView state={state()} cfg={cfg} onMode={(m: string) => seen.push(m)} />);
    expect(q('[data-testid="cmp-mode-side"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-testid="cmp-wipe"]')).toBeNull();
    await click(q('[data-testid="cmp-mode-overlay"]'));
    expect(seen).toEqual(['overlay']);
    await act(async () =>
      root.render(<CompareView state={state({ mode: 'overlay' })} cfg={cfg} />)
    );
    expect(q('[data-testid="cmp-stage"]')?.getAttribute('data-mode')).toBe('overlay');
    expect(q('[data-testid="cmp-wipe"]')).not.toBeNull();
    // both frames stay: B is clipped over A, not swapped
    expect(qa('iframe').length).toBe(2);
  });

  test('a frame does not reload when the page re-renders', async () => {
    await mount(<CompareView state={state()} cfg={cfg} />);
    const a = q('[data-testid="cmp-frame-a"]');
    await act(async () =>
      root.render(<CompareView state={state({ focus: 'helmet' })} cfg={cfg} />)
    );
    expect(q('[data-testid="cmp-frame-a"]')).toBe(a); // the same element, the same document
  });
});

describe('the changes, in words, with who made them', () => {
  test('summary, one line per change under its artboard, a spark or a face and the time', async () => {
    await mount(<CompareView state={state()} cfg={cfg} />);
    expect(q('[data-testid="cmp-summary"]')?.textContent).toBe(
      '3 changes between A and B — 2 on Venkovní dres, 1 on Helma z boku'
    );
    const lines = qa('.cmp-line');
    expect(lines.length).toBe(3);
    expect(lines[0]?.textContent).toContain('Venkovní dres');
    expect(lines[0]?.textContent).toContain('Dres: černá → zelená');
    expect(q('[data-testid="cmp-who-0"] .cmp-who-t')?.textContent).toBe('Made by AI, 14:32');
    expect(q('[data-testid="cmp-who-0"]')?.getAttribute('data-maker')).toBe('ai');
    expect(q('[data-testid="cmp-who-1"] .cmp-who-t')?.textContent).toBe('You, 14:05');
    expect(q('[data-testid="cmp-who-2"] .cmp-who-t')?.textContent).toBe('Tereza, 11:20');
    expect(q('[data-testid="cmp-who-2"] .vh-face')?.textContent).toBe('TE');
  });

  test('a line nobody’s row made says so and shows no face', async () => {
    await mount(
      <CompareView state={state({ answer: { ...ready, blame: { 0: 'ar43' } } })} cfg={cfg} />
    );
    expect(q('[data-testid="cmp-who-1"] .cmp-who-t')?.textContent).toBe('changed in between');
    expect(q('[data-testid="cmp-who-1"] .vh-face')).toBeNull();
    expect(q('[data-testid="cmp-who-1"] .vh-ai')).toBeNull();
  });

  test('a click on a line focuses its artboard', async () => {
    const focused: string[] = [];
    await mount(
      <CompareView state={state()} cfg={cfg} onFocus={(id: string) => focused.push(id)} />
    );
    await click(q('[data-testid="cmp-line-2"]'));
    expect(focused).toEqual(['helmet']);
    await act(async () =>
      root.render(<CompareView state={state({ focus: 'helmet' })} cfg={cfg} />)
    );
    expect(q('[data-testid="cmp-line-2"]')?.getAttribute('aria-current')).toBe('true');
    expect(q('[data-testid="cmp-line-0"]')?.getAttribute('aria-current')).toBeNull();
  });

  test('a reworked artboard is one line that opens to its own lines', async () => {
    const answer = {
      ...ready,
      changes: [
        {
          artboards: ['front'],
          grade: 'W1',
          kind: 'reworked',
          words: 'Reworked Venkovní dres — 3 changes',
        },
      ],
      detail: {
        front: [
          { artboards: ['front'], grade: 'W1', kind: 'style', words: 'Dres: černá → zelená' },
          { artboards: ['front'], grade: 'W1', kind: 'style', words: 'Límec: zelený → černý' },
          { artboards: ['front'], grade: 'W1', kind: 'style', words: 'Číslo 27: 120 → 150 px' },
        ],
      },
      blame: {},
    };
    await mount(<CompareView state={state({ answer })} cfg={cfg} />);
    expect(q('[data-testid="cmp-sub-0"]')).toBeNull();
    expect(q('[data-testid="cmp-expand-0"]')?.textContent).toBe('Show 3 changes');
    await click(q('[data-testid="cmp-expand-0"]'));
    expect(qa('[data-testid="cmp-sub-0"] li').map((l) => l.textContent)).toEqual([
      'Dres: černá → zelená',
      'Límec: zelený → černý',
      'Číslo 27: 120 → 150 px',
    ]);
  });

  test('no changes, still reading, and a failed read each say so', async () => {
    await mount(<CompareView state={state({ answer: { ...ready, changes: [] } })} cfg={cfg} />);
    expect(q('[data-testid="cmp-summary"]')?.textContent).toBe('No changes between A and B.');
    expect(q('[data-testid="cmp-list"]')).toBeNull();
    await act(async () =>
      root.render(<CompareView state={state({ answer: { status: 'loading' } })} cfg={cfg} />)
    );
    expect(q('[data-testid="cmp-summary"]')?.textContent).toBe('Reading the changes…');
    let retried = 0;
    await act(async () =>
      root.render(
        <CompareView
          state={state({ answer: { status: 'error' } })}
          cfg={cfg}
          onRetry={() => retried++}
        />
      )
    );
    expect(q('[data-testid="cmp-summary"]')?.textContent).toBe(
      "Couldn't read the changes. Your work is safe."
    );
    await click(q('[data-testid="cmp-retry"]')); // never automatic
    expect(retried).toBe(1);
  });
});

describe('the host: it rides on the Viewing hold', () => {
  const hold = () =>
    shellMode.view({ path: PATH, at: 'r41', title: A.title, when: A.when, who: A.who });

  test('reads the changes between A and Now and draws them; the answer is the store’s', async () => {
    hold();
    compareStore.start({ path: PATH, a: A, nowMs: NOW });
    await mount(<CompareHost cfg={cfg} fetchImpl={fetchImpl} />);
    expect(calls.find((c) => c.url.startsWith('/_api/project/changes'))?.url).toBe(
      changesUrl({ path: PATH, from: 'r41', to: 'now' })
    );
    expect(q('[data-testid="cmp-view"]')).not.toBeNull();
    expect(q('[data-testid="cmp-summary"]')?.textContent).toContain('3 changes between A and B');
    expect(compareStore.get()?.answer).toMatchObject({ status: 'ready' });
  });

  test('a second version as B reads the pair again — and an answer for the old pair never lands', async () => {
    hold();
    compareStore.start({ path: PATH, a: A, nowMs: NOW });
    await mount(<CompareHost cfg={cfg} fetchImpl={fetchImpl} />);
    changes = {
      status: 200,
      body: { ...CHANGED, to: 'r42', changes: CHANGES.slice(1), blame: {} },
    };
    await act(async () =>
      compareStore.setB({ at: 'r42', title: 'Číslo 27 větší', when: '18 Oct, 14:05', who: 'You' })
    );
    await flush();
    const urls = calls.filter((c) => c.url.startsWith('/_api/project/changes')).map((c) => c.url);
    expect(urls.at(-1)).toBe(changesUrl({ path: PATH, from: 'r41', to: 'r42' }));
    expect(q('[data-testid="cmp-summary"]')?.textContent).toContain('2 changes between A and B');
  });

  test('a failed read is "Couldn’t read the changes", and Retry reads it again', async () => {
    hold();
    changes = { status: 503, body: { ok: false, reason: 'unreachable' } };
    compareStore.start({ path: PATH, a: A, nowMs: NOW });
    await mount(<CompareHost cfg={cfg} fetchImpl={fetchImpl} />);
    expect(q('[data-testid="cmp-summary"]')?.textContent).toContain("Couldn't read the changes");
    changes = { status: 200, body: CHANGED };
    await click(q('[data-testid="cmp-retry"]'));
    expect(q('[data-testid="cmp-summary"]')?.textContent).toContain('3 changes between A and B');
  });

  test('leaving the hold (esc, another canvas, a restore) ends Compare', async () => {
    hold();
    compareStore.start({ path: PATH, a: A, nowMs: NOW });
    await mount(<CompareHost cfg={cfg} fetchImpl={fetchImpl} />);
    expect(q('[data-testid="cmp-view"]')).not.toBeNull();
    await act(async () => shellMode.leaveViewing());
    await flush();
    expect(q('[data-testid="cmp-view"]')).toBeNull();
    expect(compareStore.get()).toBeNull();
  });

  test('without a hold there is nothing to draw', async () => {
    compareStore.start({ path: PATH, a: A, nowMs: NOW });
    await mount(<CompareHost cfg={cfg} fetchImpl={fetchImpl} />);
    expect(q('[data-testid="cmp-view"]')).toBeNull();
    expect(compareStore.get()).toBeNull();
    expect(calls.some((c) => c.url.startsWith('/_api/project/changes'))).toBe(false);
  });
});

const base = {
  path: PATH,
  canvasLabel: 'Uniformy-2027',
  canEdit: true,
  fetchImpl,
  toast,
  nowMs: NOW,
};
const comparing = (o: Record<string, unknown> = {}) => state({ ...o });

describe('Version history while comparing', () => {
  test('Compare starts it: the selected row is A and Now is B', async () => {
    shellMode.view({ path: PATH, at: 'r41', title: A.title, when: A.when, who: A.who });
    await mount(<VersionHistoryHost {...base} onClose={() => {}} />);
    await click(q('[data-testid="vh-compare"]'));
    const s = compareStore.get();
    expect(s?.a).toMatchObject({ at: 'r41', title: 'Schváleno trenéry', who: 'Jonas' });
    expect(s?.b.at).toBe('now');
    expect(q('[data-testid="vh-mark-A"]')?.closest('[data-testid="vh-row-r41"]')).not.toBeNull();
    // P8 C3 (11 pn-compare): B on Now takes the dot's place — a child of the row, not text inside its button
    expect(q('[data-testid="vh-now"] > [data-testid="vh-mark-B"]')).not.toBeNull();
    expect(q('[data-testid="vh-compare"]')).toBeNull(); // already comparing
    expect(compareStore.get()?.rows.length).toBe(4); // the rows name a line’s maker
  });

  test('a second row becomes B (marks move); Now brings B back; the held version stays A', async () => {
    shellMode.view({ path: PATH, at: 'r41', title: A.title, when: A.when, who: A.who });
    await mount(<VersionHistoryHost {...base} onClose={() => {}} />);
    await click(q('[data-testid="vh-compare"]'));
    await click(q('[data-testid="vh-row-r42"]'));
    expect(compareStore.get()?.b).toMatchObject({ at: 'r42', who: 'You' });
    expect(shellMode.get().viewing?.at).toBe('r41'); // looking at A is unchanged
    expect(q('[data-testid="vh-row-r42"] [data-testid="vh-mark-B"]')).not.toBeNull();
    expect(q('[data-testid="vh-now"] [data-testid="vh-mark-B"]')).toBeNull();
    expect(qa('[data-testid="vh-mark-A"]').length).toBe(1);
    await click(q('[data-testid="vh-now-back"]'));
    expect(compareStore.get()?.b.at).toBe('now');
    expect(shellMode.get().viewing?.at).toBe('r41'); // Now is B, not "leave"
  });

  test('03 ai-history: your AI row keeps "Undo this chat" beside Restore while comparing', async () => {
    shellMode.view({ path: PATH, at: 'r43', title: 'Venkovní dres v zelené', when: '', who: 'AI' });
    await mount(<VersionHistoryHost {...base} onClose={() => {}} />);
    expect(q('[data-testid="vh-undo-chat"]')).not.toBeNull(); // before Compare: there
    await click(q('[data-testid="vh-compare"]'));
    const acts = q('[data-testid="vh-acts"]');
    const names = [...(acts?.querySelectorAll('button') ?? [])].map((b) =>
      b.getAttribute('data-testid')
    );
    // Stop comparing · (Restore only …) · Undo this chat · Restore this version — Undo sits just before Restore
    expect(names.at(-1)).toBe('vh-restore');
    expect(names.at(-2)).toBe('vh-undo-chat');
    expect(names[0]).toBe('vh-stop-compare');
  });

  test('Stop comparing goes back to looking at the version', async () => {
    shellMode.view({ path: PATH, at: 'r41', title: A.title, when: A.when, who: A.who });
    await mount(<VersionHistoryHost {...base} onClose={() => {}} />);
    await click(q('[data-testid="vh-compare"]'));
    await click(q('[data-testid="vh-stop-compare"]'));
    expect(compareStore.get()).toBeNull();
    expect(shellMode.get().viewing?.at).toBe('r41');
    expect(q('[data-testid="vh-compare"]')).not.toBeNull();
  });

  test('the selected row says what Restore takes back from others, and offers the two restores', async () => {
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        compare={comparing({ focus: 'front' })}
      />
    );
    expect(q('[data-testid="vh-why"]')?.textContent).toBe(
      'Restores the whole canvas as it was at A, as a new version — Tereza’s change to Helma z boku goes too. Now stays in the list.'
    );
    expect(qa('[data-testid="vh-acts"] button').map((b) => b.textContent)).toEqual([
      'Stop comparing',
      'Restore only Venkovní dres',
      'Restore this version',
    ]);
  });

  test('Restore only <artboard> restores that artboard alone, as a new version with Undo', async () => {
    let stopped = 0;
    let left = 0;
    let changed = 0;
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        compare={comparing({ focus: 'front' })}
        onStopCompare={() => stopped++}
        onLeaveViewing={() => left++}
        onChanged={() => changed++}
      />
    );
    await click(q('[data-testid="vh-restore-only"]'));
    const post = calls.find((c) => c.url === '/_api/project/restore');
    expect(post?.body).toEqual({ path: PATH, at: 'r41', artboard: 'front' });
    expect(toasts.at(-1)).toMatchObject({
      msg: 'Restored Venkovní dres to 17 Oct, 18:40',
      ok: true,
    });
    expect([stopped, left, changed]).toEqual([1, 1, 1]);
  });

  test('Restore this version restores the whole canvas, as the panel always did', async () => {
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        compare={comparing()}
      />
    );
    await click(q('[data-testid="vh-restore"]'));
    expect(calls.find((c) => c.url === '/_api/project/restore')?.body).toEqual({
      path: PATH,
      revision: 41,
    });
  });

  test('a refused artboard says why and changes nothing (the server’s line)', async () => {
    restore = {
      status: 409,
      body: {
        ok: false,
        reason: 'not-in-version',
        line: "Can't restore only Venkovní dres — restore the whole canvas instead.",
      },
    };
    let stopped = 0;
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        compare={comparing({ focus: 'front' })}
        onStopCompare={() => stopped++}
      />
    );
    await click(q('[data-testid="vh-restore-only"]'));
    expect(toasts.at(-1)).toMatchObject({
      msg: "Can't restore only Venkovní dres — restore the whole canvas instead.",
      ok: false,
    });
    expect(stopped).toBe(0); // still comparing: nothing happened
  });

  test('no Restore only for an artboard A does not hold or a generated family', async () => {
    const answer = {
      ...ready,
      changes: [
        { artboards: ['new'], grade: 'W1', kind: 'artboard-added', words: 'Artboard “New” added' },
      ],
      blame: {},
    };
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        compare={comparing({ answer, focus: 'new' })}
      />
    );
    expect(q('[data-testid="vh-restore-only"]')).toBeNull();
    expect(q('[data-testid="vh-restore"]')).not.toBeNull();
    await act(async () =>
      root.render(
        <VersionHistoryPanel
          {...base}
          viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
          compare={comparing({
            answer: {
              ...ready,
              changes: [{ artboards: ['disc-*'], kind: 'style', words: 'x' }],
              blame: {},
            },
          })}
        />
      )
    );
    expect(q('[data-testid="vh-restore-only"]')).toBeNull();
  });

  test('Can view compares and stops comparing — it never sees a restore', async () => {
    await mount(
      <VersionHistoryPanel
        {...base}
        canEdit={false}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        compare={comparing({ focus: 'front' })}
      />
    );
    expect(qa('[data-testid="vh-acts"] button').map((b) => b.textContent)).toEqual([
      'Stop comparing',
    ]);
    expect(q('[data-testid="vh-restore"]')).toBeNull();
    expect(q('[data-testid="vh-restore-only"]')).toBeNull();
    expect(q('[data-testid="vh-why"]')).not.toBeNull(); // the words are for everyone who can look
  });

  test('without a Compare in progress the panel is the S1.14 panel', async () => {
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        onCompare={() => {}}
      />
    );
    expect(q('[data-testid="vh-compare"]')?.textContent).toBe('Compare');
    expect(q('[data-testid="vh-why"]')).toBeNull();
    expect(qa('[data-testid^="vh-mark-"]').length).toBe(0);
  });
});

// The fold remembers open / closed per Mac: open it only when it is not already.
const openFold = async () => {
  if (!q('[data-testid="fold-history-body"]'))
    await click(q('[data-testid="fold-history-toggle"]'));
};

describe('Version history › Advanced', () => {
  test('Compare pictures opens the picture diff for the version being looked at', async () => {
    const opened: unknown[] = [];
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        onComparePictures={(t: unknown) => opened.push(t)}
        advanced={<p data-testid="git-body">today’s git body</p>}
      />
    );
    await openFold();
    expect(q('[data-testid="git-body"]')).not.toBeNull(); // nothing was taken away
    await click(q('[data-testid="vh-compare-pictures"]'));
    expect(opened).toEqual([{ file: PATH, beforeSha: 'r41' }]);
  });

  test('with no version in hand it compares against the last saved one', async () => {
    const opened: unknown[] = [];
    await mount(
      <VersionHistoryPanel
        {...base}
        onComparePictures={(t: unknown) => opened.push(t)}
        advanced={null}
      />
    );
    await openFold();
    await click(q('[data-testid="vh-compare-pictures"]'));
    expect(opened).toEqual([{ file: PATH, beforeSha: 'HEAD' }]);
  });
});

// P8 C7 (11 · pn-compare): the two frames get the chrome's theme (they started dark in a light window)
describe('the compare frames follow the theme', () => {
  test('both frames are told the theme on the ladder and again when it flips', async () => {
    const posted: Array<[number, unknown]> = [];
    const mk = (i: number) => ({
      contentWindow: { postMessage: (m: unknown) => posted.push([i, m]) },
    });
    const frames = { current: [mk(0), mk(1)] };
    function Probe() {
      useFrameTheme(frames as never, 'x');
      return null;
    }
    document.documentElement.dataset.theme = 'light';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(posted).toContainEqual([0, { dgn: 'theme', theme: 'light' }]);
    expect(posted).toContainEqual([1, { dgn: 'theme', theme: 'light' }]);
    posted.length = 0;
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(posted).toContainEqual([1, { dgn: 'theme', theme: 'dark' }]);
    await act(async () => root.unmount());
    host.remove();
  });
});
