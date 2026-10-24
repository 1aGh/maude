// S8.4 — the Exports panel, its rows and the done toast (09 Export ex-progress / ex-states / ex-history).
//
// The panel lists the last 20, every row says where it runs; a finished one opens its folder (Show in
// Finder on the Mac app, Download in a browser) or exports again; a partial reads "Exported 114 of 115"
// and Retry <name> runs just that item; an empty panel is the S11 kit's block; the toast carries ONE
// action. happy-dom + a real createRoot, like export-center.test.tsx.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { DoneToast } from '../client/v2/export/done-toast.jsx';
import {
  jobMeta,
  panelGroups,
  retryLabel,
  rowState,
  toastWords,
} from '../client/v2/export/exports-model.js';
import { ExportsPanel } from '../client/v2/export/exports-panel.jsx';
import { exportsRing } from '../client/v2/shell/save-status.js';

const NOW = Date.parse('2026-10-18T12:00:00');

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'j1',
    format: 'png',
    scope: 'canvas-as-separate',
    status: 'done',
    createdAt: '2026-10-18T11:40:00',
    finishedAt: '2026-10-18T11:41:00',
    filename: 'Hero.png',
    ...over,
  };
}

/** 115 artboards, 114 of them made it — the social export of the canvas. */
function partial(over: Record<string, unknown> = {}) {
  const items = Array.from({ length: 115 }, (_, i) => ({
    id: `u${i}`,
    name: i === 114 ? 'Recap' : `Board ${i}`,
    status: i === 114 ? 'failed' : 'ok',
    ...(i === 114 ? { reason: 'the music has not synced yet' } : {}),
  }));
  return job({
    id: 'social',
    format: 'mp4',
    filename: 'Combine-kampan 2026-10-18.zip',
    retryable: true,
    items,
    ...over,
  });
}

function center(jobs: unknown[], over: Record<string, unknown> = {}) {
  return {
    jobs,
    panelOpen: true,
    selectedJobId: null,
    savingIds: new Set<string>(),
    savedPaths: new Map<string, string>(),
    closePanel: mock(() => {}),
    openPanel: mock(() => {}),
    dismissToast: mock(() => {}),
    reveal: mock(async () => {}),
    download: mock(async () => {}),
    again: mock(async () => {}),
    retry: mock(async () => {}),
    toastJobs: [] as unknown[],
    ...over,
  };
}

function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    q: (sel: string) => host.querySelector(sel) as HTMLElement | null,
    qa: (sel: string) => Array.from(host.querySelectorAll(sel)) as HTMLElement[],
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const click = (el: HTMLElement | null) => act(() => el?.click());

describe('the panel lists the last 20, each saying where it runs', () => {
  test('25 exports show 20 rows, newest first', () => {
    const jobs = Array.from({ length: 25 }, (_, i) =>
      job({ id: `j${i}`, createdAt: `2026-10-18T10:${String(i).padStart(2, '0')}:00` })
    );
    const m = mount(createElement(ExportsPanel, { center: center(jobs), native: true }));
    const rows = m.qa('[data-testid^="export-job-j"][data-state]');
    expect(rows).toHaveLength(20);
    expect(rows[0]?.getAttribute('data-testid')).toBe('export-job-j24');
    m.unmount();
  });

  test('a cloud row says so, a Mac row says so', () => {
    const jobs = [
      job({ id: 'c', runsOn: 'cloud', status: 'running', progress: { current: 16, total: 25 } }),
      job({ id: 'm', runsOn: 'this-mac', status: 'queued' }),
      job({ id: 'd', runsOn: 'cloud' }),
    ];
    const m = mount(createElement(ExportsPanel, { center: center(jobs), native: true }));
    expect(m.q('[data-testid="export-job-meta-c"]')?.textContent).toContain('In the cloud');
    expect(m.q('[data-testid="export-job-meta-c"]')?.textContent).toContain('64 %');
    expect(m.q('[data-testid="export-job-meta-m"]')?.textContent).toContain('On this Mac');
    expect(m.q('[data-testid="export-job-meta-d"]')?.textContent).toContain('In the cloud');
    expect(m.q('[data-testid="export-job-c"]')?.getAttribute('data-where')).toBe('cloud');
    m.unmount();
  });

  test('a job that does not say ran on this Mac', () => {
    expect(jobMeta(job({ status: 'queued' }), { now: NOW })).toBe('On this Mac · Queued');
  });

  test('rows group Today · Yesterday', () => {
    const groups = panelGroups(
      [
        job({ id: 'a' }),
        job({ id: 'b', createdAt: '2026-10-17T09:00:00', finishedAt: '2026-10-17T09:01:00' }),
      ],
      NOW
    );
    expect(groups.map((g: { label: string }) => g.label)).toEqual(['Today', 'Yesterday']);
  });
});

describe('the ring shows while anything runs', () => {
  test('busy while a job runs or waits, gone when everything is Ready', () => {
    const running = [
      job({ status: 'running', progress: { current: 1, total: 4 } }),
      job({ id: 'x' }),
    ];
    expect(exportsRing(running).busy).toBe(1);
    expect(exportsRing(running).ring).toBe(25);
    expect(exportsRing([job()]).ring).toBeUndefined();
  });
});

describe('every finished row opens its folder or exports again', () => {
  test('the Mac app shows in Finder; a browser tab downloads', () => {
    const c = center([job({ id: 'a' })]);
    const mac = mount(createElement(ExportsPanel, { center: c, native: true }));
    expect(mac.q('[data-testid="export-job-reveal-a"]')?.getAttribute('aria-label')).toBe(
      'Show in Finder'
    );
    click(mac.q('[data-testid="export-job-reveal-a"]'));
    expect(c.reveal).toHaveBeenCalledTimes(1);
    expect(c.download).not.toHaveBeenCalled();
    mac.unmount();

    const web = mount(createElement(ExportsPanel, { center: c, native: false }));
    expect(web.q('[data-testid="export-job-reveal-a"]')?.getAttribute('aria-label')).toBe(
      'Download'
    );
    click(web.q('[data-testid="export-job-reveal-a"]'));
    expect(c.download).toHaveBeenCalledTimes(1);
    web.unmount();
  });

  test('Export again is on every finished row, and only on those', () => {
    const c = center([
      job({ id: 'ok' }),
      job({ id: 'bad', status: 'failed', filename: undefined, error: 'boom' }),
      job({ id: 'busy', status: 'running' }),
    ]);
    const m = mount(createElement(ExportsPanel, { center: c, native: true }));
    expect(m.q('[data-testid="export-job-again-ok"]')).not.toBeNull();
    expect(m.q('[data-testid="export-job-again-bad"]')).not.toBeNull();
    expect(m.q('[data-testid="export-job-again-busy"]')).toBeNull();
    click(m.q('[data-testid="export-job-again-ok"]'));
    expect(c.again).toHaveBeenCalledTimes(1);
    expect((c.again.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 'ok' });
    m.unmount();
  });

  test('a failed row keeps its error behind a fold, whole', () => {
    const error = `${'long/path/'.repeat(500)}\nFULL TRACE TAIL`;
    const m = mount(
      createElement(ExportsPanel, {
        center: center([job({ id: 'f', status: 'failed', filename: undefined, error })]),
        native: true,
      })
    );
    const details = m.q('[data-testid="export-job-f"] details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('pre')?.textContent).toBe(error);
    m.unmount();
  });
});

describe('a partly done export says how many made it, and Retry runs only that one', () => {
  test('"Exported 114 of 115", and the button is Retry Recap', () => {
    const j = partial();
    expect(rowState(j)).toBe('warn');
    expect(retryLabel(j)).toBe('Retry Recap');
    const c = center([j]);
    const m = mount(createElement(ExportsPanel, { center: c, native: true }));
    expect(m.q('[data-testid="export-job-meta-social"]')?.textContent).toContain(
      'Exported 114 of 115'
    );
    expect(m.q('[data-testid="export-job-social"]')?.textContent).toContain('114 of 115');
    const retry = m.q('[data-testid="export-job-retry-social"]');
    expect(retry?.textContent).toBe('Retry Recap');
    click(retry);
    expect(c.retry).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  test('the whole job is Ready once every item made it (no Retry)', () => {
    const j = partial({ retryable: false, items: [{ id: 'u1', name: 'Recap', status: 'ok' }] });
    expect(retryLabel(j)).toBeNull();
    expect(rowState(j)).toBe('done');
  });

  test('after a restart nothing can be retried, so no button is offered', () => {
    expect(retryLabel(partial({ retryable: undefined }))).toBeNull();
  });
});

describe('Exports empty uses the S11 kit', () => {
  test('the kit block, its words, one door', () => {
    const m = mount(createElement(ExportsPanel, { center: center([]), native: true }));
    const empty = m.q('[data-copy="es-panels-make.exports-none"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No exports yet.');
    expect(empty?.querySelectorAll('button')).toHaveLength(1);
    expect(m.q('.ex-panel-foot')).toBeNull();
    m.unmount();
  });

  // P8 C5 (05 es-panels-make): the line names the project — the shell hands the panel its name
  test('"Every export of Studio site lands here" — the project by name, not "this project"', () => {
    const named = mount(
      createElement(ExportsPanel, { center: center([]), native: true, projectName: 'Studio site' })
    );
    expect(named.q('[data-copy="es-panels-make.exports-none"]')?.textContent).toContain(
      'Every export of Studio site lands here'
    );
    named.unmount();
    const bare = mount(createElement(ExportsPanel, { center: center([]), native: true }));
    expect(bare.q('[data-copy="es-panels-make.exports-none"]')?.textContent).toContain(
      'Every export of this project lands here'
    );
    bare.unmount();
  });
});

describe('the done toast carries ONE action', () => {
  const FOUR = [
    ['done', job({ id: 'd' }), 'reveal', 'Show in Finder'],
    ['partly done', partial(), 'retry', 'Retry Recap'],
    [
      'ready with a problem',
      job({ id: 'p', degraded: { audioDropped: true, reason: 'x' } }),
      'reveal',
      'Show in Finder',
    ],
    ['failed', job({ id: 'x', status: 'failed', error: 'boom' }), 'open', 'Show details'],
  ] as const;

  for (const [name, j, action, label] of FOUR) {
    test(`${name}: one button, ${label}`, () => {
      const said: Array<{ content: ReactNode; description: string }> = [];
      const c = center([j], { toastJobs: [j] });
      const m = mount(
        createElement(DoneToast, {
          center: c,
          native: true,
          say: (n: { content: ReactNode; description: string }) => said.push(n),
        })
      );
      const last = said[said.length - 1];
      expect(last).toBeDefined();
      const body = mount(createElement('div', null, last?.content));
      const buttons = body.qa('.st-toast-actions button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.textContent).toBe(label);
      expect(buttons[0]?.getAttribute('data-action')).toBe(action);
      body.unmount();
      m.unmount();
    });
  }

  test('a partial toast reads "Exported 114 of 115" and names Recap', () => {
    const w = toastWords(partial(), { native: true });
    expect(w.title).toBe('Exported 114 of 115');
    expect(w.text).toContain('Recap');
    expect(w.action).toBe('retry');
  });

  test('a browser tab downloads where the Mac app shows in Finder', () => {
    expect(toastWords(job(), { native: false }).action).toBe('download');
    expect(toastWords(job(), { native: true }).action).toBe('reveal');
  });
});
