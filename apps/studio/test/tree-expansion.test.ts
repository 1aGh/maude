// Issue #124 — the Files tree is collapsed by default and remembers what the
// user expanded. Covers the pure disclosure helpers (client/tree-expansion.js),
// the App-level hook's hydrate/persist contract, the server-side shape guard
// (tree-state.ts), and the /_api/tree-state round-trip on a real server.
// RCA: .ai/logs/rca/issue-124.md

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import {
  collectDirPaths,
  EMPTY_TREE_STATE,
  isDirOpen,
  isSectionOpen,
  LEGACY_SECTIONS_STORE,
  pruneDirs,
  remapDirPrefix,
  revealPath,
  setDirOpen,
  toggleDir,
  toggleSection,
  useTreeExpansion,
} from '../client/tree-expansion.js';
import { normalizeTreeState, TREE_STATE_MAX_DIRS } from '../tree-state.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const GROUPS = [
  {
    label: 'UI',
    fullPath: '.design/ui',
    tree: { a: { b: { _files: [] }, _files: [] }, ab: { _files: [] }, _files: [] },
  },
  { label: 'Design system', fullPath: '.design/system', tree: { ds: { preview: {} } } },
];

describe('tree-expansion — pure helpers', () => {
  test('everything is closed by default (folders and sections)', () => {
    expect(isDirOpen(EMPTY_TREE_STATE, '.design/ui/a')).toBe(false);
    expect(isSectionOpen(EMPTY_TREE_STATE, 'UI')).toBe(false);
  });

  test('toggle / set are idempotent and immutable', () => {
    const s1 = toggleDir(EMPTY_TREE_STATE, '.design/ui/a');
    expect(isDirOpen(s1, '.design/ui/a')).toBe(true);
    expect(isDirOpen(EMPTY_TREE_STATE, '.design/ui/a')).toBe(false);
    expect(setDirOpen(s1, '.design/ui/a', true)).toBe(s1);
    expect(isDirOpen(toggleDir(s1, '.design/ui/a'), '.design/ui/a')).toBe(false);
    const s2 = toggleSection(EMPTY_TREE_STATE, 'UI');
    expect(isSectionOpen(s2, 'UI')).toBe(true);
    expect(isSectionOpen(toggleSection(s2, 'UI'), 'UI')).toBe(false);
  });

  test('revealPath opens the section and every ancestor folder, not the file', () => {
    const s = revealPath(EMPTY_TREE_STATE, GROUPS, '.design/ui/a/b/Card.tsx');
    expect(isSectionOpen(s, 'UI')).toBe(true);
    expect(s.dirs).toEqual(['.design/ui/a', '.design/ui/a/b']);
    expect(isSectionOpen(s, 'Design system')).toBe(false);
  });

  test('revealPath includeSelf opens a folder target itself; a group root opens just the section', () => {
    expect(
      revealPath(EMPTY_TREE_STATE, GROUPS, '.design/ui/a', { includeSelf: true }).dirs
    ).toEqual(['.design/ui/a']);
    const root = revealPath(EMPTY_TREE_STATE, GROUPS, '.design/ui', { includeSelf: true });
    expect(root.dirs).toEqual([]);
    expect(isSectionOpen(root, 'UI')).toBe(true);
    // Outside every group → unchanged.
    expect(revealPath(EMPTY_TREE_STATE, GROUPS, 'elsewhere/x.tsx')).toBe(EMPTY_TREE_STATE);
  });

  test('remapDirPrefix carries a folder and its subfolders, not a same-prefix sibling', () => {
    const s = { dirs: ['.design/ui/a', '.design/ui/a/b', '.design/ui/ab'], sections: {} };
    const r = remapDirPrefix(s, '.design/ui/a', '.design/ui/z');
    expect(r.dirs).toEqual(['.design/ui/ab', '.design/ui/z', '.design/ui/z/b']);
    // A file move matches no folder key → same object back.
    expect(remapDirPrefix(s, '.design/ui/a/Card.tsx', '.design/ui/Card.tsx')).toBe(s);
  });

  test('pruneDirs drops folders that no longer exist', () => {
    const known = collectDirPaths(GROUPS);
    expect(known.has('.design/ui/a/b')).toBe(true);
    expect(known.has('.design/system/ds/preview')).toBe(true);
    const s = { dirs: ['.design/ui/a', '.design/ui/gone'], sections: {} };
    expect(pruneDirs(s, known).dirs).toEqual(['.design/ui/a']);
  });
});

describe('tree-state.ts — server shape guard', () => {
  test('keeps well-typed values, drops the rest, bounds the size', () => {
    const n = normalizeTreeState({
      dirs: ['b', 'a', 'a', 7, '', 'x\0y', 'z'.repeat(2000)],
      sections: { UI: true, Bad: 'yes', __proto__: true },
      extra: 1,
    });
    expect(n).toEqual({ dirs: ['a', 'b'], sections: { UI: true } });
    expect(normalizeTreeState(null)).toEqual({ dirs: [], sections: {} });
    const many = Array.from({ length: TREE_STATE_MAX_DIRS + 50 }, (_, i) => `d${i}`);
    expect(normalizeTreeState({ dirs: many }).dirs.length).toBe(TREE_STATE_MAX_DIRS);
  });
});

describe('useTreeExpansion — hydrate + persist', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(stored: unknown) {
    const posts: unknown[] = [];
    const fetchImpl = async (_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(init.body || 'null'));
        return new Response('{}');
      }
      return Response.json(stored);
    };
    let api: ReturnType<typeof useTreeExpansion> | null = null;
    function Probe() {
      api = useTreeExpansion({ fetchImpl });
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    return {
      get api(): ReturnType<typeof useTreeExpansion> {
        if (!api) throw new Error('Probe never rendered');
        return api;
      },
      posts,
      root,
    };
  }

  test('restores the stored tree and does not write it straight back', async () => {
    const m = await mount({ dirs: ['.design/ui/a'], sections: { UI: true } });
    try {
      expect(m.api.ready).toBe(true);
      expect(isDirOpen(m.api.state, '.design/ui/a')).toBe(true);
      await act(async () => new Promise((r) => setTimeout(r, 400)));
      expect(m.posts).toEqual([]);
    } finally {
      await act(async () => m.root.unmount());
    }
  });

  test('a change after hydration is persisted (debounced)', async () => {
    const m = await mount({ dirs: [], sections: {} });
    try {
      await act(async () => m.api.update((s) => toggleDir(s, '.design/ui/a')));
      await act(async () => new Promise((r) => setTimeout(r, 400)));
      expect(m.posts).toEqual([{ dirs: ['.design/ui/a'], sections: {} }]);
    } finally {
      await act(async () => m.root.unmount());
    }
  });

  test('a stalled read gives up and renders the tree all-closed', async () => {
    let api: ReturnType<typeof useTreeExpansion> | null = null;
    const fetchImpl = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    function Probe() {
      api = useTreeExpansion({ fetchImpl });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe)));
    try {
      expect(api?.ready).toBe(false);
      await act(async () => new Promise((r) => setTimeout(r, 3200)));
      expect(api?.ready).toBe(true);
      expect(api?.state).toEqual(EMPTY_TREE_STATE);
    } finally {
      await act(async () => root.unmount());
    }
  }, 10_000);

  test('seeds sections from the pre-#124 localStorage key when disk has none', async () => {
    localStorage.setItem(LEGACY_SECTIONS_STORE, JSON.stringify({ UI: true, PROJECT: false }));
    try {
      const m = await mount({ dirs: [], sections: {} });
      try {
        expect(m.api.state.sections).toEqual({ UI: true, PROJECT: false });
      } finally {
        await act(async () => m.root.unmount());
      }
    } finally {
      localStorage.removeItem(LEGACY_SECTIONS_STORE);
    }
  });
});

describe('/_api/tree-state — HTTP round-trip', () => {
  test('empty by default; POST persists under _canvas-state; junk is rejected or cleaned', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    const base = `http://localhost:${port}/_api/tree-state`;
    try {
      expect(await (await fetch(base)).json()).toEqual({ dirs: [], sections: {} });

      const post = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: `http://localhost:${port}` },
        body: JSON.stringify({ dirs: ['.design/ui/a', 5], sections: { UI: true } }),
      });
      expect(post.status).toBe(200);
      expect(await (await fetch(base)).json()).toEqual({
        dirs: ['.design/ui/a'],
        sections: { UI: true },
      });

      // Attacker review F1 — the older, unguarded /_canvas-state route builds
      // `_canvas-state/<fileSlug(file)>.json` from user input. The tree state
      // must live at a name no slug can produce, or that route reads/writes it
      // without this route's host + origin guards.
      const viaLegacy = await (
        await fetch(`http://localhost:${port}/_canvas-state?file=_file-tree`)
      ).json();
      expect(viaLegacy).not.toHaveProperty('dirs');

      const file = join(designRoot, '_canvas-state', '_tree', 'state.json');
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8')).dirs).toEqual(['.design/ui/a']);

      const bad = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: `http://localhost:${port}` },
        body: '[1,2]',
      });
      expect(bad.status).toBe(400);
      const cross = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
        body: '{}',
      });
      expect(cross.status).toBe(403);
    } finally {
      await killProc(proc);
    }
  });
});

// Source tripwire — the regression itself lived in app.jsx (too large to mount
// in a unit test): folder rows seeded `useState(defaultOpen)` from a hard-coded
// `defaultOpen={true}`, and sections defaulted open. Pin the controlled shape.
describe('app.jsx — tree rows are controlled and default closed', () => {
  const app = readFileSync(new URL('../client/app.jsx', import.meta.url), 'utf8');
  const fnBody = (name: string) => {
    const start = app.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return app.slice(start, app.indexOf('\nfunction ', start + 1));
  };

  test('no folder row is hard-coded open', () => {
    expect(app).not.toContain('defaultOpen={true}');
  });

  test('DirRow / DsFolderRow hold no local disclosure state', () => {
    for (const name of ['DirRow', 'DsFolderRow']) {
      const body = fnBody(name);
      expect(body).not.toMatch(/useState\(defaultOpen\)/);
      expect(body).toContain('expansion?.isOpen(dirPath)');
    }
  });

  test('every section defaults closed', () => {
    expect(fnBody('sectionDefaultOpen')).toMatch(/return false;\s*\}/);
    expect(fnBody('sectionDefaultOpen')).not.toContain('return true');
  });
});
