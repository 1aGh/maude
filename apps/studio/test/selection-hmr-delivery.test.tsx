import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { type CanvasRuntimeApi, mountCanvas } from '../canvas-comment-mount.tsx';
import { useSelectionSet } from '../use-selection-set.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => GlobalRegistrator.unregister());

test('a selection immediately before soft HMR reaches the shell before the replacement handshake', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const file = '.design/ui/Selection.tsx';
  const selected = { file, id: 'heading', selector: '[data-cd-id="heading"]', tag: 'h1' };
  const messages: Array<Record<string, unknown>> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((m: unknown) => {
    if (m && typeof m === 'object' && 'dgn' in m) messages.push(m as Record<string, unknown>);
  });
  function Initial() {
    const selection = useSelectionSet();
    return createElement(
      'button',
      { type: 'button', onClick: () => selection.replace(selected) },
      'Select'
    );
  }
  const replacement = () => createElement('h1', { 'data-cd-id': 'heading' }, 'Replaced');
  try {
    await act(async () => mountCanvas(Initial, { rootEl: host, file, commentsEnabled: true }));
    const runtime = (window as unknown as { __maudeCanvasRuntime: CanvasRuntimeApi })
      .__maudeCanvasRuntime;
    await act(async () => {
      host.querySelector('button')?.click();
      runtime.remount(replacement);
    });
    expect(host.querySelector('h1')?.textContent).toBe('Replaced');
    expect(messages.filter((m) => m.dgn === 'select-set' || m.dgn === 'loaded')).toEqual([
      { dgn: 'select-set', selection: selected },
      { dgn: 'loaded', file },
    ]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(messages.filter((m) => m.dgn === 'select-set')).toHaveLength(1);
  } finally {
    post.mockRestore();
    host.remove();
  }
});

test('soft HMR delivers the latest clear, not an earlier queued selection', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const messages: Array<Record<string, unknown>> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((m: unknown) => {
    if (m && typeof m === 'object' && 'dgn' in m) messages.push(m as Record<string, unknown>);
  });
  function Initial() {
    const selection = useSelectionSet();
    return createElement(
      'button',
      {
        type: 'button',
        onClick: () => {
          selection.replace({ id: 'a', selector: '#a' });
          selection.replace({ id: 'b', selector: '#b' });
          selection.clear();
        },
      },
      'Clear'
    );
  }
  try {
    await act(async () =>
      mountCanvas(Initial, {
        rootEl: host,
        file: '.design/ui/Selection.tsx',
        commentsEnabled: true,
      })
    );
    const runtime = (window as unknown as { __maudeCanvasRuntime: CanvasRuntimeApi })
      .__maudeCanvasRuntime;
    await act(async () => {
      host.querySelector('button')?.click();
      runtime.remount(() => createElement('h1', null, 'Replaced'));
    });
    expect(messages.filter((m) => m.dgn === 'select-set')).toEqual([
      { dgn: 'select-set', selection: null },
    ]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(messages.filter((m) => m.dgn === 'select-set')).toHaveLength(1);
  } finally {
    post.mockRestore();
    host.remove();
  }
});
