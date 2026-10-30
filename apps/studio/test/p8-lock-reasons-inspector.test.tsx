// p8-lock-reasons (1, client) — a locked object (`data-cd-locked`, the shared lock) refuses every write but the
// lock itself (S2-edit-ops §3 rule 6). p8-sweep-errors greyed the text kind's asks; the rest of the inspector
// (padding, fill, radius, position … all written through /_api/edit-css) still wrote. Now the whole inspector is
// the view-mode switch for a locked object — one disabled fieldset — with the lock line on screen and on the
// fieldset, so every control under it is off and says why. A walk of the panel asserts it, not one row at a time.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { silentDisabled } from './_disabled-reasons.ts';

const realFetch = globalThis.fetch;
const posts: string[] = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (init?.body) posts.push(String(url));
    return new Response(JSON.stringify({ ok: true, previous: null }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
beforeEach(() => {
  posts.length = 0;
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const FILE = '.design/ui/Poster.tsx';
const BOX = {
  id: 'card',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: '',
  selector: '[data-dc-screen="post"] [data-cd-id="card"]',
  text: '',
  bounds: { x: 100, y: 100, w: 300, h: 200 },
  worldW: 300,
  worldH: 200,
  dom_path: ['article', 'div'],
  authored: { padding: '8px', 'background-color': '#ffffff', 'border-radius': '4px' },
  computed: { display: 'block', padding: '8px' },
  customStyles: {},
  attrs: {} as Record<string, string>,
  artboardId: 'post',
  refs: [{ artboard: 'post', element: 'card' }],
};

async function frame(attrs: Record<string, string>) {
  await import('../client/v2/inspector/sections/index.js');
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected: { ...BOX, attrs },
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: { designRel: '.design' },
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
          onRunAction: () => {},
          onShellAction: () => {},
        } as never)}
      />
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host.querySelector('[data-testid="inspector-frame"]') as HTMLElement;
}

const CONTROLS = 'button, input, select, textarea';

describe('p8-lock-reasons — the inspector of a locked object', () => {
  test('every control is off and says "This object is locked; unlock it first."', async () => {
    const { REASONS } = await import('../client/v2/access/disabled-reason.js');
    const insp = await frame({ 'data-cd-locked': '' });
    const controls = Array.from(insp.querySelectorAll<HTMLElement>(CONTROLS)).filter(
      (c) => !c.closest('[data-testid="inspector-crumbs"]')
    );
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls)
      expect({ c: c.outerHTML.slice(0, 80), off: !!c.closest('fieldset[disabled]') }).toEqual({
        c: c.outerHTML.slice(0, 80),
        off: true,
      });
    expect(silentDisabled(insp)).toEqual([]);
    const fs = insp.querySelector('fieldset[disabled]') as HTMLElement;
    expect(fs.getAttribute('title')).toBe(REASONS.locked);
    expect(fs.getAttribute('aria-description')).toBe(REASONS.locked);
    expect(insp.querySelector('[data-testid="inspector-hold-line"]')?.textContent).toBe(
      REASONS.locked
    );
  });

  test('unlocked: the same object’s inspector is open, with no lock line', async () => {
    const insp = await frame({});
    expect(insp.querySelector('fieldset[disabled]')).toBeNull();
    expect(insp.querySelector('[data-testid="inspector-hold-line"]')).toBeNull();
  });
});
