// p8-sweep-close (4) — `POST /_api/edit-op` 400 "One of the objects is not on this canvas." after a second
// Layers click on an object the first click stamped (dynamic sweep, canvas Smoke › Layers › Hide Frame).
//
//   1. the server half, reproduced: the first hide stamps the object (computed id → a readable one), and a
//      second op that still names the computed id is refused — exactly the sweep's 400;
//   2. the fix: the shell follows the stamp for a request built from the tree of before the rename, and
//      leaves a request built from a fresh tree alone.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createStampFollow } from '../client/stamp-follow.js';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const REL = 'ui/Smoke.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section className="frame">
          <p>AA</p>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
// the pipeline's computed id of <section> (canvas-pipeline.ts computeId: `Smoke:2`, after DesignCanvas + DCArtboard)
const COMPUTED = Bun.hash('Smoke:2').toString(16).padStart(16, '0').slice(0, 8);

function server() {
  const files = new Map<string, string>([[REL, SRC]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  return (body: Record<string, unknown>) => dispatchEditOp(body, deps);
}

describe('the server half (reproduced)', () => {
  test('a second op naming the computed id the first one stamped is refused', async () => {
    const run = server();
    const at = (element: string) => [{ artboard: 'desktop', element }];
    const first = await run({
      file: REL,
      op: 'object.hide',
      targets: at(COMPUTED),
      params: { hidden: true },
    });
    expect(first.ok).toBe(true);
    const stamped = (first as { refs: Array<{ element: string }> }).refs[0]?.element;
    expect(stamped).not.toBe(COMPUTED);
    const again = await run({
      file: REL,
      op: 'object.hide',
      targets: at(COMPUTED),
      params: { hidden: false },
    });
    expect(again).toMatchObject({
      ok: false,
      message: 'One of the objects is not on this canvas.',
    });
    const followed = await run({
      file: REL,
      op: 'object.hide',
      targets: at(stamped as string),
      params: { hidden: false },
    });
    expect(followed.ok).toBe(true);
  });
});

describe('stamp-follow (unit)', () => {
  test('a request from the old tree follows; one from a fresh tree does not', () => {
    const f = createStampFollow();
    const old = f.generation();
    f.record(
      '.design/ui/Smoke.tsx',
      [{ artboard: 'desktop', element: COMPUTED }],
      [{ artboard: 'desktop', element: 'frame' }]
    );
    const body = {
      file: '.design/ui/Smoke.tsx',
      op: 'object.hide',
      targets: [{ artboard: 'desktop', element: COMPUTED }],
    };
    expect(f.rewrite(body, old).targets[0]?.element).toBe('frame');
    f.bump();
    expect(f.rewrite(body, f.generation())).toBe(body);
    // another file / another artboard is never touched
    expect(f.rewrite({ ...body, file: '.design/ui/Other.tsx' }, old).targets[0]?.element).toBe(
      COMPUTED
    );
  });
});

// ── through the real useCanvasBridge hook and real `message` events (harness as s2-22) ──
const CANVAS_ORIGIN = 'http://canvas.test';
const FILE = '.design/ui/Smoke.tsx';
const win = { name: 'active', postMessage: () => {} };
const sent: Array<Record<string, unknown>> = [];
const NativeFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  sent.length = 0;
  globalThis.fetch = NativeFetch;
});

function props() {
  const values: Record<string, unknown> = {
    selected: null,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: {},
    theme: 'light',
    activePath: FILE,
    iframesRef: { current: new Map([[FILE, { contentWindow: win }]]) },
    selectedRef: { current: null },
  };
  const cache = new Map<string, unknown>();
  return new Proxy(values, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (!cache.has(key)) cache.set(key, key.endsWith('Ref') ? { current: null } : () => {});
      return cache.get(key);
    },
  });
}

async function mount() {
  const run = server();
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (String(url).endsWith('/_api/edit-op')) {
      sent.push(body);
      return new Response(JSON.stringify(await run(body)), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(props() as never);
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
}
function post(data: unknown) {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: CANVAS_ORIGIN },
    source: { value: win },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}
const sentElement = (i: number) =>
  (sent[i]?.targets as Array<{ element: string }> | undefined)?.[0]?.element;
const settle = () => act(async () => new Promise((r) => setTimeout(r, 60)));
const hide = (requestId: string, element: string, hidden: boolean) =>
  post({
    dgn: 'edit-op',
    requestId,
    op: 'object.hide',
    targets: [{ artboard: 'desktop', element }],
    params: { hidden },
  });

describe('the shell follows the stamp (bridge)', () => {
  test('Hide, then Show again before the canvas re-posts its tree: the second op names the stamped id', async () => {
    await mount();
    hide('r1', COMPUTED, true);
    hide('r2', COMPUTED, false);
    await settle();
    expect(sent.length).toBe(2);
    expect(sentElement(1)).not.toBe(COMPUTED);
  });

  test('a request made after the fresh tree arrived is sent as it is', async () => {
    await mount();
    hide('r1', COMPUTED, true);
    await settle();
    post({ dgn: 'layers-tree', artboardId: 'desktop', tree: [] });
    hide('r2', COMPUTED, false);
    await settle();
    expect(sentElement(1)).toBe(COMPUTED);
  });
});
