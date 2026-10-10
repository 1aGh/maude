// V2-2.8 — "Export again" on every Recent row of the shell Export sheet
// (decision:maude/v2-2.8-shift-cmd-e-one-sheet, Gate 0 D3: "One sheet ⇧⌘E; 'Export again' on every
// Exports row; ⌘E unbound"). v1's ⇧⌘E re-ran the last export from inside the canvas iframe; the
// feature lives on here, one button per history row, through the sheet's OWN submit path (the lane
// gate, the jobs POST, close-on-enqueue) — with the scope fallback the iframe's rerunLast() had:
// a (format, scope) pair that is not legal is re-sent with that format's default scope.
//
// Behavioural: the real ExportDialog is mounted (happy-dom + React), `fetch` is a recording stub.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const HISTORY = [
  {
    format: 'png',
    scope: 'artboard',
    options: { scale: 2, artboardId: 'a1', canvasFile: '.design/ui/home.tsx' },
    filename: 'home.png',
    at: '2026-10-10T10:03:00.000Z',
  },
  // An illegal pair (pdf cannot render the raw project tree): replayed with pdf's default scope.
  {
    format: 'pdf',
    scope: 'project-raw',
    options: {
      pdfPrint: { includeBleed: true, marks: { crop: true, registration: false } },
      dpi: 300,
    },
    filename: 'home.pdf',
    at: '2026-10-10T10:02:00.000Z',
  },
  { format: 'zip', scope: 'project-raw', filename: 'project.zip', at: '2026-10-10T10:01:00.000Z' },
];

interface Call {
  method: string;
  url: string;
  body?: { format: string; scope: string; options: Record<string, unknown> };
}
let calls: Call[] = [];
let jobStatus = 200;
const realFetch = globalThis.fetch;
function stubFetch() {
  calls = [];
  jobStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/_api/export-history')) return json({ history: HISTORY });
    if (url.endsWith('/_api/export-jobs')) {
      return jobStatus === 200
        ? json({ ok: true, id: 'job-1' })
        : new Response('nope', { status: jobStatus });
    }
    return json({}, 404);
  }) as typeof fetch;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = () => new Promise((r) => setTimeout(r, 20));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const jobPosts = () =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/_api/export-jobs'));

async function mountSheet(props: Record<string, unknown> = {}) {
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  let closed = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportDialog
        mode="export"
        activePath=".design/ui/home.tsx"
        activeArtboardId="a1"
        exportLane="local"
        onClose={() => {
          closed++;
        }}
        {...props}
      />
    );
    await tick();
  });
  return { closed: () => closed };
}

async function clickAgain(i: number) {
  const btn = $(`[data-testid="export-recent-again-${i}"]`);
  expect(btn).not.toBeNull();
  await act(async () => {
    btn?.click();
    await tick();
  });
}

describe('Export sheet › Recent › Export again', () => {
  test('every Recent row has an "Export again" button', async () => {
    stubFetch();
    await mountSheet();
    const rows = document.querySelectorAll('[data-testid="export-recent"] .st-export-recent-row');
    expect(rows.length).toBe(HISTORY.length);
    for (let i = 0; i < HISTORY.length; i++) {
      const btn = $(`[data-testid="export-recent-again-${i}"]`);
      expect(btn?.textContent?.trim()).toBe('Export again');
      expect(rows[i].contains(btn)).toBe(true);
    }
  });

  test('re-submits the entry verbatim through the sheet’s jobs path, then closes the sheet', async () => {
    stubFetch();
    const sheet = await mountSheet();
    await clickAgain(0);
    expect(jobPosts().map((c) => c.body)).toEqual([
      {
        format: 'png',
        scope: 'artboard',
        options: { scale: 2, artboardId: 'a1', canvasFile: '.design/ui/home.tsx' },
      },
    ]);
    expect(sheet.closed()).toBe(1);
  });

  test('an illegal (format, scope) pair falls back to the format’s default scope; options kept', async () => {
    stubFetch();
    await mountSheet();
    await clickAgain(1);
    expect(jobPosts().map((c) => c.body)).toEqual([
      {
        format: 'pdf',
        scope: 'selection', // defaultScopeForFormat('pdf') — project-raw cannot render as a PDF
        options: HISTORY[1].options,
      },
    ]);
  });

  test('an entry with no options re-sends an empty bag, and a legal pair is left alone', async () => {
    stubFetch();
    await mountSheet();
    await clickAgain(2);
    expect(jobPosts().map((c) => c.body)).toEqual([
      { format: 'zip', scope: 'project-raw', options: {} },
    ]);
  });

  test('one click is one job — and the sheet’s own Export button is not triggered', async () => {
    stubFetch();
    await mountSheet();
    await clickAgain(0);
    expect(jobPosts().length).toBe(1);
  });

  test('a refused job keeps the sheet open and says why', async () => {
    stubFetch();
    jobStatus = 500;
    const sheet = await mountSheet();
    await clickAgain(0);
    expect(sheet.closed()).toBe(0);
    const status = $('[data-testid="export-status"]');
    expect(status?.getAttribute('data-ok')).toBe('0');
    expect(status?.textContent).toContain('nope');
  });

  test('a format this workspace cannot render is refused by the same lane gate as the Export button', async () => {
    stubFetch();
    const sheet = await mountSheet({ exportLane: 'none' });
    await clickAgain(1); // pdf needs the render service
    expect(jobPosts()).toEqual([]);
    expect(sheet.closed()).toBe(0);
    expect($('[data-testid="export-status"]')?.getAttribute('data-ok')).toBe('0');
  });
});
