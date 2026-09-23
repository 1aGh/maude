import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { type CanvasRuntimeApi, mountCanvas } from '../canvas-comment-mount.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test('soft HMR announces only committed replacement DOM so the shell can refresh selection', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const file = '.design/ui/History.tsx';
  const announcements: Array<{ file: unknown; title: string | null }> = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    if (message && typeof message === 'object' && 'dgn' in message && message.dgn === 'loaded') {
      announcements.push({
        file: 'file' in message ? message.file : undefined,
        title: host.querySelector('h1')?.getAttribute('title') ?? null,
      });
    }
  });
  const initial = () =>
    createElement('h1', { title: 'peer edit', 'data-cd-id': 'stable' }, 'Title');
  const restored = () =>
    createElement('h1', { title: 'original', 'data-cd-id': 'stable' }, 'Title');
  const repaired = () =>
    createElement('h1', { title: 'repaired', 'data-cd-id': 'stable' }, 'Title');
  const broken = () => {
    throw new Error('intentional broken canvas');
  };
  try {
    await act(async () => mountCanvas(initial, { rootEl: host, file, commentsEnabled: true }));
    const runtime = (window as unknown as { __maudeCanvasRuntime: CanvasRuntimeApi })
      .__maudeCanvasRuntime;
    expect(runtime).toBeDefined();
    expect(announcements).toEqual([]); // Initial document handshake still belongs to inspect.ts.
    await act(async () => runtime.remount(restored));
    expect(host.querySelector('h1')?.getAttribute('title')).toBe('original');
    expect(announcements).toEqual([{ file, title: 'original' }]);

    announcements.length = 0;
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => runtime.remount(broken));
      expect(
        errors.mock.calls.some((args) =>
          args.some(
            (value) => value instanceof Error && value.message === 'intentional broken canvas'
          )
        )
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
    expect(host.querySelector('h1')?.getAttribute('title')).toBe('original');
    expect(host.querySelector('.dc-hmr-holding')).not.toBeNull();
    expect(announcements).toEqual([]);

    await act(async () => runtime.remount(repaired));
    expect(announcements).toEqual([{ file, title: 'repaired' }]);
    expect(host.querySelector('.dc-hmr-holding')).toBeNull();
  } finally {
    post.mockRestore();
  }
});
