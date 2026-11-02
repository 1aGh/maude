// P8 c7 (09 ex-progress / ex-states / ex-history) — named rows, a picture each, the header's folder button and
// the foot that says what survives a sleeping Mac. Same harness as exports-panel.test.tsx.

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

import { jobTitle, PANEL_FOOT, RUNNING_FOOT } from '../client/v2/export/exports-model.js';
import { ExportsPanel } from '../client/v2/export/exports-panel.jsx';

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'j1',
    format: 'png',
    scope: 'canvas-as-separate',
    status: 'running',
    createdAt: '2026-10-18T11:40:00',
    progress: { current: 16, total: 25 },
    ...over,
  };
}

function center(jobs: unknown[]) {
  return {
    jobs,
    panelOpen: true,
    selectedJobId: null,
    savingIds: new Set<string>(),
    closePanel: mock(() => {}),
    reveal: mock(async () => {}),
    download: mock(async () => {}),
    again: mock(async () => {}),
    retry: mock(async () => {}),
  };
}

function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    q: (sel: string) => host.querySelector(sel) as HTMLElement | null,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('a row is named from what it is made from', () => {
  test('canvas · format, folder · artboards, a video pair · 4K', () => {
    expect(
      jobTitle(
        job({
          format: 'pptx',
          spec: { v: 2, scope: 'canvas', canvas: 'ui/Uniformy-2027.tsx', format: 'pptx' },
        })
      )
    ).toBe('Uniformy-2027 · PowerPoint');
    const items = Array.from({ length: 115 }, (_, i) => ({
      id: `u${i}`,
      name: `B${i}`,
      status: 'ok',
    }));
    expect(
      jobTitle(
        job({
          format: 'png',
          items,
          spec: { v: 2, scope: 'folder', folder: 'ui/social', format: 'png' },
        })
      )
    ).toBe('social · 115 artboards');
    expect(
      jobTitle(
        job({
          format: 'mp4',
          spec: {
            v: 2,
            scope: 'selection',
            canvas: 'ui/Hype trailer.tsx',
            format: 'mp4',
            selection: { artboards: ['a', 'b'] },
            options: { size: { scale: 2 } },
          },
        })
      )
    ).toBe('Hype trailer · 2 videos · 4K');
  });
  test('a job without a spec keeps the format-and-scope words', () => {
    expect(jobTitle(job({ format: 'mp4' }))).toBe('MP4 · Canvas');
  });
  test('a finished row is still its file', () => {
    expect(jobTitle(job({ status: 'done', filename: 'LetakA6 — FLAG.pdf' }))).toBe(
      'LetakA6 — FLAG.pdf'
    );
  });
});

describe('the panel', () => {
  test('every row carries a picture tile: the canvas cover, else the export glyph', () => {
    const jobs = [
      job({ id: 'a', spec: { v: 2, scope: 'canvas', canvas: 'ui/A.tsx', format: 'png' } }),
      job({ id: 'b' }),
    ];
    const m = mount(
      createElement(ExportsPanel, {
        center: center(jobs),
        native: true,
        coverOf: (rel: string) => (rel === 'ui/A.tsx' ? '/_api/thumb/abc' : null),
      })
    );
    expect(m.q('[data-testid="export-job-thumb-a"] img')?.getAttribute('src')).toBe(
      '/_api/thumb/abc'
    );
    expect(m.q('[data-testid="export-job-thumb-b"]')).not.toBeNull();
    expect(m.q('[data-testid="export-job-thumb-b"] img')).toBeNull();
    m.unmount();
  });

  test('the header has a folder button on the Mac app: it shows the newest finished file', () => {
    const jobs = [
      job({ id: 'old', status: 'done', filename: 'Old.png', finishedAt: '2026-10-18T10:00:00' }),
      job({ id: 'new', status: 'done', filename: 'New.png', finishedAt: '2026-10-18T11:00:00' }),
    ];
    const c = center(jobs);
    const m = mount(createElement(ExportsPanel, { center: c, native: true, coverOf: () => null }));
    const btn = m.q('[data-testid="exports-panel-folder"]');
    expect(btn?.getAttribute('aria-label')).toBe('Open the Downloads folder');
    act(() => btn?.click());
    expect(c.reveal).toHaveBeenCalledTimes(1);
    expect((c.reveal.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 'new' });
    m.unmount();
    const b = mount(
      createElement(ExportsPanel, { center: center(jobs), native: false, coverOf: () => null })
    );
    expect(b.q('[data-testid="exports-panel-folder"]')).toBeNull();
    b.unmount();
  });

  test('the foot says what survives a sleeping Mac while something runs, else where to find exports', () => {
    const running = mount(
      createElement(ExportsPanel, {
        center: center([job({ id: 'r' })]),
        native: true,
        coverOf: () => null,
      })
    );
    expect(running.q('.ex-panel-foot')?.textContent).toBe(RUNNING_FOOT);
    running.unmount();
    const idle = mount(
      createElement(ExportsPanel, {
        center: center([job({ id: 'd', status: 'done', filename: 'A.png' })]),
        native: true,
        coverOf: () => null,
      })
    );
    expect(idle.q('.ex-panel-foot')?.textContent).toBe(PANEL_FOOT);
    expect(PANEL_FOOT).toBe('The last 20 exports stay here. Also in Search: “Exports”.');
    idle.unmount();
  });
});
