// S1.14 — Version history, drawn (11 · pn-history, 05 · es-panels-canvas): the rows the server derived, grouped
// Today / Yesterday / 4 Oct, each with its picture (a skeleton until it lands), its face or the spark and its
// chip; the Now row and "Name this version…"; a click looks at a version (the shell's Viewing hold); Restore
// is a new version with a toast and Undo; Can view looks and never restores; a failed read is "Retry versions".
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
import { VersionHistoryHost, ViewBarHost } from '../client/v2/history/history-host.jsx';
import { VersionHistoryPanel } from '../client/v2/history/history-panel.jsx';
import { checkName } from '../client/v2/history/name-dialog.jsx';
import {
  dayGroups,
  groupLabel,
  mergeFresh,
  restoreLine,
  viewingWords,
  wantsPictures,
} from '../client/v2/history/use-versions.js';
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
    sub: '14:32 · Venkovní dres · přední',
    who: { kind: 'ai', actor: 'ai:you', name: 'AI', you: true },
    kind: 'ai',
    chips: ['Made by AI'],
    madeAt: at(18, 14, 32),
    picture: { status: 'ready', key: 'k43', url: '/_api/thumb/k43', w: 160, h: 100 },
  }),
  row({ ref: 'r42', madeAt: at(18, 14, 5), picture: { status: 'pending', key: 'k42' } }),
  row({
    ref: 'r41',
    title: 'Schváleno trenéry',
    sub: '18:40 · Jonas',
    who: { kind: 'person', actor: 'jonas', name: 'Jonas', you: false },
    named: { name: 'Schváleno trenéry', by: 'jonas', at: at(17, 18, 40) },
    chips: ['Named'],
    madeAt: at(17, 18, 40),
  }),
  row({
    ref: 'r30',
    title: 'První návrh dresů',
    sub: '16:15 · from Tereza’s ask',
    who: { kind: 'ai', actor: 'ai:tereza', name: 'AI', you: false },
    kind: 'ai',
    chips: ['Made by AI'],
    madeAt: at(4, 16, 15),
  }),
];

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let answers: {
  rows: unknown[];
  now: Record<string, unknown>;
  fail: boolean;
  restore: { status: number; body: unknown };
  name: { status: number; body: unknown };
} = {
  rows: ROWS,
  now: { canvas: 'ui/Uniformy-2027.tsx', ref: 'r43', status: 'Saved', canName: true },
  fail: false,
  restore: {
    status: 200,
    body: { ok: true, actionId: 'a_restore', line: 'Restored “Schváleno trenéry”' },
  },
  name: { status: 200, body: { ok: true, actionId: 'a_name' } },
};
const reset = () => {
  calls = [];
  answers = {
    rows: ROWS,
    now: { canvas: 'ui/Uniformy-2027.tsx', ref: 'r43', status: 'Saved', canName: true },
    fail: false,
    restore: {
      status: 200,
      body: { ok: true, actionId: 'a_restore', line: 'Restored “Schváleno trenéry”' },
    },
    name: { status: 200, body: { ok: true, actionId: 'a_name' } },
  };
};
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body });
  if (url.startsWith('/_api/project/versions')) {
    if (answers.fail) return j(503, { ok: false, reason: 'unreachable' });
    const q = new URL(url, 'http://x').searchParams;
    const rows =
      q.get('filter') === 'named'
        ? answers.rows.filter((r) => (r as { named?: unknown }).named)
        : answers.rows;
    return j(200, { ok: true, source: 'accepted', rows, now: answers.now });
  }
  if (url === '/_api/project/restore') return j(answers.restore.status, answers.restore.body);
  if (url === '/_api/project/name') return j(answers.name.status, answers.name.body);
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
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  shellMode.leaveViewing();
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
const toasts: Array<{
  msg: string;
  ok: boolean;
  action?: { label: string; onClick: () => unknown };
}> = [];
const toast = (msg: string, ok: boolean, action?: { label: string; onClick: () => unknown }) =>
  toasts.push({ msg, ok, action });
const base = {
  path: PATH,
  canvasLabel: 'Uniformy-2027',
  canEdit: true,
  fetchImpl,
  toast,
  nowMs: NOW,
};

describe('the rows', () => {
  test('grouped Today / Yesterday / 4 Oct; picture, face or spark, chips; the Now row', async () => {
    await mount(<VersionHistoryPanel {...base} />);
    const groups = [...document.querySelectorAll('.vh-gt')].map((n) => n.textContent);
    expect(groups).toEqual(['Today', 'Yesterday', '4 Oct']);
    expect(document.querySelectorAll('.vh-row').length).toBe(4);
    expect(q('[data-testid="vh-row-r43"] strong')?.textContent).toBe('Venkovní dres v zelené');
    expect(q('[data-testid="vh-row-r43"] .vh-ai')).not.toBeNull(); // the spark, not a face
    expect(q('[data-testid="vh-row-r43"] .chip--spark')?.textContent).toBe('Made by AI');
    expect(q('[data-testid="vh-row-r41"] .vh-face')?.textContent).toBe('JO');
    expect(q('[data-testid="vh-row-r41"] .chip')?.textContent).toBe('Named');
    expect(q('[data-testid="vh-row-r43"] img')?.getAttribute('src')).toBe('/_api/thumb/k43');
    expect(q('[data-testid="vh-row-r42"] .vh-pic')?.getAttribute('data-state')).toBe('pending'); // skeleton
    expect(q('[data-testid="vh-now-status"]')?.textContent).toBe('Uniformy-2027 · Saved');
    expect(q('[data-testid="vh-name"]')?.textContent).toBe('Name this version…');
    expect(calls[0]?.url).toContain('/_api/project/versions?path=.design%2Fui%2FUniformy-2027.tsx');
  });

  test('before the first change: the Now row and "Versions appear here as you work."', async () => {
    answers.rows = [];
    await mount(<VersionHistoryPanel {...base} />);
    expect(q('[data-testid="vh-empty"] strong')?.textContent).toBe(
      'Versions appear here as you work.'
    );
    expect(q('[data-testid="vh-empty"]')?.textContent).toContain("There's nothing to save.");
    expect(q('[data-testid="vh-now"]')).not.toBeNull();
  });

  test('a filter asks the server; Named with nothing says so', async () => {
    await mount(<VersionHistoryPanel {...base} />);
    await click(q('[data-testid="vh-filter-named"]'));
    expect(calls.at(-1)?.url).toContain('filter=named');
    expect(document.querySelectorAll('.vh-row').length).toBe(1);
    answers.rows = [];
    await click(q('[data-testid="vh-filter-ai"]'));
    expect(q('[data-testid="vh-empty"] strong')?.textContent).toBe('Nothing made by AI yet.');
  });

  test('a failed read is "Couldn’t load versions" and one button, pressed by hand', async () => {
    answers.fail = true;
    await mount(<VersionHistoryPanel {...base} />);
    expect(q('[data-testid="vh-failed"]')?.textContent).toContain("Couldn't load versions");
    const before = calls.length;
    await flush();
    expect(calls.length).toBe(before); // never automatic (C20)
    answers.fail = false;
    await click(q('[data-testid="vh-retry"]'));
    expect(q('[data-testid="vh-failed"]')).toBeNull();
    expect(document.querySelectorAll('.vh-row').length).toBe(4);
  });
});

describe('looking, restoring, naming', () => {
  test('a click looks at that version: words for the Viewing hold; the selected row offers Restore', async () => {
    const seen: unknown[] = [];
    await mount(
      <VersionHistoryPanel {...base} onView={(w: unknown) => seen.push(w)} viewing={null} />
    );
    await click(q('[data-testid="vh-row-r41"]'));
    expect(seen).toEqual([
      {
        path: PATH,
        at: 'r41',
        title: 'Schváleno trenéry',
        when: '17 Oct, 18:40',
        who: 'Jonas',
      },
    ]);
    // the parent holds the version → the row is current and carries the actions
    await act(async () =>
      root.render(
        <VersionHistoryPanel
          {...base}
          viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        />
      )
    );
    expect(q('[data-testid="vh-row-r41"]')?.getAttribute('aria-current')).toBe('true');
    expect(q('[data-testid="vh-restore"]')?.textContent).toBe('Restore this version');
    expect(q('[data-testid="vh-compare"]')).toBeNull(); // S1.15's, until it passes onCompare
  });

  test('Can view looks and never restores or names', async () => {
    await mount(
      <VersionHistoryPanel
        {...base}
        canEdit={false}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
      />
    );
    expect(q('[data-testid="vh-row-r41"]')).not.toBeNull();
    expect(q('[data-testid="vh-restore"]')).toBeNull();
    expect(q('[data-testid="vh-name"]')).toBeNull();
  });

  test('Restore posts the version, leaves Viewing and toasts the line with Undo; Undo posts the action', async () => {
    toasts.length = 0;
    let left = 0;
    let changed = 0;
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        onLeaveViewing={() => left++}
        onChanged={() => changed++}
      />
    );
    await click(q('[data-testid="vh-restore"]'));
    const post = calls.find((c) => c.url === '/_api/project/restore');
    expect(post?.body).toEqual({ path: PATH, at: 'r41' });
    expect(left).toBe(1);
    expect(changed).toBe(1);
    expect(toasts.at(-1)).toMatchObject({ msg: 'Restored “Schváleno trenéry”', ok: true });
    expect(toasts.at(-1)?.action?.label).toBe('Undo');
    await act(async () => {
      await toasts.at(-1)?.action?.onClick();
    });
    expect(calls.find((c) => c.url === '/_api/project/undo')?.body).toEqual({
      actionId: 'a_restore',
    });
    expect(toasts.at(-1)?.msg).toBe('Restore undone.');
  });

  test('a restore the team server did not take says so, with Retry restore', async () => {
    toasts.length = 0;
    answers.restore = { status: 503, body: { ok: false, reason: 'unreachable' } };
    let left = 0;
    await mount(
      <VersionHistoryPanel
        {...base}
        viewing={{ path: PATH, at: 'r41', title: '', when: '', who: '' }}
        onLeaveViewing={() => left++}
      />
    );
    await click(q('[data-testid="vh-restore"]'));
    expect(left).toBe(0); // still looking: nothing changed
    expect(toasts.at(-1)).toMatchObject({
      msg: "The team server didn't take the restore.",
      ok: false,
    });
    expect(toasts.at(-1)?.action?.label).toBe('Retry restore');
  });

  test('Name this version: the newest version gets the name; a bad name is said under the field', async () => {
    await mount(<VersionHistoryPanel {...base} />);
    await click(q('[data-testid="vh-name"]'));
    const input = q('[data-testid="vh-name-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect((q('[data-testid="vh-name-save"]') as HTMLButtonElement).disabled).toBe(true); // empty
    // happy-dom does not route a native `input` event into React's onChange: call the prop (the house way)
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[
      propsKey
    ];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        '  Final dresy '
      );
      props.onChange({ target: input, currentTarget: input });
    });
    answers.name = { status: 409, body: { ok: false, reason: 'hub-too-old' } };
    await click(q('[data-testid="vh-name-save"]'));
    expect(calls.find((c) => c.url === '/_api/project/name')?.body).toEqual({
      path: PATH,
      at: 'r43',
      name: 'Final dresy',
    });
    expect(q('[data-testid="vh-name-error"]')?.textContent).toBe(
      'Naming versions needs the team server to be updated.'
    );
    answers.name = { status: 200, body: { ok: true, actionId: 'a_name' } };
    await click(q('[data-testid="vh-name-save"]'));
    expect(q('[data-testid="vh-name-dialog"]')).toBeNull();
  });

  test('"Saving…" while the canvas has unsent changes: nothing to name yet', async () => {
    answers.now = { ...answers.now, status: 'Saving…' };
    await mount(<VersionHistoryPanel {...base} />);
    const btn = q('[data-testid="vh-name"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Saving…');
    expect(btn.disabled).toBe(true);
  });
});

describe('the host: Viewing is the mode store’s hold, esc returns', () => {
  test('a row click holds viewing{at}; the bar reads it; esc and the Restore button release it', async () => {
    await mount(
      <>
        <ViewBarHost activePath={PATH} />
        <VersionHistoryHost {...base} />
      </>
    );
    expect(q('[data-testid="vh-viewbar"]')).toBeNull();
    await click(q('[data-testid="vh-row-r41"]'));
    expect(shellMode.get().viewing).toMatchObject({ path: PATH, at: 'r41', who: 'Jonas' });
    expect(q('[data-testid="vh-viewbar-text"]')?.textContent).toBe(
      'Viewing “Schváleno trenéry” · 17 Oct, 18:40 · Jonas'
    );
    expect(q('[data-testid="vh-viewbar-back"]')?.textContent).toContain('back to now');
    // esc, heard by the shell
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(shellMode.get().viewing).toBeNull();
    expect(q('[data-testid="vh-viewbar"]')).toBeNull();
    // looking again, then Restore leaves the hold too
    await click(q('[data-testid="vh-row-r41"]'));
    await click(q('[data-testid="vh-restore"]'));
    expect(shellMode.get().viewing).toBeNull();
  });

  test('another canvas in front ends the hold', async () => {
    await mount(<ViewBarHost activePath={PATH} />);
    shellMode.view({ path: PATH, at: 'r41', title: 'x', when: 'y', who: 'z' });
    await act(async () => root.render(<ViewBarHost activePath=".design/ui/Other.tsx" />));
    expect(shellMode.get().viewing).toBeNull();
  });

  test('esc does not steal from an open dialog or a text field', async () => {
    await mount(<ViewBarHost activePath={PATH} />);
    shellMode.view({ path: PATH, at: 'r41', title: 'x', when: 'y', who: 'z' });
    await flush();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(shellMode.get().viewing).not.toBeNull();
    field.remove();
  });
});

describe('the pure helpers', () => {
  test('groupLabel / dayGroups: Today · Yesterday · 4 Oct · 4 Oct 2025', () => {
    expect(groupLabel(at(18, 0, 5), NOW)).toBe('Today');
    expect(groupLabel(at(17, 23, 59), NOW)).toBe('Yesterday');
    expect(groupLabel(at(4, 16, 15), NOW)).toBe('4 Oct');
    expect(groupLabel(new Date(2025, 9, 4, 16, 15).getTime(), NOW)).toBe('4 Oct 2025');
    expect(groupLabel(NOW + 3_600_000 * 30, NOW)).toBe('Today'); // a skewed clock
    expect(dayGroups(ROWS as never, NOW).map((g) => [g.group, g.rows.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['4 Oct', 1],
    ]);
  });
  test('mergeFresh keeps older pages loaded; wantsPictures sees a pending one', () => {
    const fresh = [ROWS[0], ROWS[1]] as never[];
    expect(mergeFresh(ROWS as never, fresh).map((r: { ref: string }) => r.ref)).toEqual([
      'r43',
      'r42',
      'r41',
      'r30',
    ]);
    expect(mergeFresh([], fresh)).toBe(fresh);
    expect(wantsPictures(ROWS as never)).toBe(true);
    expect(wantsPictures([ROWS[0]] as never)).toBe(false);
  });
  test('restoreLine / viewingWords / checkName', () => {
    expect(restoreLine(ROWS[2] as never, null)).toBe('Restored “Schváleno trenéry”');
    expect(restoreLine(ROWS[1] as never, null)).toBe('Restored 18 Oct, 14:05');
    expect(restoreLine(ROWS[1] as never, { line: 'Went back to 14:05' })).toBe(
      'Went back to 14:05'
    );
    expect(viewingWords(ROWS[0] as never).who).toBe('AI');
    expect(checkName('  ').ok).toBe(false);
    expect(checkName('x'.repeat(81))).toMatchObject({ ok: false });
    expect(checkName(' ok ')).toEqual({ ok: true, name: 'ok' });
    expect(checkName('a\u0007b').ok).toBe(false);
  });
});
