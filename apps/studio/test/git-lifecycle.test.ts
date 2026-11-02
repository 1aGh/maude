// Unit: Task 7 — `.git/HEAD` watcher. We don't exercise fs.watch directly
// (flaky across platforms in CI); instead we drive the module's public
// surface: it gracefully no-ops when no .git/ exists, and the public stop()
// is idempotent.
//
// The flush-before-broadcast invariant is verified separately by the
// collab-bridge tests and the persistence module's contract — registry
// already exposes flushAll(). The integration with .git/HEAD writes is
// exercised manually in the Task 7 acceptance test (Phase 8 plan validate row).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createGitLifecycle } from '../collab/git-lifecycle.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';

function ctxFor(repoRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    paths: {
      repoRoot,
      designRel: '.design',
      designRoot: path.join(repoRoot, '.design'),
      serverInfoFile: '',
      activeFile: '',
      commentsDir: '',
      canvasStateDir: '',
      historyDir: '',
      tokensUrlRel: '',
      systemDirRel: '',
    },
    bus: createBus(),
  };
}

function noopCallbacks(): RoomCallbacks {
  return { async seed() {}, async persistJson() {}, async persistBinary() {} };
}

describe('git-lifecycle', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'maude-git-lifecycle-'));
  });

  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('no .git/ directory → silent no-op (still returns a stop function)', () => {
    const ctx = ctxFor(tmp);
    const registry = createRegistry(noopCallbacks());
    expect(existsSync(path.join(tmp, '.git'))).toBe(false);
    const gl = createGitLifecycle(ctx, registry);
    expect(typeof gl.stop).toBe('function');
    gl.stop(); // idempotent
    gl.stop();
  });

  test('with .git/HEAD present → watcher attaches without throwing', () => {
    mkdirSync(path.join(tmp, '.git'), { recursive: true });
    writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const ctx = ctxFor(tmp);
    const registry = createRegistry(noopCallbacks());
    const gl = createGitLifecycle(ctx, registry);
    expect(typeof gl.stop).toBe('function');
    gl.stop();
  });

  test('emits git-lifecycle bus event on HEAD change (manual rewrite)', async () => {
    mkdirSync(path.join(tmp, '.git'), { recursive: true });
    writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const ctx = ctxFor(tmp);
    const registry = createRegistry(noopCallbacks());
    // V2-3.10: wait for the EVENT, not a clock. A fixed 700 ms sleep raced the fs event +
    // 250 ms debounce + flush under full-suite load (and lost outright when the fs event was
    // dropped — see the next test). Detection is guaranteed by the HEAD poll, so the wait is
    // bounded by the test timeout, not by a guess.
    const first = new Promise<unknown>((resolve) => ctx.bus.on('git-lifecycle', resolve));
    const gl = createGitLifecycle(ctx, registry);

    writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/other\n');
    const evt = (await first) as { reason?: string; head?: string };

    expect(evt.reason).toBe('head-changed');
    expect(evt.head).toContain('refs/heads/other');
    gl.stop();
  });

  // V2-3.10 — the flake's cause: fs.watch on macOS is FSEvents, whose stream starts
  // asynchronously; a HEAD write landing before it is live (a busy process, many watchers) is
  // never reported. Correctness must not depend on that delivery: with NO fs events at all,
  // a HEAD change is still seen (by the content poll), exactly once.
  test('a HEAD change is seen even when no fs event is ever delivered', async () => {
    mkdirSync(path.join(tmp, '.git'), { recursive: true });
    writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const ctx = ctxFor(tmp);
    const registry = createRegistry(noopCallbacks());
    const events: Array<{ head?: string }> = [];
    let resolveFirst: () => void = () => {};
    const first = new Promise<void>((r) => {
      resolveFirst = r;
    });
    ctx.bus.on('git-lifecycle', (e) => {
      events.push(e as { head?: string });
      resolveFirst();
    });
    const gl = createGitLifecycle(ctx, registry, { watchFs: false, pollMs: 20 });

    writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/other\n');
    await first;
    expect(events[0]?.head).toBe('ref: refs/heads/other');
    gl.stop();
    expect(events.length).toBe(1);
  });
});
