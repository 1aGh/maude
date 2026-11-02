// p8-sweep-errors (1) — the dead-control crawl's `POST /_api/edit-op` 409 ×22. The cause was not a version race:
// the crawler clicked a Layers row's padlock (`Lock Hello`, object.lock) and then the same row's eye
// (`Hide Hello`), then the inspector's Case `AA` and Language on that object. A locked object refuses every
// op but the lock itself (S2-edit-ops.md §3 rule 6: 409 `locked`), so each later click answered 409.
// The server is right; the studio offered a control the server refuses. Now a locked object's eye is off and
// says why, and so are the inspector's asks; nothing reaches the route to be refused.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { REASONS } from '../client/v2/access/disabled-reason.js';
import { LayerRowTools } from '../client/v2/inspector/layers-row-tools.jsx';
import { isLockedSelection } from '../client/v2/inspector/model.js';
import { type DispatchDeps, dispatchEditOp, statusOf } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  return host;
}

const FILE = 'ui/Landing.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Landing() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <h1 data-cd-id="hello">Hello</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('the crawl sequence on the server: Lock Hello, then Hide Hello', () => {
  test('the second edit is the 409 the crawl saw, and it is the lock (not a stale base)', async () => {
    const files = new Map([[FILE, SRC]]);
    const deps: DispatchDeps = {
      resolve: (f) => (files.has(f) ? f : null),
      read: (rel) => files.get(rel) ?? null,
      write: async (rel, _b, after) => void files.set(rel, after),
      heldByAi: () => null,
      log: createWriteLog(),
    };
    const run = (op: string, params: Record<string, unknown>) =>
      dispatchEditOp(
        { file: FILE, op, targets: [{ artboard: 'desktop', element: 'hello' }], params },
        deps
      );
    expect((await run('object.lock', { locked: true })).ok).toBe(true);
    const hide = await run('object.hide', { hidden: true });
    expect(hide.ok).toBe(false);
    expect(statusOf(hide)).toBe(409);
    expect(!hide.ok && hide.code).toBe('locked');
    const upper = await run('text.set-case', { case: 'upper' });
    expect(!upper.ok && upper.code).toBe('locked');
  });
});

describe('Layers: a locked row’s eye is off and says why', () => {
  const NODE = { id: 'hello', index: 0, label: 'Hello' };

  test('unlocked: the eye hides', async () => {
    const hidden: unknown[] = [];
    const host = await mount(
      <LayerRowTools
        node={NODE}
        isLocked={false}
        isHidden={false}
        onToggleLock={() => {}}
        onToggleVisibility={(n: unknown) => hidden.push(n)}
      />
    );
    const eye = host.querySelector('.sh-layer-eye') as HTMLButtonElement;
    expect(eye.disabled).toBe(false);
    await act(async () => eye.click());
    expect(hidden).toHaveLength(1);
  });

  test('locked: the eye is disabled with the lock line, sends nothing; the padlock still unlocks', async () => {
    const hidden: unknown[] = [];
    const locks: unknown[] = [];
    const host = await mount(
      <LayerRowTools
        node={NODE}
        isLocked
        isHidden={false}
        onToggleLock={(k: unknown) => locks.push(k)}
        onToggleVisibility={(n: unknown) => hidden.push(n)}
      />
    );
    const eye = host.querySelector('.sh-layer-eye') as HTMLButtonElement;
    expect(eye.disabled).toBe(true);
    expect(eye.getAttribute('title')).toBe(REASONS.locked);
    expect(eye.getAttribute('aria-description')).toBe(REASONS.locked);
    await act(async () => eye.click());
    expect(hidden).toHaveLength(0);
    const lock = host.querySelector('.sh-layer-lock') as HTMLButtonElement;
    expect(lock.disabled).toBe(false);
    await act(async () => lock.click());
    expect(locks).toEqual(['hello:0']);
  });
});

describe('isLockedSelection', () => {
  const tree = { artboardId: 'desktop', nodes: [{ id: 'hello', index: 0, locked: true }] };
  test('the element’s own attribute, or its Layers node, says locked', () => {
    expect(isLockedSelection({ id: 'x', attrs: { 'data-cd-locked': '' } }, null)).toBe(true);
    expect(isLockedSelection({ id: 'hello', index: 0, attrs: {} }, tree)).toBe(true);
    expect(isLockedSelection({ id: 'other', attrs: {} }, tree)).toBe(false);
    expect(
      isLockedSelection(
        [
          { id: 'other', attrs: {} },
          { id: 'hello', index: 0 },
        ],
        tree
      )
    ).toBe(true);
    expect(isLockedSelection(null, tree)).toBe(false);
  });
  test('an artboard is never "locked" here (its own writes are not element edit-ops)', () => {
    expect(
      isLockedSelection(
        {
          id: null,
          artboardId: 'desktop',
          attrs: { 'data-dc-screen': 'desktop', 'data-cd-locked': '' },
        },
        null
      )
    ).toBe(false);
  });
});
