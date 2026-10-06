// Smoke: recursive fs.watch fires when a file is written under designRoot.

import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createContext } from '../context.ts';
import { createFsWatch } from '../fs-watch.ts';

describe('fs-watch.ts', () => {
  test('emits fs:html on recursive write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdcc-fswatch-'));
    mkdirSync(join(root, '.design', 'ui', 'nested'), { recursive: true });
    writeFileSync(join(root, '.design', 'config.json'), '{"name":"t"}');

    const origArgv = process.argv;
    process.argv = [...origArgv, '--root', root];
    let watch: ReturnType<typeof createFsWatch> | null = null;
    try {
      const ctx = createContext();
      watch = createFsWatch(ctx);

      const seen: string[] = [];
      ctx.bus.on('fs:html', (file) => seen.push(String(file)));

      watch.start();
      // give the watcher a moment to register.
      await Bun.sleep(80);

      const target = join(root, '.design', 'ui', 'nested', 'evt.html');
      writeFileSync(target, '<doc>1</doc>');
      await Bun.sleep(250);

      expect(seen.some((f) => f.endsWith('evt.html'))).toBe(true);
    } finally {
      watch?.stop();
      process.argv = origArgv;
    }
  });

  // #119 — the bridge appends to `_chat/` on every streamed update, so each
  // chunk of an agent turn used to raise an `fs:any` that woke
  // canvas-list-watch, the activity tracker and gitWatch (running git status
  // against the whole repo) for a file none of them can act on.
  test('suppresses high-volume runtime dirs but KEEPS _comments (collab needs it)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdcc-fswatch-'));
    mkdirSync(join(root, '.design', '_chat'), { recursive: true });
    mkdirSync(join(root, '.design', '_trash'), { recursive: true });
    mkdirSync(join(root, '.design', '_comments'), { recursive: true });
    mkdirSync(join(root, '.design', 'ui'), { recursive: true });
    writeFileSync(join(root, '.design', 'config.json'), '{"name":"t"}');

    const origArgv = process.argv;
    process.argv = [...origArgv, '--root', root];
    let watch: ReturnType<typeof createFsWatch> | null = null;
    try {
      const ctx = createContext();
      watch = createFsWatch(ctx);
      const seen: string[] = [];
      ctx.bus.on('fs:any', (file) => seen.push(String(file)));
      watch.start();
      await Bun.sleep(80);

      // Spaced, not back-to-back: Bun 1.3.x's recursive watcher on Linux
      // delivers only the first of several inotify events read in one batch
      // (fixed in 1.4), so a burst of four writes reached the callback as one
      // and this test measured Bun's batching instead of the skip list.
      const writes: [string[], string][] = [
        [['_chat', 'c-1.jsonl'], '{"ts":1}\n'],
        [['_trash', 'gone.tsx'], 'x'],
        [['_comments', 'ui-Pricing.json'], '[]'],
        [['ui', 'Real.tsx'], 'x'],
      ];
      for (const [parts, body] of writes) {
        writeFileSync(join(root, '.design', ...parts), body);
        await Bun.sleep(40);
      }

      // Wait for the events that MUST arrive rather than for a fixed delay —
      // a machine under parallel test load misses a flat 300 ms and turns this
      // into a phantom failure. Once both expected events have landed, any
      // suppressed sibling written in the same batch has had at least as long
      // to arrive, so the negative assertions below are meaningful.
      const deadline = Date.now() + 5000;
      while (
        Date.now() < deadline &&
        !(seen.some((f) => f.endsWith('Real.tsx')) && seen.some((f) => f.includes('_comments')))
      ) {
        await Bun.sleep(25);
      }
      await Bun.sleep(150); // grace for a straggler we would want to CATCH

      // Neither the file event NOR the bare-directory event macOS raises
      // alongside it: the directory form is what actually reached subscribers
      // on every streamed ACP append.
      expect(seen.filter((f) => f.includes('_chat'))).toEqual([]);
      expect(seen.filter((f) => f.includes('_trash'))).toEqual([]);
      // POINTEDLY still emitted: collab/index.ts matches `^_comments/…\.json$`
      // on this bus, and git/watch.ts treats it as versionable. Routing this
      // skip list through the sync runtime-state taxonomy (which DOES exclude
      // `_comments/`) would silently kill comment collaboration.
      expect(seen.some((f) => f.includes('_comments'))).toBe(true);
      expect(seen.some((f) => f.endsWith('Real.tsx'))).toBe(true);
    } finally {
      watch?.stop();
      process.argv = origArgv;
    }
  });
});

// 2026-10-02, Brno Alligators: Bun's recursive watcher on Linux emitted
// ENOENT while walking the tenant tree, nobody listened for 'error', the
// throw exited the cell's studio child — 9 restarts in minutes — and the file
// tree's /_index-data died with it ("0 / 0 canvases"). Reproduced in the
// v1.6.1 image; this pins the fix with a watcher that errors on demand.
describe('fs-watch.ts — a watcher error never takes the studio down', () => {
  test('an error is caught, the watcher closed, and restarted with backoff', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdcc-fswatch-'));
    mkdirSync(join(root, '.design'), { recursive: true });
    writeFileSync(join(root, '.design', 'config.json'), '{"name":"t"}');
    const origArgv = process.argv;
    process.argv = [...origArgv, '--root', root];
    const created: (EventEmitter & { close(): void; closed?: boolean })[] = [];
    const fakeWatch = (() => {
      const w = Object.assign(new EventEmitter(), {
        close() {
          (w as { closed?: boolean }).closed = true;
        },
      });
      created.push(w);
      return w;
    }) as unknown as typeof import('node:fs').watch;
    let fw: ReturnType<typeof createFsWatch> | null = null;
    try {
      fw = createFsWatch(createContext(), fakeWatch);
      fw.start();
      expect(created).toHaveLength(1);
      // Without a listener this emit THROWS — the crash, in one line.
      expect(() =>
        created[0]?.emit(
          'error',
          Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
        )
      ).not.toThrow();
      expect(created[0]?.closed).toBe(true);
      await Bun.sleep(2_200); // RESTART_MIN_MS
      expect(created).toHaveLength(2);
    } finally {
      fw?.stop();
      process.argv = origArgv;
    }
  });
});
