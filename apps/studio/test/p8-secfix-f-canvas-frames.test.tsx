// p8-secfix-f — what a canvas-only session (a link viewer, a canvas grant: `access.role == null` with grants)
// may have framed at once, and what its frames claim.
//
// F1: every mounted canvas frame sits on the ONE canvas origin with `allow-same-origin`, so a sibling frame can
// read another's document and URL (its `t` + `fc`). For a full-role session every frame carries the same
// access, so that reads nothing new; for a canvas-only session the frames carry DIFFERENT grants, so the
// shell mounts only the active tab's frame (no keep-alive) and frames no grid of several canvases (the DS
// reach view). A distinct origin per canvas is the real fix and a later task.
//
// F2: in a cloud tab a canvas-only session's frame carries the cell's read-only FOLLOW capability (the hub
// mints nothing else for it, S3.7c), so writes from the frame answer 403 — the frame opens read-only even
// on a Can edit grant instead of offering tools that cannot save.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { canvasUrl, setCanvasCaps } from '../client/canvas-url.js';
import { framesIsolated } from '../client/v2/access/access-client.js';
import { reachModel } from '../client/v2/ds/reach-model.js';

const D = '.design';
const A = `${D}/ui/a.tsx`;
const B = `${D}/ui/b.tsx`;
let realFetch: typeof fetch;

beforeAll(() => {
  GlobalRegistrator.register({ settings: { disableIframePageLoading: true } });
  const report = console.error.bind(console);
  console.error = (...a: unknown[]) => {
    if (!String(a[0] ?? '').includes('Iframe page loading is disabled')) report(...a);
  };
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realFetch = globalThis.fetch;
  // the viewport asks whether the open canvas is on this Mac before it frames it: "present"
  globalThis.fetch = (async (url: string) => {
    const rel = new URL(String(url), 'http://x').searchParams.get('canvas') ?? 'ui/a.tsx';
    return {
      ok: true,
      status: 200,
      json: async () => ({ canvas: { path: rel, state: 'present' } }),
    } as Response;
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  setCanvasCaps({});
});

const ORIGIN = 'http://canvas.test';
const canvasOnly = (r = 'observer') => ({
  designRel: D,
  canvasOrigin: ORIGIN,
  readOnly: true,
  readOnlyReason: 'role',
  formatGate: null,
  access: {
    role: null,
    grants: [
      { c: 'ui/a.tsx', r },
      { c: 'ui/b.tsx', r },
    ],
  },
});
const member = {
  designRel: D,
  canvasOrigin: ORIGIN,
  readOnly: false,
  access: { role: 'member', grants: [] },
};

async function mountViewport(cfg: unknown, activePath = A) {
  const { Viewport } = await import('../client/shell/viewport.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Viewport
        tabs={[{ path: A }, { path: B }]}
        activePath={activePath}
        registerIframe={() => {}}
        cfg={cfg}
        canvasReloadNonce={0}
        renderSignal={{}}
      />
    );
  });
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return [...host.querySelectorAll<HTMLIFrameElement>('iframe')].map((f) => f.dataset.path);
}

describe('F1 — a canvas-only session frames one canvas at a time', () => {
  test('framesIsolated: role null with grants only', () => {
    expect(framesIsolated(canvasOnly())).toBe(true);
    expect(framesIsolated(member)).toBe(false);
    expect(
      framesIsolated({ access: { role: 'observer', grants: [{ c: 'ui/a.tsx', r: 'member' }] } })
    ).toBe(false);
    expect(framesIsolated({ access: { role: null, grants: [] } })).toBe(false);
    expect(framesIsolated({ designRel: D })).toBe(false);
    expect(framesIsolated(null)).toBe(false);
  });

  test('grants on A and B, two open tabs: only the active tab has a frame', async () => {
    expect(await mountViewport(canvasOnly(), A)).toEqual([A]);
  });

  test('switching tabs moves the one frame; it is not kept alive behind', async () => {
    expect(await mountViewport(canvasOnly('member'), B)).toEqual([B]);
  });

  test('a project member keeps every open tab mounted (keep-alive unchanged)', async () => {
    expect(await mountViewport(member, A)).toEqual([A, B]);
  });

  test('the DS reach view frames no canvas for a canvas-only session, and still opens its list', async () => {
    const { DsReachView } = await import('../client/v2/ds/reach-view.jsx');
    const usage = {
      canvases: [
        {
          rel: 'ui/a.tsx',
          places: 2,
          artboards: { x: 2 },
          elements: [{ artboard: 'x', id: 'cta' }],
        },
        {
          rel: 'ui/b.tsx',
          places: 1,
          artboards: { x: 1 },
          elements: [{ artboard: 'x', id: 'buy' }],
        },
      ],
    };
    const review = {
      system: 'studio',
      expectHead: 'f'.repeat(64),
      changes: [
        { css: '--accent', label: 'Accent', before: { light: '#0a6' }, after: { light: '#06a' } },
      ],
      canvases: [
        { path: 'ui/a.tsx', folder: 'ui', state: 'follows', ticked: true },
        { path: 'ui/b.tsx', folder: 'ui', state: 'follows', ticked: true },
      ],
    };
    const mount = async (cfg: unknown) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () =>
        root.render(
          createElement(
            DsReachView as never,
            {
              ds: 'studio',
              cfg,
              name: 'Accent',
              reach: reachModel(usage),
              review,
              places: { 'ui/a.tsx': 2, 'ui/b.tsx': 1 },
              onUpdate: async () => ({ ok: true }),
              onCancel: async () => ({ ok: true }),
              onClose: () => {},
            } as never
          )
        )
      );
      return host;
    };
    const ds = {
      designSystems: [{ name: 'studio', path: 'system/studio' }],
      dsConverted: { studio: false },
    };
    const shared = await mount({ ...canvasOnly('member'), ...ds });
    expect(shared.querySelectorAll('[data-testid="ds-reach-iframe"]').length).toBe(0);
    expect(shared.querySelectorAll('[data-testid="ds-reach-frame"]').length).toBe(2);
    expect(shared.querySelector('[data-testid="ds-reach-review"]')).not.toBeNull();
    const team = await mount({ ...member, ...ds });
    expect(team.querySelectorAll('[data-testid="ds-reach-iframe"]').length).toBe(2);
  });
});

const ro = (path: string, cfg: unknown) =>
  new URL(canvasUrl(path, cfg), 'http://x').searchParams.get('ro');
const tok = (path: string, cfg: unknown) =>
  new URL(canvasUrl(path, cfg), 'http://x').searchParams.get('t');

describe('F2 — a frame that carries a follow capability opens read-only', () => {
  const cloud = (r: string) => ({ ...canvasOnly(r), cloud: { role: null } });

  test('cloud, canvas-only Can edit on A, the per-canvas follow capability → the frame is ro', () => {
    setCanvasCaps({ 'ui/a.tsx': 'follow-cap-a' });
    expect(tok(A, cloud('member'))).toBe('follow-cap-a');
    expect(ro(A, cloud('member'))).toBe('1');
  });

  test('the same grant on the desktop (no follow capability) still edits its canvas', () => {
    expect(ro(A, canvasOnly('member'))).toBeNull();
  });

  test('a cloud session with a project-wide capability is unchanged', () => {
    const team = { ...member, cloud: { role: 'member' }, canvasToken: 'project-cap' };
    expect(tok(A, team)).toBe('project-cap');
    expect(ro(A, team)).toBeNull();
  });
});
