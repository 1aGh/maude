// Contract V2-1.11 §5.8 invariant 7 (V2-2.4b, S8): the UI path and the AI path of an action give
// the same result. For `export.rerun-last`: the Export sheet's "Export again" row
// (`export-recent-again-<i>`) and `maude design exports again <i>` post the SAME job body to
// /_api/export-jobs for every history entry — legal pair, illegal pair (scope fallback), no
// options.
//
// The verb half runs first, against a loopback fake studio (bin/exports.sh as a child); the UI half
// then mounts the real ExportDialog under happy-dom with a recording fetch.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { fakeStudio, json } from './_fake-studio.ts';

const HISTORY = [
  {
    id: 'j1',
    format: 'png',
    scope: 'artboard',
    options: { scale: 2, artboardId: 'a1', canvasFile: '.design/ui/home.tsx' },
    filename: 'home.png',
    at: '2026-10-10T10:03:00.000Z',
  },
  {
    id: 'j2',
    format: 'pdf',
    scope: 'project-raw',
    options: {
      pdfPrint: { includeBleed: true, marks: { crop: true, registration: false } },
      dpi: 300,
    },
    filename: 'home.pdf',
    at: '2026-10-10T10:02:00.000Z',
  },
  {
    id: 'j3',
    format: 'zip',
    scope: 'project-raw',
    filename: 'p.zip',
    at: '2026-10-10T10:01:00.000Z',
  },
];

type Body = { format: string; scope: string; options: Record<string, unknown> };
const verbBodies: Body[] = [];

beforeAll(async () => {
  const studio = fakeStudio((s) => {
    if (s.path === '/_api/export-history') return json({ history: HISTORY });
    if (s.path === '/_api/export-jobs' && s.method === 'POST') {
      verbBodies.push(s.body as Body);
      return json({ jobId: `v${verbBodies.length}` }, 202);
    }
  });
  try {
    for (let i = 0; i < HISTORY.length; i++) {
      const r = await studio.run('exports', ['again', String(i), '--no-wait']);
      if (r.code !== 0) throw new Error(`exports again ${i}: ${r.code} ${r.stderr}`);
    }
  } finally {
    studio.stop();
  }
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

async function uiBody(i: number): Promise<Body | undefined> {
  const bodies: Body[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/_api/export-history'))
      return new Response(JSON.stringify({ history: HISTORY }), {
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/_api/export-jobs') && init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ jobId: 'ui' }), { status: 202 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <ExportDialog
          mode="export"
          activePath=".design/ui/home.tsx"
          activeArtboardId="a1"
          exportLane="local"
          onClose={() => {}}
        />
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    const btn = document.querySelector(`[data-testid="export-recent-again-${i}"]`) as HTMLElement;
    await act(async () => {
      btn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
  } finally {
    act(() => root.unmount());
    host.remove();
    globalThis.fetch = realFetch;
  }
  return bodies[0];
}

describe('export.rerun-last — the sheet and the verb post the same job (§5.8 inv. 7)', () => {
  for (let i = 0; i < HISTORY.length; i++) {
    test(`history entry ${i} (${HISTORY[i]?.format} × ${HISTORY[i]?.scope})`, async () => {
      const ui = await uiBody(i);
      expect(ui).toBeDefined();
      expect(verbBodies[i]).toEqual(ui as Body);
    });
  }
});
