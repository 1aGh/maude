// S9.10 — access/filters.ts, pure. U7: for every project-role session (owner, member, viewer,
// observer) each filter answers its input UNCHANGED — the very same object, so a v1 body is
// byte-identical. Canvas-only: the U4 subject, the U5 counts, the export verdict.

import { describe, expect, test } from 'bun:test';

import type { Closure } from '../access/closure.ts';
import {
  canvasOnlyLogPaths,
  changedSubject,
  diffRefusal,
  exportTargetVerdict,
  filterAcceptedHistory,
  filterCommentsAll,
  filterConfig,
  filterGitDiff,
  filterIndexData,
  filterIndexSearch,
  filterIndexSnapshot,
  filterSystemData,
  mergeCanvasOnlyLog,
  visibilityOf,
} from '../access/filters.ts';
import { resolveAccess } from '../access/scope.ts';
import type { ProjectIndexSnapshot } from '../index/types.ts';

const closure = (read: string[], owned: Record<string, string>): Closure =>
  ({
    head: '0',
    owned: new Set(Object.keys(owned)),
    ownedBy: new Map(Object.entries(owned)),
    read: new Set(read),
    assetUsers: new Map(),
    assetStems: new Set(),
    dynamic: new Set(),
  }) as Closure;

const A_CLOSURE = closure(['ui/a.tsx', 'ui/a.meta.json', 'system/shared/tokens.css'], {
  'ui/a.tsx': 'ui/a.tsx',
  'ui/a.meta.json': 'ui/a.tsx',
});
const aOnly = (r: 'observer' | 'viewer' | 'member' = 'member') =>
  visibilityOf(
    resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r }] }),
    () => A_CLOSURE
  );
const DS = [
  { name: 'shared', path: 'system/shared' },
  { name: 'secret', path: 'system/secret' },
];

describe('U7 — a project-role session gets its input back unchanged', () => {
  for (const role of ['owner', 'member', 'viewer', 'observer'] as const) {
    test(role, () => {
      const vis = visibilityOf(resolveAccess({ v: 1, role }));
      const index = { groups: [], canvasDesignSystems: {}, canvasKinds: {} };
      expect(filterIndexData(index, vis, '.design', DS)).toBe(index);
      const cfg = { canvasGroups: [{ label: 'UI', path: 'ui' }], newCanvasDir: 'ui' };
      expect(filterConfig(cfg, vis, DS)).toBe(cfg);
      const comments = { '.design/ui/b.tsx': [] };
      expect(filterCommentsAll(comments, vis, '.design')).toBe(comments);
      const snap = { canvases: [] } as unknown as ProjectIndexSnapshot;
      expect(filterIndexSnapshot(snap, vis)).toBe(snap);
      const search = { q: 'x', rows: [], closeOnly: false };
      expect(filterIndexSearch(search, vis)).toBe(search);
      const sys = { ds: null } as unknown as Parameters<typeof filterSystemData>[0];
      expect(filterSystemData(sys, vis, '.design', DS, null)).toBe(sys);
      expect(canvasOnlyLogPaths(vis, null, '.design')).toBeNull();
      const diff = [{ file: '.design/ui/b.tsx' }];
      expect(filterGitDiff(diff, vis, '.design')).toEqual(diff);
      const rows = [{ label: 'design: update 2 canvases', canvases: ['.design/ui/b.tsx'] }];
      expect(filterAcceptedHistory(rows, vis, '.design')).toEqual(rows);
    });
  }
});

describe('canvas-only', () => {
  test('U4 — subjects come from visible canvases only', () => {
    expect(changedSubject(['ui/2026/Combine-kampan.tsx'])).toBe('Changed Combine-kampan');
    expect(changedSubject(['ui/b.tsx', 'ui/a.meta.json', 'ui/a.tsx'])).toBe('Changed a, b');
    const merged = mergeCanvasOnlyLog(
      [
        {
          canvas: 'ui/a.tsx',
          entries: [
            {
              sha: 's1',
              message: 'design: update 2 canvases',
              author: 'T',
              email: 't@x',
              date: '2',
            },
          ],
        },
        {
          canvas: 'ui/a.tsx',
          entries: [
            {
              sha: 's1',
              message: 'design: update 2 canvases',
              author: 'T',
              email: 't@x',
              date: '2',
            },
            { sha: 's0', message: 'old', author: 'T', email: 't@x', date: '1' },
          ],
        },
      ],
      30
    );
    expect(merged.map((e) => [e.sha, e.message, e.email])).toEqual([
      ['s1', 'Changed a', ''],
      ['s0', 'Changed a', ''],
    ]);
    const hist = filterAcceptedHistory(
      [
        { label: 'Renamed B', canvases: ['.design/ui/b.tsx'] },
        { label: 'Moved B into A', canvases: ['.design/ui/a.tsx', '.design/ui/b.tsx'] },
      ],
      aOnly(),
      '.design'
    );
    expect(hist).toEqual([{ label: 'Changed a', canvases: ['.design/ui/a.tsx'] }]);
  });

  test('U5 — index counts come from the visible rows', () => {
    const row = (rel: string, n: number) => ({
      rel,
      ds: 'shared',
      kind: 'canvas',
      mtimeMs: n,
      srcHash: rel,
      metaHash: null,
      artboardsFrom: 'static',
      artboards: Array.from({ length: n }, (_, i) => ({ id: `${i}`, kind: 'web' })),
    });
    const snap = {
      project: { linkedHub: { url: 'https://hub' } },
      writer: { seq: 9 },
      access: { scope: 'full', epoch: 0 },
      canvases: [row('ui/a.tsx', 2), row('ui/b.tsx', 5)],
    } as unknown as ProjectIndexSnapshot;
    const out = filterIndexSnapshot(snap, aOnly());
    expect(out.counts).toEqual({ canvases: 1, artboards: 2, byKind: { web: 2 } });
    expect(out.canvases.map((c) => c.rel)).toEqual(['ui/a.tsx']);
    expect(out.writer.seq).not.toBe(9);
    // B's row changing does not move the derived seq.
    const moved = { ...snap, canvases: [row('ui/a.tsx', 2), row('ui/b.tsx', 7)] };
    expect(filterIndexSnapshot(moved as ProjectIndexSnapshot, aOnly()).writer.seq).toBe(
      out.writer.seq
    );
  });

  test('L7 — the export verdict', () => {
    expect(exportTargetVerdict(aOnly(), 'canvas-whole', ['.design/ui/a.tsx'], '.design')).toBe(
      'ok'
    );
    expect(exportTargetVerdict(aOnly(), 'canvas-whole', ['.design/ui/b.tsx'], '.design')).toBe(
      'not-in-scope'
    );
    expect(exportTargetVerdict(aOnly(), 'project-raw', [], '.design')).toBe('not-in-scope');
    expect(
      exportTargetVerdict(aOnly('observer'), 'canvas-whole', ['.design/ui/a.tsx'], '.design')
    ).toBe('capability');
    expect(diffRefusal(aOnly('observer'))).toBe('capability');
    expect(diffRefusal(aOnly())).toBeNull();
  });

  test('L8 — config and DS', () => {
    const cfg = filterConfig(
      {
        canvasGroups: [{ label: 'UI', path: 'ui' }],
        designSystems: DS,
        defaultDesignSystem: 'secret',
        newCanvasDir: 'ui',
        linkedHub: { url: 'x' },
      },
      aOnly(),
      DS
    );
    expect(cfg).toEqual({
      canvasGroups: [],
      designSystems: [DS[0]],
      defaultDesignSystem: 'shared',
    } as unknown as typeof cfg);
  });
});
