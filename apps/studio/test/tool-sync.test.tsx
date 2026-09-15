// tool-sync — one active tool per canvas document across provider instances.
//
// A UI canvas mounts TWO ToolProviders: the comment-mount layer's and
// canvas-lib's own (separate bundles, separate contexts). A palette click used
// to reach canvas-lib's alone, so "Comment" lit up in the palette while the
// comment layer stayed in browse and a click on the canvas dropped nothing
// (plan T31/L11). Two independent roots stand in for the two bundles here —
// the only channel between them is the document, exactly as in the iframe.

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
import { ToolProvider, useToolMode } from '../use-tool-mode.tsx';

type Ctx = ReturnType<typeof useToolMode>;
const seen: { comments: Ctx | null; canvas: Ctx | null } = { comments: null, canvas: null };
function CaptureComments() {
  seen.comments = useToolMode();
  return null;
}
function CaptureCanvas() {
  seen.canvas = useToolMode();
  return null;
}

const roots: Root[] = [];
function mountBoth(): void {
  for (const ui of [
    <ToolProvider key="c" initial="browse">
      <CaptureComments />
    </ToolProvider>,
    <ToolProvider key="l">
      <CaptureCanvas />
    </ToolProvider>,
  ]) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(ui));
  }
}

afterEach(() => {
  act(() => {
    for (const r of roots.splice(0)) r.unmount();
  });
  document.body.innerHTML = '';
});

describe('tool sync across provider instances', () => {
  test('each instance keeps its own boot posture — nothing is announced at mount', () => {
    mountBoth();
    expect(seen.comments?.tool).toBe('browse');
    expect(seen.canvas?.tool).toBe('move');
  });

  test('a palette pick in one instance arms the other (Comment reaches the comment layer)', () => {
    mountBoth();
    act(() => seen.canvas?.setTool('comment'));
    expect(seen.comments?.tool).toBe('comment');
    act(() => seen.comments?.setTool('move'));
    expect(seen.canvas?.tool).toBe('move');
    expect(seen.canvas?.mode).toBe('edit');
  });

  test('adopting a tool never clears the lock the other instance holds on it', () => {
    mountBoth();
    act(() => seen.canvas?.toggleSticky('pen'));
    expect(seen.comments?.tool).toBe('pen');
    expect(seen.canvas?.sticky).toEqual({ tool: 'pen', locked: true });
  });
});
