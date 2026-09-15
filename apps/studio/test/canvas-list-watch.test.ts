// canvas-list-watch — external-canvas list watcher. Emits `canvas-list-update`
// when a canvas file appears/disappears on disk from OUTSIDE the dev-server
// (the ACP agent's `/design:new`, agent Write, git checkout), so the browser
// file tree refreshes without a reload.
// RCA: .ai/logs/rca/issue-acp-new-canvas-not-in-filetree.md

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CANVAS_LIST_DEBOUNCE_MS,
  createCanvasListWatch,
  isCanvasCandidate,
} from '../canvas-list-watch.ts';
import { type Context, createBus } from '../context.ts';
import { createFsWatch } from '../fs-watch.ts';

const GROUPS = [
  { label: 'System', path: 'system' },
  { label: 'UI', path: 'ui' },
];

function sandbox(): { root: string; designRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'clw-test-'));
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  return { root, designRoot };
}

function mkCtx(designRoot: string): Context {
  return {
    cfg: { canvasGroups: GROUPS } as Context['cfg'],
    projectLabel: '',
    paths: { designRoot, designRel: '.design' } as Context['paths'],
    bus: createBus(),
  };
}

const TSX = 'export default function C(){return null}';

interface Update {
  action?: string;
  rel?: string;
  slug?: string;
}

function collect(ctx: Context): Update[] {
  const got: Update[] = [];
  ctx.bus.on('canvas-list-update', (p) => got.push(p as Update));
  return got;
}

describe('canvas-list-watch / isCanvasCandidate (pure gate)', () => {
  const groups = ['system', 'ui'];
  test('accepts openable canvases under a configured group', () => {
    expect(isCanvasCandidate('ui/Pricing.tsx', groups)).toBe(true);
    expect(isCanvasCandidate('ui/project/Pricing.tsx', groups)).toBe(true);
    expect(isCanvasCandidate('ui/Smoke.html', groups)).toBe(true);
    // DS preview specimens DO show in the tree, so they must trigger a refresh.
    expect(isCanvasCandidate('system/project/preview/colors.tsx', groups)).toBe(true);
  });

  test('rejects non-canvas extensions (sidecars, tokens, docs)', () => {
    expect(isCanvasCandidate('ui/Pricing.meta.json', groups)).toBe(false);
    expect(isCanvasCandidate('ui/Pricing.css', groups)).toBe(false);
    expect(isCanvasCandidate('system/project/README.md', groups)).toBe(false);
  });

  test('accepts the supporting files the tree lists (images, fonts, media)', () => {
    expect(isCanvasCandidate('ui/Notes.png', groups)).toBe(true);
    expect(isCanvasCandidate('ui/brand/logo.svg', groups)).toBe(true);
    expect(isCanvasCandidate('ui/_drafts/Notes.png', groups)).toBe(false);
    expect(isCanvasCandidate('docs/Notes.png', groups)).toBe(false);
  });

  test('rejects runtime-state (`_`-prefixed segment) + SKIP_DIRS', () => {
    expect(isCanvasCandidate('_history/ui-x/00-screen.tsx', groups)).toBe(false);
    expect(isCanvasCandidate('ui/_draft.tsx', groups)).toBe(false);
    expect(isCanvasCandidate('_active.json', groups)).toBe(false);
    expect(isCanvasCandidate('node_modules/pkg/index.tsx', groups)).toBe(false);
  });

  // Renaming or moving a folder from Finder / `mv` / a `git checkout` names the
  // DIRECTORY, and that event used to be dropped here — so the tree kept showing
  // the old folder and every canvas inside it silently stopped syncing (its
  // descriptor pointed at a path that no longer existed) until an unrelated
  // `.tsx` write happened to nudge the same recompute.
  test('accepts a directory under a group — a folder rename is a list change', () => {
    expect(isCanvasCandidate('ui/dbox2', groups)).toBe(true);
    expect(isCanvasCandidate('ui/2026/social', groups)).toBe(true);
    expect(isCanvasCandidate('system', groups)).toBe(true);
  });

  test('a directory still obeys every other rule', () => {
    expect(isCanvasCandidate('ui/_drafts', groups)).toBe(false);
    expect(isCanvasCandidate('node_modules/pkg', groups)).toBe(false);
    expect(isCanvasCandidate('docs/whatever', groups)).toBe(false);
  });

  test('rejects canvases outside any configured group', () => {
    expect(isCanvasCandidate('docs/Thing.tsx', groups)).toBe(false);
    expect(isCanvasCandidate('Thing.tsx', groups)).toBe(false);
  });

  test('non-string / empty input is rejected, not thrown', () => {
    expect(isCanvasCandidate('', groups)).toBe(false);
    expect(isCanvasCandidate(undefined as unknown as string, groups)).toBe(false);
  });
});

describe('canvas-list-watch / diff + emit', () => {
  test('seeding existing canvases emits nothing', async () => {
    const { root, designRoot } = sandbox();
    writeFileSync(join(designRoot, 'ui', 'Existing.tsx'), TSX);
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      expect(got).toHaveLength(0);
      expect(w.known.has('.design/ui/Existing.tsx')).toBe(true);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a canvas written straight to disk emits action:added (the bug)', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      // Simulate `/design:new` writing the canvas (and its sidecar) directly —
      // NO API call, so api.ts never emits.
      writeFileSync(join(designRoot, 'ui', 'Pricing.tsx'), TSX);
      writeFileSync(join(designRoot, 'ui', 'Pricing.meta.json'), '{}');
      await w.refresh();
      expect(got).toHaveLength(1);
      expect(got[0]?.action).toBe('added');
      expect(got[0]?.slug).toBe('ui-pricing');
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('deleting a canvas on disk emits action:removed', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      const abs = join(designRoot, 'ui', 'Gone.tsx');
      writeFileSync(abs, TSX);
      await w.refresh();
      got.length = 0; // drop the 'added'
      rmSync(abs);
      await w.refresh();
      expect(got).toHaveLength(1);
      expect(got[0]?.action).toBe('removed');
      expect(got[0]?.slug).toBe('ui-gone');
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('editing an existing canvas body emits nothing (no tree thrash)', async () => {
    const { root, designRoot } = sandbox();
    const abs = join(designRoot, 'ui', 'Edited.tsx');
    writeFileSync(abs, TSX);
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      writeFileSync(abs, `${TSX}\n// edited`);
      writeFileSync(join(designRoot, 'ui', 'Edited.meta.json'), '{"x":1}');
      await w.refresh();
      expect(got).toHaveLength(0);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Plan T17/L03 — an image written beside the canvases (an agent's export, a
  // teammate's file arriving through sync) never reached the tree, not even on
  // the machine that wrote it, until something else reloaded it.
  test('a supporting image appearing or leaving is a tree change of its own kind', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      const abs = join(designRoot, 'ui', 'Notes.png');
      writeFileSync(abs, 'png');
      ctx.bus.emit('fs:any', 'ui/Notes.png');
      await new Promise((r) => setTimeout(r, 10 + 40));
      await w.refresh();
      expect(got).toEqual([{ action: 'file-added', rel: 'ui/Notes.png' }]);
      got.length = 0;
      rmSync(abs);
      await w.refresh();
      expect(got).toEqual([{ action: 'file-removed', rel: 'ui/Notes.png' }]);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('runtime-state + sidecar writes never emit', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      writeFileSync(join(designRoot, '_active.json'), '{}');
      mkdirSync(join(designRoot, '_canvas-state'), { recursive: true });
      writeFileSync(join(designRoot, '_canvas-state', 'ui-x.view.json'), '{}');
      writeFileSync(join(designRoot, 'config.json'), '{}');
      await w.refresh();
      expect(got).toHaveLength(0);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('canvas-list-watch / live fs:any path', () => {
  test('a candidate fs:any event schedules a debounced refresh that emits', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 20 });
    await w.ready;
    try {
      writeFileSync(join(designRoot, 'ui', 'Live.tsx'), TSX);
      // The fs-watch would emit this; assert the subscriber wires through.
      ctx.bus.emit('fs:any', 'ui/Live.tsx');
      await new Promise((r) => setTimeout(r, 20 + 80));
      await w.refresh(); // flush the chain
      const added = got.find((m) => m.action === 'added' && m.slug === 'ui-live');
      expect(added).toBeTruthy();
      // Exactly one 'added' — the timer + the explicit flush must not double-emit.
      expect(got.filter((m) => m.action === 'added' && m.slug === 'ui-live')).toHaveLength(1);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a non-candidate fs:any event does not schedule a refresh', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 20 });
    await w.ready;
    try {
      // Create a canvas but only announce a NON-candidate path. The gate must
      // skip the recompute, so the new canvas stays unseen until a real event.
      writeFileSync(join(designRoot, 'ui', 'Sneaky.tsx'), TSX);
      ctx.bus.emit('fs:any', 'ui/Sneaky.meta.json');
      ctx.bus.emit('fs:any', '_active.json');
      await new Promise((r) => setTimeout(r, 20 + 80));
      expect(got).toHaveLength(0);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stop() unsubscribes — later events are ignored', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    w.stop();
    try {
      writeFileSync(join(designRoot, 'ui', 'After.tsx'), TSX);
      ctx.bus.emit('fs:any', 'ui/After.tsx');
      await new Promise((r) => setTimeout(r, CANVAS_LIST_DEBOUNCE_MS + 40));
      expect(got).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('canvas-list-watch / serialization + multi-remove', () => {
  test('overlapping refresh() calls serialize — a create between them emits exactly once', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      writeFileSync(join(designRoot, 'ui', 'Pair.tsx'), TSX);
      // Fire two refreshes WITHOUT awaiting the first. The promise-chain must
      // serialize them: the first diffs the create against the pre-create set
      // and updates `known`; the second sees no change. Without the chain both
      // would snapshot concurrently against the stale `known` and emit twice.
      const a = w.refresh();
      const b = w.refresh();
      await Promise.all([a, b]);
      expect(got.filter((m) => m.action === 'added' && m.slug === 'ui-pair')).toHaveLength(1);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('removing a whole group subdir emits one removed per canvas (git-checkout shape)', async () => {
    const { root, designRoot } = sandbox();
    mkdirSync(join(designRoot, 'ui', 'project'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'project', 'A.tsx'), TSX);
    writeFileSync(join(designRoot, 'ui', 'project', 'B.tsx'), TSX);
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      rmSync(join(designRoot, 'ui', 'project'), { recursive: true, force: true });
      await w.refresh();
      const removed = got.filter((m) => m.action === 'removed').map((m) => m.slug);
      expect(removed.sort()).toEqual(['ui-project-a', 'ui-project-b']);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('canvas-list-watch / real fs-watch end-to-end', () => {
  test('a raw disk write through createFsWatch emits added (the actual bug path)', async () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(designRoot);
    const got = collect(ctx);
    const fsWatch = createFsWatch(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 30 });
    await w.ready;
    fsWatch.start();
    try {
      // Let the OS watcher arm, then write straight to disk — NO manual bus
      // emit. This exercises the genuine ACP-agent path: disk write →
      // fs.watch → fs:any → gate → debounce → snapshot diff → canvas-list-update.
      await new Promise((r) => setTimeout(r, 60));
      writeFileSync(join(designRoot, 'ui', 'Real.tsx'), TSX);
      const deadline = Date.now() + 3000;
      while (
        Date.now() < deadline &&
        !got.some((m) => m.action === 'added' && m.slug === 'ui-real')
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(got.some((m) => m.action === 'added' && m.slug === 'ui-real')).toBe(true);
    } finally {
      fsWatch.stop();
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);
});

describe('canvas-list-watch / config hot-reload (stale-config RCA)', () => {
  // /design:setup-ds adds the `system` group to config.json mid-session;
  // reloadConfig (context.ts) swaps ctx.cfg in place. The watcher must read
  // groups at USE time — a boot-captured groupPaths list would keep gating
  // the new group's files out forever.
  // RCA: .ai/logs/rca/issue-ds-scaffold-files-not-in-filetree-stale-config.md
  test('a group added by an in-place cfg swap uncovers its canvases', async () => {
    const { root, designRoot } = sandbox();
    mkdirSync(join(designRoot, 'system', 'kanban-glass', 'preview'), { recursive: true });
    const ctx = mkCtx(designRoot);
    // Pre-scaffold fixture shape: UI-only group.
    ctx.cfg.canvasGroups = [{ label: 'UI', path: 'ui' }];
    const got = collect(ctx);
    const w = createCanvasListWatch(ctx, { debounceMs: 10 });
    await w.ready;
    try {
      // Scaffold writes specimens while the group is still absent — no emit.
      writeFileSync(join(designRoot, 'system', 'kanban-glass', 'preview', 'colors.tsx'), TSX);
      ctx.bus.emit('fs:any', 'system/kanban-glass/preview/colors.tsx');
      await new Promise((r) => setTimeout(r, 10 + 40));
      await w.refresh();
      expect(got).toHaveLength(0);

      // Hot reload: new array on the SAME cfg object (what reloadConfig does),
      // then the server.ts subscriber calls refresh() — the diff must surface
      // the pre-existing specimen.
      ctx.cfg.canvasGroups = [
        { label: 'Design system', path: 'system' },
        { label: 'UI', path: 'ui' },
      ];
      await w.refresh();
      expect(got).toHaveLength(1);
      expect(got[0]?.action).toBe('added');
      expect(got[0]?.rel).toBe('system/kanban-glass/preview/colors.tsx');

      // And FUTURE writes under the new group pass the live fs:any gate.
      got.length = 0;
      writeFileSync(join(designRoot, 'system', 'kanban-glass', 'preview', 'type.tsx'), TSX);
      ctx.bus.emit('fs:any', 'system/kanban-glass/preview/type.tsx');
      await new Promise((r) => setTimeout(r, 10 + 40));
      await w.refresh();
      expect(got.some((m) => m.action === 'added' && m.rel?.endsWith('type.tsx'))).toBe(true);
    } finally {
      w.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
