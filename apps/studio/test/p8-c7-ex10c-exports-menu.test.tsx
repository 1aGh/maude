// P8 c7 (09 ex-history) — a finished row has a hover "More" that opens the row menu: Show in Finder · Export
// again · Export again with other settings… · Copy file names · Remove from list. Same harness as
// p8-c7-ex10b-exports-panel.test.tsx.

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

import { jobFileNames, jobMenuItems } from '../client/v2/export/exports-model.js';
import { JobRow } from '../client/v2/export/job-row.jsx';

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'j9',
    format: 'png',
    scope: 'canvas-as-separate',
    status: 'done',
    createdAt: '2026-10-18T11:40:00',
    filename: 'Hype trailer.zip',
    spec: { v: 2, scope: 'canvas', canvas: 'ui/Hype.tsx', format: 'png' },
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
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('the row menu (model)', () => {
  test('a finished export with a file: folder, again, again with other settings, then copy names and remove', () => {
    const ids = (items: { id: string }[]) => items.map((i) => i.id);
    expect(ids(jobMenuItems(job(), { native: true }))).toEqual([
      'reveal',
      'again',
      'again-with',
      'sep',
      'copy-names',
      'remove',
    ]);
    // a browser tab downloads instead of opening a Finder folder
    const web = jobMenuItems(job(), { native: false });
    expect(web[0]?.label).toBe('Download');
    // nothing on disk to show or name → neither row; a v1 job (no spec) cannot be opened with other settings
    const bare = jobMenuItems(job({ filename: null, spec: undefined }), { native: true });
    expect(ids(bare)).toEqual(['again', 'again-with', 'sep', 'remove']);
    expect(bare.find((i) => i.id === 'again-with')?.disabled).toBe(true);
    // a running export has no menu at all
    expect(jobMenuItems(job({ status: 'running' }), { native: true })).toEqual([]);
  });

  test('file names: a group job lists the files its items wrote, else the one file', () => {
    expect(jobFileNames(job())).toEqual(['Hype trailer.zip']);
    expect(
      jobFileNames(
        job({
          items: [
            { id: 'a', name: 'A', status: 'ok', files: ['A.png', 'A@2x.png'] },
            { id: 'b', name: 'B', status: 'failed' },
          ],
        })
      )
    ).toEqual(['A.png', 'A@2x.png']);
    expect(jobFileNames(job({ filename: null }))).toEqual([]);
  });
});

describe('the row menu (render)', () => {
  test('More opens the menu; each pick runs its handler and closes it; Escape closes it', () => {
    const on = {
      reveal: mock(() => {}),
      download: mock(() => {}),
      again: mock(() => {}),
      retry: mock(() => {}),
      againWith: mock(() => {}),
      copyNames: mock(() => {}),
      remove: mock(() => {}),
    };
    const m = mount(createElement(JobRow, { job: job(), native: true, on }));
    expect(m.q('[data-testid="export-job-menu-j9"]')).toBeNull();
    const more = m.q('[data-testid="export-job-more-j9"]') as HTMLButtonElement;
    expect(more).not.toBeNull();
    expect(more.getAttribute('aria-label')).toBe('More');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    act(() => more.click());
    const menu = m.q('[data-testid="export-job-menu-j9"]');
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const labels = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(
      (b) => b.textContent
    );
    expect(labels).toEqual([
      'Show in Finder',
      'Export again',
      'Export again with other settings…',
      'Copy file names',
      'Remove from list',
    ]);
    act(() => (m.q('[data-testid="export-job-menu-again-j9"]') as HTMLElement).click());
    expect(on.again).toHaveBeenCalledTimes(1);
    expect(m.q('[data-testid="export-job-menu-j9"]')).toBeNull();

    act(() => more.click());
    act(() => (m.q('[data-testid="export-job-menu-again-with-j9"]') as HTMLElement).click());
    expect(on.againWith).toHaveBeenCalledTimes(1);
    act(() => more.click());
    act(() => (m.q('[data-testid="export-job-menu-copy-names-j9"]') as HTMLElement).click());
    expect(on.copyNames).toHaveBeenCalledTimes(1);
    act(() => more.click());
    act(() => (m.q('[data-testid="export-job-menu-remove-j9"]') as HTMLElement).click());
    expect(on.remove).toHaveBeenCalledTimes(1);

    act(() => more.click());
    expect(m.q('[data-testid="export-job-menu-j9"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(m.q('[data-testid="export-job-menu-j9"]')).toBeNull();
    m.unmount();
  });

  test('a running row has no More', () => {
    const m = mount(
      createElement(JobRow, {
        job: job({ status: 'running', progress: { current: 1, total: 4 } }),
        native: true,
        on: {},
      })
    );
    expect(m.q('[data-testid="export-job-more-j9"]')).toBeNull();
    m.unmount();
  });
});
