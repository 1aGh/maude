// export-center — feature-background-export-notification-center.
//
// useExportCenter relies on effects (initial fetch + a status-transition
// watcher), so — like canvas-hmr-runtime.test.tsx — this needs a live DOM
// with real effect flushing, not renderToStaticMarkup. Registers happy-dom
// for this file only and drives a real createRoot.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ExportPanel, useExportCenter } from '../client/export-center.jsx';

function mount(el: HTMLElement) {
  let root!: Root;
  act(() => {
    root = createRoot(el);
  });
  return root;
}

function job(overrides: Record<string, unknown>) {
  return {
    id: 'j1',
    format: 'png',
    scope: 'artboard',
    status: 'queued',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useExportCenter', () => {
  let originalFetch: typeof fetch;
  let originalHasFocus: typeof document.hasFocus;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalHasFocus = document.hasFocus;
    // The hook's initial-hydration GET must never throw synchronously in this
    // no-server test environment; individual tests override this further.
    fetchMock = mock(async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.hasFocus = originalHasFocus;
  });

  test('upserts a queued→running→done sequence and derives runningCount/queuedCount', () => {
    document.hasFocus = () => false; // keep the focus-gated auto-download inert here
    const host = document.createElement('div');
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter();
      return null;
    }
    act(() => {
      root.render(createElement(Probe));
    });

    act(() => {
      center.upsert(job({ status: 'queued' }));
    });
    expect(center.queuedCount).toBe(1);
    expect(center.runningCount).toBe(0);
    expect(center.jobs.map((j) => j.id)).toEqual(['j1']);

    act(() => {
      center.upsert(job({ status: 'running', progress: { current: 2, total: 5 } }));
    });
    expect(center.queuedCount).toBe(0);
    expect(center.runningCount).toBe(1);
    expect(center.busyCount).toBe(1);
    expect(center.jobs[0].progress).toEqual({ current: 2, total: 5 });

    act(() => {
      center.upsert(job({ status: 'done', filename: 'export.png' }));
    });
    expect(center.runningCount).toBe(0);
    expect(center.busyCount).toBe(0);
    // A done/failed TRANSITION queues a toast.
    expect(center.showToast).toBe(true);
    expect(center.toastJob?.id).toBe('j1');

    act(() => root.unmount());
  });

  test('a later upsert of an already-finished job does not re-queue the toast', () => {
    document.hasFocus = () => false;
    const host = document.createElement('div');
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter();
      return null;
    }
    act(() => {
      root.render(createElement(Probe));
    });

    act(() => {
      center.upsert(job({ status: 'done', filename: 'export.png' }));
    });
    expect(center.showToast).toBe(true);
    act(() => {
      center.dismissToast();
    });
    expect(center.showToast).toBe(false);

    // Re-upserting the SAME finished status (no transition) must not resurrect the toast.
    act(() => {
      center.upsert(job({ status: 'done', filename: 'export.png' }));
    });
    expect(center.showToast).toBe(false);

    act(() => root.unmount());
  });

  test('focus-gated auto-download only fires when document.hasFocus() is true', () => {
    const host = document.createElement('div');
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter();
      return null;
    }
    act(() => {
      root.render(createElement(Probe));
    });
    fetchMock.mockClear(); // drop the initial hydration GET from the call log

    // Unfocused — a 'done' transition must NOT hit the download endpoint.
    document.hasFocus = () => false;
    act(() => {
      center.upsert(job({ id: 'unfocused', status: 'done', filename: 'a.png' }));
    });
    const downloadCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/_api/export-jobs/download')
    );
    expect(downloadCalls.length).toBe(0);

    // Focused — a DIFFERENT job's 'done' transition MUST hit the download endpoint.
    document.hasFocus = () => true;
    act(() => {
      center.upsert(job({ id: 'focused', status: 'done', filename: 'b.png' }));
    });

    act(() => root.unmount());
  });

  test('a job first seen queued surfaces a "started" toast that morphs into "done" in place', () => {
    document.hasFocus = () => false;
    const host = document.createElement('div');
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter();
      return null;
    }
    act(() => {
      root.render(createElement(Probe));
    });

    act(() => {
      center.upsert(job({ status: 'queued' }));
    });
    expect(center.showToast).toBe(true);
    expect(center.toastJob?.id).toBe('j1');
    expect(center.toastJob?.status).toBe('queued');

    act(() => {
      center.upsert(job({ status: 'running', progress: { current: 1, total: 3 } }));
    });
    // Still the SAME toast (one entry per job), just reflecting the live status.
    expect(center.showToast).toBe(true);
    expect(center.toastJob?.id).toBe('j1');
    expect(center.toastJob?.status).toBe('running');

    act(() => {
      center.upsert(job({ status: 'done', filename: 'export.png' }));
    });
    expect(center.showToast).toBe(true);
    expect(center.toastJob?.id).toBe('j1');
    expect(center.toastJob?.status).toBe('done');

    act(() => root.unmount());
  });

  test('hydration seeds prior status — a historical done job never re-toasts or re-downloads', async () => {
    fetchMock = mock(async (url: string) => {
      if (String(url).includes('/_api/export-jobs') && !String(url).includes('download')) {
        return new Response(
          JSON.stringify({
            jobs: [
              job({ id: 'old', status: 'done', filename: 'old.png', createdAt: '2020-01-01' }),
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    document.hasFocus = () => true; // would auto-download if this were a live transition

    const host = document.createElement('div');
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter();
      return null;
    }
    // The hydration fetch resolves asynchronously — flush it under act().
    await act(async () => {
      root.render(createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(center.jobs.map((j) => j.id)).toEqual(['old']);
    expect(center.showToast).toBe(false);
    const downloadCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/_api/export-jobs/download')
    );
    expect(downloadCalls.length).toBe(0);

    act(() => root.unmount());
  });

  test('savingIds reflects a busy state around save()/download()', async () => {
    document.hasFocus = () => false;
    let resolveDownload!: (r: Response) => void;
    fetchMock = mock((url: string) => {
      if (String(url).includes('/_api/export-jobs/download')) {
        return new Promise<Response>((resolve) => {
          resolveDownload = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = document.createElement('div');
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter();
      return null;
    }
    act(() => {
      root.render(createElement(Probe));
    });
    act(() => {
      center.upsert(job({ status: 'done', filename: 'export.png' }));
    });
    expect(center.savingIds.has('j1')).toBe(false);
    expect(center.toastJob).not.toBeNull();
    const doneJob = center.toastJob as NonNullable<typeof center.toastJob>;

    let downloadDone!: Promise<void>;
    act(() => {
      downloadDone = center.download(doneJob);
    });
    expect(center.savingIds.has('j1')).toBe(true);

    await act(async () => {
      resolveDownload(new Response(new Blob(['x']), { status: 200 }));
      await downloadDone;
    });
    expect(center.savingIds.has('j1')).toBe(false);

    act(() => root.unmount());
  });
  test('dismissal targets a job ID and preserves every export in history', () => {
    document.hasFocus = () => false;
    const root = mount(document.createElement('div'));
    let center!: ReturnType<typeof useExportCenter>;
    function Probe() {
      center = useExportCenter({ enabled: false });
      return null;
    }
    act(() => root.render(createElement(Probe)));
    act(() => {
      for (let n = 0; n < 10; n++) center.upsert(job({ id: `j${n}`, status: 'failed' }));
    });
    expect(center.toastJobs).toHaveLength(10);
    act(() => center.dismissToast('j4'));
    expect(center.toastJobs.some((j) => j.id === 'j4')).toBe(false);
    expect(center.toastJobs.some((j) => j.id === 'j9')).toBe(true);
    expect(center.jobs).toHaveLength(10);
    act(() => center.upsert(job({ id: 'j4', status: 'failed' })));
    expect(center.toastJobs).toHaveLength(9);
    act(() => root.unmount());
  });

  test('history focuses the requested job and reveals complete diagnostics only on expansion', () => {
    document.hasFocus = () => false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = mount(host);
    let center!: ReturnType<typeof useExportCenter>;
    const error = `${'long/path/'.repeat(1000)}\nFULL TRACE TAIL`;
    function Probe() {
      center = useExportCenter({ enabled: false });
      return createElement(ExportPanel, { center });
    }
    act(() => root.render(createElement(Probe)));
    act(() => center.upsert(job({ id: 'failed', status: 'failed', error })));
    act(() => center.openPanel('failed'));
    const row = host.querySelector('[data-testid="export-job-failed"]');
    expect(document.activeElement).toBe(row);
    const details = row?.querySelector('details');
    expect(details?.open).toBe(false);
    act(() => details?.querySelector('summary')?.click());
    expect(details?.open).toBe(true);
    expect(details?.querySelector('pre')?.textContent).toBe(error);
    act(() => center.closePanel());
    expect(center.toastJobs).toHaveLength(1);
    expect(center.jobs[0].error).toBe(error);
    act(() => root.unmount());
    host.remove();
  });
});
