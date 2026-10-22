// gate-b-c4g — ethical-hacker round 3 on C4 (unit halves; booted halves in c4e-frame-leaks):
//   1   a directory import inside the design root that a `package.json` (`main` / `browser` /
//       `exports`) redirects outside it is refused by the build, and `inputsRefusal` refuses any
//       inlined file that is neither in the design root nor in Maude's own module roots;
//   2   a meta-less canvas is a canvas (the index's own predicate) — not a helper to inline;
//   3   slug twins share no slug-keyed sidecar through the closure; the studio guard refuses them;
//   4   `inputsRefusal` reads only `..` / `..<sep>` as "outside" (a `..foo` folder is inside);
//   M2  an input list that does not name the canvas fails closed (in-process and sandbox);
//   L2  the frame key path is asserted outside the design root and the repo.

import { describe, expect, spyOn, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { closureFor, type ProjectReader } from '../access/closure.ts';
import { inputsRefusal, loadFrameSecret, narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { buildCanvasModule } from '../canvas-build.ts';
import { buildCanvasSandboxed } from '../canvas-build-sandbox.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { DEV_SERVER_ROOT } from '../paths.ts';
import { isCanvasRelInGroups } from '../skip-dirs.ts';
import { findCloseName } from '../sync-name-key.ts';
import { makeSandbox } from './_helpers.ts';

function sandboxWith(files: Record<string, string>) {
  const { root, designRoot } = makeSandbox();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  // The file a redirect aims at: beside the design root, never inside it.
  writeFileSync(join(root, 'outside-secret.txt'), 'SECRET-OUTSIDE\n');
  return { root, designRoot };
}

async function buildOutcome(designRoot: string, src: string) {
  const abs = join(designRoot, 'ui', 'leak.tsx');
  writeFileSync(abs, src);
  try {
    const r = await buildCanvasModule(abs, src, { designRoot, restrictImportsTo: designRoot });
    return { js: r.js, inputs: r.inputs, err: null as Error | null };
  } catch (e) {
    return { js: '', inputs: [] as string[], err: e as Error };
  }
}

const TEXT_IMPORT =
  "import x from './pkg' with { type: 'text' };\nexport default () => <p>{String(x)}</p>;\n";
const PLAIN_IMPORT = "import x from './pkg';\nexport default () => <p>{String(x)}</p>;\n";

describe('1 — a package.json redirect out of the design root', () => {
  const VARIANTS: Array<[string, unknown]> = [
    ['main', { name: 'pkg', main: '../../../outside-secret.txt' }],
    ['browser', { name: 'pkg', browser: '../../../outside-secret.txt' }],
    ['exports', { name: 'pkg', exports: '../../../outside-secret.txt' }],
    ['exports map', { name: 'pkg', exports: { '.': '../../../outside-secret.txt' } }],
  ];
  for (const [field, pkg] of VARIANTS) {
    for (const [label, src] of [
      ['text import', TEXT_IMPORT],
      ['plain import', PLAIN_IMPORT],
    ] as const) {
      test(`${field} (${label}): the outside file is never inlined`, async () => {
        const { designRoot } = sandboxWith({ 'ui/pkg/package.json': JSON.stringify(pkg) });
        const out = await buildOutcome(designRoot, src);
        expect(out.js).not.toContain('SECRET-OUTSIDE');
        expect(out.inputs.some((p) => p.endsWith('outside-secret.txt'))).toBe(false);
      });
    }
  }

  test('a redirect to a runtime-state file inside the design root is refused too', async () => {
    const { designRoot } = sandboxWith({
      '_state/frame-cap.key': 'SECRET-KEY\n',
      'ui/pkg/package.json': JSON.stringify({ main: '../../_state/frame-cap.key' }),
    });
    const out = await buildOutcome(designRoot, TEXT_IMPORT);
    expect(out.js).not.toContain('SECRET-KEY');
    expect(out.err).toBeInstanceOf(Error);
  });

  test('a redirect through a symlinked file inside the root is judged by its real home', async () => {
    const { root, designRoot } = sandboxWith({});
    mkdirSync(join(designRoot, 'ui', 'pkg'), { recursive: true });
    symlinkSync(join(root, 'outside-secret.txt'), join(designRoot, 'ui', 'pkg', 'entry.txt'));
    writeFileSync(
      join(designRoot, 'ui', 'pkg', 'package.json'),
      JSON.stringify({ main: 'entry.txt' })
    );
    const out = await buildOutcome(designRoot, TEXT_IMPORT);
    expect(out.js).not.toContain('SECRET-OUTSIDE');
  });

  test('a package.json redirect that stays inside the root still builds', async () => {
    const { designRoot } = sandboxWith({
      'ui/pkg/package.json': JSON.stringify({ main: 'index.tsx' }),
      'ui/pkg/index.tsx': "export default 'INSIDE-OK';",
    });
    const out = await buildOutcome(designRoot, PLAIN_IMPORT);
    expect(out.err).toBeNull();
    expect(out.js).toContain('INSIDE-OK');
  });
});

describe('1a / 4 — inputsRefusal', () => {
  const root = '/proj/.design';
  const sees = () => true;

  test('an inlined file outside the design root and outside our modules → refused', () => {
    expect(inputsRefusal(['/proj/outside-secret.txt'], [root], sees)?.status).toBe(403);
    expect(inputsRefusal(['/Users/x/.maude/index/frame.key'], [root], sees)?.status).toBe(403);
  });

  test("our own modules (canvas-lib, the studio's node_modules) → served", () => {
    const ours = [
      join(DEV_SERVER_ROOT, 'canvas-lib.tsx'),
      join(DEV_SERVER_ROOT, 'node_modules', 'react', 'index.js'),
      realpathSync(join(DEV_SERVER_ROOT, 'canvas-lib.tsx')),
    ];
    expect(inputsRefusal(ours, [root], sees)).toBeNull();
  });

  test('a design-root folder whose name starts with ".." is inside, held to the closure', () => {
    const abs = `${root}${sep}..notes${sep}x.tsx`;
    expect(inputsRefusal([abs], [root], () => false)?.status).toBe(403);
    expect(inputsRefusal([abs], [root], (rel) => rel === '..notes/x.tsx')).toBeNull();
  });

  test('a non-absolute input (never a file the gate can place) → refused, fail closed', () => {
    expect(inputsRefusal(['maude-canvas-lib:virtual'], [root], sees)?.status).toBe(403);
  });
});

// gate-b-c4k — "a canvas" is now the file's own marker (it renders DesignCanvas), not the index's
// group rule: the meta-less canvases below render DesignCanvas; the group config no longer matters.
const DC =
  "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;";

describe('2 — a meta-less canvas is a canvas (the file says so)', () => {
  function project(files: Record<string, string>): ProjectReader {
    return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
  }
  const FILES: Record<string, string> = {
    'config.json': JSON.stringify({ canvasGroups: [{ label: 'Screens', path: 'screens' }] }),
    'ui/a.tsx':
      "import B from './b.tsx';\nimport S from '../screens/s.tsx';\nimport H from '../components/h.tsx';\nimport P from './_parts/p.tsx';\nimport '../ui/b.css';\nexport default () => <B />;\n",
    'ui/a.meta.json': '{}',
    'ui/b.tsx': DC, // no meta, no board — still a canvas
    'ui/b.css': '.b{}',
    'screens/s.tsx': DC, // a canvas whatever group a machine's config names
    'components/h.tsx': 'export default () => <i />;', // outside every group — a helper
    'ui/_parts/p.tsx': 'export default () => <i />;', // `_` segment — not a canvas
  };
  const grantA = { v: 1 as const, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' as const }] };

  test('a member of A only: meta-less canvases B and S (and B.css) are not read', () => {
    const c = closureFor(resolveAccess(grantA), project(FILES));
    expect(c.read.has('ui/b.tsx')).toBe(false);
    expect(c.read.has('ui/b.css')).toBe(false);
    expect(c.read.has('screens/s.tsx')).toBe(false);
  });

  test('a member of A only: helpers outside the groups or under `_` dirs still are', () => {
    const c = closureFor(resolveAccess(grantA), project(FILES));
    expect(c.read.has('components/h.tsx')).toBe(true);
    expect(c.read.has('ui/_parts/p.tsx')).toBe(true);
  });

  test('the owner’s frame on A does not read B either (gate-b-c4j)', () => {
    const frame = narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), ['ui/a.tsx']);
    expect(closureFor(frame, project(FILES)).read.has('ui/b.tsx')).toBe(false);
  });

  test('the index and the closure share one predicate', () => {
    expect(isCanvasRelInGroups(['ui'], 'ui/parts/h.tsx')).toBe(true);
    expect(isCanvasRelInGroups(['ui'], 'ui/_parts/h.tsx')).toBe(false);
    expect(isCanvasRelInGroups(['ui'], 'ui/node_modules/x.tsx')).toBe(false);
    expect(isCanvasRelInGroups(['ui'], 'components/h.tsx')).toBe(false);
  });
});

describe('3a — slug-keyed sidecars go to no canvas when two fold to the slug', () => {
  const sidecars = (slug: string) => [
    `_comments/${slug}.json`,
    `${slug}.annotations.json`,
    `${slug}.edl.json`,
  ];
  function project(files: Record<string, string>): ProjectReader {
    return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
  }
  const owned = (canvas: string, files: Record<string, string>) =>
    closureFor(
      resolveAccess({ v: 1, role: null, grants: [{ c: canvas, r: 'member' }] }),
      project(files)
    ).owned;

  for (const [label, twin] of [
    ['a folder', 'ui/a/b.tsx'],
    ['a case-only variant', 'UI/A-B.tsx'],
    ['a space vs an underscore', 'ui/a b.tsx'],
  ] as const) {
    test(`ui/a-b.tsx with ${label} twin (${twin}): neither owns the shared sidecars`, () => {
      const base = twin === 'ui/a b.tsx' ? 'ui/a_b.tsx' : 'ui/a-b.tsx';
      const slug = twin === 'ui/a b.tsx' ? 'ui-a_b' : 'ui-a-b';
      const files = {
        [base]: 'x',
        [twin]: 'y',
        ...Object.fromEntries(sidecars(slug).map((s) => [s, '{}'])),
      };
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (const c of [base, twin]) {
          const o = owned(c, files);
          expect(o.has(c)).toBe(true);
          for (const s of sidecars(slug))
            expect({ c, s, owned: o.has(s) }).toEqual({ c, s, owned: false });
        }
      } finally {
        warn.mockRestore();
      }
    });
  }

  test('a canvas with no twin still owns its comments, board and EDL', () => {
    const files = {
      'ui/a-b.tsx': 'x',
      'ui/a-b.meta.json': '{}',
      ...Object.fromEntries(sidecars('ui-a-b').map((s) => [s, '{}'])),
    };
    const o = owned('ui/a-b.tsx', files);
    for (const s of [...sidecars('ui-a-b'), 'ui/a-b.meta.json']) expect(o.has(s)).toBe(true);
  });
});

describe('3b — the studio’s create / rename / move / copy guard refuses every slug twin', () => {
  // Those four paths refuse a name whose SYNC key another canvas has (S1.23b, findCloseName over
  // allCanvasRels; booted in canvas-sync-name-collision.test.ts). The sync key folds further than
  // the slug, so a slug twin is always refused — pinned here, pair by pair, case-only included.
  const PAIRS: Array<[string, string]> = [
    ['ui/a-b.tsx', 'ui/a/b.tsx'],
    ['ui/a-b.tsx', 'ui/A-B.tsx'],
    ['ui/a-b.tsx', 'UI/A-B.tsx'],
    ['ui/a_b.tsx', 'ui/a b.tsx'],
    ['ui/a-b.tsx', 'ui/a-b.html'],
    ['ui/x/y-z.tsx', 'ui/x-y/z.tsx'],
  ];
  for (const [have, want] of PAIRS) {
    test(`${want} beside ${have}`, () => {
      expect(canvasSlugFromRel(want, '')).toBe(canvasSlugFromRel(have, ''));
      expect(findCloseName(want, [have])).toBe(have);
    });
  }
});

describe('M2 — an input list that does not name the canvas fails closed', () => {
  test('inputsRefusal with the entry: [] and a list without it → refused; with it → served', () => {
    const root = '/proj/.design';
    const entry = `${root}/ui/a.tsx`;
    const sees = () => true;
    expect(inputsRefusal([], [root], sees, { entry })?.status).toBe(403);
    expect(inputsRefusal([`${root}/ui/h.tsx`], [root], sees, { entry })?.status).toBe(403);
    expect(inputsRefusal([entry, `${root}/ui/h.tsx`], [root], sees, { entry })).toBeNull();
  });

  test('in-process: a build whose metafile is missing is refused', async () => {
    const { designRoot } = sandboxWith({});
    const realBuild = Bun.build;
    const spy = spyOn(Bun, 'build').mockImplementation((async (
      cfg: Parameters<typeof Bun.build>[0]
    ) => {
      const r = await realBuild(cfg);
      return Object.assign(r, { metafile: undefined });
    }) as typeof Bun.build);
    try {
      const out = await buildOutcome(designRoot, 'export default () => <p>ok</p>;\n');
      expect(out.err).toBeInstanceOf(Error);
      expect(out.js).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  test('sandbox: a worker that reports no inputs (or not the canvas) is refused', async () => {
    const { root, designRoot } = sandboxWith({});
    const abs = join(designRoot, 'ui', 'm2.tsx');
    writeFileSync(abs, 'export default () => <p>ok</p>;\n');
    const lists: string[][] = [[], [join(designRoot, 'ui', 'other.tsx')]];
    for (const [i, inputs] of lists.entries()) {
      const workers = join(root, `workers-${i}`);
      mkdirSync(workers, { recursive: true });
      writeFileSync(
        join(workers, 'canvas-build-worker.ts'),
        `process.stdout.write(JSON.stringify({ ok: true, js: 'SERVED', locator: {}, etag: 'e${i}', inputs: ${JSON.stringify(inputs)} }));\n`
      );
      const r = await buildCanvasSandboxed({
        designRoot,
        canvasAbs: abs,
        env: { ...process.env, MAUDE_CANVAS_WORKERS: workers, MAUDE_BUN_PATH: process.execPath },
      });
      expect({ i, ok: r.ok }).toEqual({ i, ok: false });
    }
  });
});

describe('L2 — the frame key is never kept inside the design root or the repo', () => {
  test('a key path inside a forbidden root → in-memory key, nothing written, a warning', () => {
    const { root, designRoot } = sandboxWith({});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const file of [join(designRoot, 'k', 'frame-cap.key'), join(root, 'idx', 'f.key')]) {
        const a = loadFrameSecret(file, undefined, [designRoot, root]);
        const b = loadFrameSecret(file, undefined, [designRoot, root]);
        expect(a.length).toBe(32);
        expect(a.equals(b)).toBe(false); // in-memory: nothing persisted to read back
        expect(existsSync(file)).toBe(false);
      }
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('a key path reached through a symlink into the repo counts as inside', () => {
    const { root } = sandboxWith({});
    const elsewhere = mkdtempSync(join(tmpdir(), 'c4g-idx-'));
    symlinkSync(root, join(elsewhere, 'link'));
    const file = join(elsewhere, 'link', 'frame-cap.key');
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadFrameSecret(file, undefined, [root]);
      expect(existsSync(file)).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  test('a key path outside both → persisted and stable', () => {
    const { root, designRoot } = sandboxWith({});
    const file = join(mkdtempSync(join(tmpdir(), 'c4g-idx-')), 'p', 'frame-cap.key');
    const a = loadFrameSecret(file, undefined, [designRoot, root]);
    expect(existsSync(file)).toBe(true);
    expect(loadFrameSecret(file, undefined, [designRoot, root]).equals(a)).toBe(true);
  });
});
