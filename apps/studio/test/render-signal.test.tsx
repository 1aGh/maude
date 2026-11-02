// S6.12 (L1) — the canvas document tells its shell when it cannot draw and when it can again:
// dgn `render-error { file, message }` ONCE per failure, `render-ok { file }` on every clean commit.
// The canvas keeps holding the last good render (DDR-077); the shell draws the card. The amber
// "holding last good render" toast is for a LIVE AI run only.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
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

const FILE = '.design/ui/Pricing.tsx';
type Signal = { dgn: string; file?: string; message?: string };

async function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  const seen: Signal[] = [];
  const post = spyOn(window.parent, 'postMessage').mockImplementation((m: unknown) => {
    const d = (m as Signal | null)?.dgn;
    if (d === 'render-error' || d === 'render-ok') seen.push(m as Signal);
  });
  const good =
    (title = 'ok') =>
    () =>
      createElement('h1', null, title);
  await act(async () => mountCanvas(good(), { rootEl: host, file: FILE, commentsEnabled: true }));
  const runtime = (window as unknown as { __maudeCanvasRuntime: CanvasRuntimeApi })
    .__maudeCanvasRuntime;
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  return {
    host,
    seen,
    runtime,
    good,
    done() {
      post.mockRestore();
      errors.mockRestore();
    },
  };
}

describe('render signal', () => {
  test('a clean first draw says render-ok, naming the file', async () => {
    const t = await setup();
    try {
      expect(t.seen).toEqual([{ dgn: 'render-ok', file: FILE }]);
    } finally {
      t.done();
    }
  });

  test('a canvas that throws says render-error ONCE, with its message', async () => {
    const t = await setup();
    try {
      t.seen.length = 0;
      const broken = () => {
        throw new Error('plan is not defined');
      };
      await act(async () => t.runtime.remount(broken));
      expect(t.seen).toEqual([{ dgn: 'render-error', file: FILE, message: 'plan is not defined' }]);
      // an unrelated re-render of the same failure is not a second failure
      await act(async () => {
        await Promise.resolve();
      });
      expect(t.seen).toHaveLength(1);
    } finally {
      t.done();
    }
  });

  test('recovery says render-ok; a second failure is a second render-error', async () => {
    const t = await setup();
    try {
      t.seen.length = 0;
      const broken = () => {
        throw new Error('boom 1');
      };
      const broken2 = () => {
        throw new Error('boom 2');
      };
      await act(async () => t.runtime.remount(broken));
      await act(async () => t.runtime.remount(t.good('fixed')));
      await act(async () => t.runtime.remount(broken2));
      expect(t.seen.map((s) => [s.dgn, s.message])).toEqual([
        ['render-error', 'boom 1'],
        ['render-ok', undefined],
        ['render-error', 'boom 2'],
      ]);
    } finally {
      t.done();
    }
  });

  test('the message is plain text, clipped, and a non-Error throw still says something', async () => {
    const t = await setup();
    try {
      t.seen.length = 0;
      await act(async () =>
        t.runtime.remount(() => {
          throw new Error('x'.repeat(5000));
        })
      );
      expect(t.seen[0]?.message?.length).toBeLessThanOrEqual(300);
      t.seen.length = 0;
      await act(async () =>
        t.runtime.remount(() => {
          throw 'a string';
        })
      );
      expect(t.seen[0]?.message).toBe('a string');
      t.seen.length = 0;
      await act(async () =>
        t.runtime.remount(() => {
          throw { weird: true };
        })
      );
      expect(typeof t.seen[0]?.message).toBe('string');
      expect(t.seen[0]?.message?.length).toBeGreaterThan(0);
    } finally {
      t.done();
    }
  });
});

describe('the amber toast', () => {
  test('no toast for a render error (the shell card says it) …', async () => {
    const t = await setup();
    try {
      await act(async () =>
        t.runtime.remount(() => {
          throw new Error('boom');
        })
      );
      expect(t.host.querySelector('.dc-hmr-holding')).toBeNull();
    } finally {
      t.done();
    }
  });

  test('… but while a live AI run draws on this canvas the toast stays', async () => {
    const t = await setup();
    try {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window.parent,
            data: {
              dgn: 'ai-runs',
              artboards: { a1: { state: 'running', who: 'You', tag: 'AI is working', waiting: 0 } },
            },
          })
        );
      });
      await act(async () =>
        t.runtime.remount(() => {
          throw new Error('boom');
        })
      );
      expect(t.host.querySelector('.dc-hmr-holding')).not.toBeNull();
      await act(async () => t.runtime.remount(t.good('fixed')));
      expect(t.host.querySelector('.dc-hmr-holding')).toBeNull();
    } finally {
      t.done();
    }
  });
});
