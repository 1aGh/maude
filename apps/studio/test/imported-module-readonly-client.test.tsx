// #151 T2.3b (client) — an element of an imported module (`data-cd-module="ui/hifi.tsx"`, stamped by the
// build) is selectable and commentable, but edit-READ-ONLY: the inspector says the part lives in another
// file (naming it) and offers the one door that helps, instead of fields whose writes would be refused.
// The same switch as a locked object (one disabled fieldset, every control says why), with its own line.
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

const FILE = '.design/ui/C.tsx';
const BOX = {
  id: 'ab12cd34',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: 'ldm-hifi',
  selector: '[data-dc-screen="a"] [data-cd-id="ab12cd34"]',
  text: '',
  bounds: { x: 100, y: 100, w: 300, h: 200 },
  worldW: 300,
  worldH: 200,
  dom_path: ['article', 'div'],
  authored: { padding: '8px', 'background-color': '#ffffff', 'border-radius': '4px' },
  computed: { display: 'block', padding: '8px' },
  customStyles: {},
  attrs: {} as Record<string, string>,
  artboardId: 'a',
  refs: [{ artboard: 'a', element: 'ab12cd34' }],
};

async function frame(attrs: Record<string, string>, cfg: Record<string, unknown> = {}) {
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
          layersTree: { artboardId: 'a', nodes: [] },
          cfg: { designRel: '.design', ...cfg },
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
  return document.querySelector('[data-testid="inspector-frame"]') as HTMLElement;
}

const CONTROLS = 'button, input, select, textarea';
const MODULE = { 'data-cd-module': 'ui/hifi.tsx' };

describe('the inspector of an element that lives in another file', () => {
  test('every field is off and says why; no write is made', async () => {
    const insp = await frame(MODULE);
    const controls = Array.from(insp.querySelectorAll<HTMLElement>(CONTROLS)).filter(
      (c) =>
        !c.closest('[data-testid="inspector-crumbs"]') &&
        !c.closest('[data-testid="inspector-hold-line"]')
    );
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls)
      expect({ c: c.outerHTML.slice(0, 80), off: !!c.closest('fieldset[disabled]') }).toEqual({
        c: c.outerHTML.slice(0, 80),
        off: true,
      });
    expect(silentDisabled(insp)).toEqual([]);
    const fs = insp.querySelector('fieldset[disabled]') as HTMLElement;
    expect(fs.getAttribute('title')).toContain('ui/hifi.tsx');
    expect(posts).toEqual([]);
  });

  test('the notice names the file in the v2 words and offers to open it', async () => {
    const insp = await frame(MODULE);
    const line = insp.querySelector('[data-testid="inspector-hold-line"]') as HTMLElement;
    expect(line.textContent).toContain('This part comes from ui/hifi.tsx, another file');
    expect(line.textContent).toContain('can’t be edited here');
    const act = insp.querySelector('[data-testid="inspector-module-action"]') as HTMLElement;
    expect(act.textContent).toBe('Open hifi.tsx');
  });

  test('the action runs the registry’s open-in-editor on THAT file (project-relative)', async () => {
    const { menuRunner } = await import('../client/v2/shell/menu-runner.js');
    const calls: Array<[string, unknown]> = [];
    const real = menuRunner.run;
    menuRunner.run = ((id: string, params?: unknown) => {
      calls.push([id, params]);
      return true;
    }) as typeof menuRunner.run;
    try {
      const insp = await frame(MODULE);
      await act(async () =>
        (insp.querySelector('[data-testid="inspector-module-action"]') as HTMLElement).click()
      );
    } finally {
      menuRunner.run = real;
    }
    expect(calls).toEqual([['canvas.open-in-editor', { path: '.design/ui/hifi.tsx' }]]);
  });

  test('an element of the canvas itself keeps its open inspector and no notice', async () => {
    const insp = await frame({});
    expect(insp.querySelector('fieldset[disabled]')).toBeNull();
    expect(insp.querySelector('[data-testid="inspector-module-action"]')).toBeNull();
    expect(insp.querySelector('[data-testid="inspector-hold-line"]')).toBeNull();
  });
});

describe('open-in-editor takes a file of the project, not only the open canvas', () => {
  test('the menu handler opens the path it is given; with none, the open canvas', async () => {
    const { createMenuHandlers } = await import('../client/v2/shell/menu-runner.js');
    const invoked: Array<[string, unknown]> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: unknown) => {
          invoked.push([cmd, args]);
        },
      },
    };
    try {
      const h = createMenuHandlers({
        activePath: '.design/ui/C.tsx',
        toast: () => {},
      } as never) as Record<string, (p?: unknown) => Promise<void> | void>;
      await h['canvas.open-in-editor']?.({ path: '.design/ui/hifi.tsx' });
      await h['canvas.open-in-editor']?.();
    } finally {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
    }
    expect(invoked).toEqual([
      ['project_open_in_editor', { rel: '.design/ui/hifi.tsx' }],
      ['project_open_in_editor', { rel: '.design/ui/C.tsx' }],
    ]);
  });
});

describe('select + comment still work on such an element (T2.3 stamped it; this pins it)', () => {
  test('it selects by its id, scoped to its artboard, and a comment anchors on it', async () => {
    const { hoverTargetToSelection, commentSelectionFor } = await import('../dom-selection.ts');
    document.body.innerHTML =
      '<div data-dc-screen="a"><div data-cd-id="ab12cd34" data-cd-module="ui/hifi.tsx" class="ldm-hifi">x</div></div>';
    const el = document.querySelector('[data-cd-id]') as Element;
    const sel = hoverTargetToSelection({ el, cdId: 'ab12cd34', artboardId: 'a' } as never);
    expect(sel.id).toBe('ab12cd34');
    expect(sel.selector).toBe('[data-dc-screen="a"] [data-cd-id="ab12cd34"]');
    const note = commentSelectionFor({ el, cdId: 'ab12cd34', artboardId: 'a' }, 10, 10);
    expect(note.id).toBe('ab12cd34');
    expect(note.selector).toBe(sel.selector);
  });
});
