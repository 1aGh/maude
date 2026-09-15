// /_api/fs-move — feature-file-tree-drag-drop-folders (Task 3). Covers the
// HTTP round-trip (happy path, containment, DS refusal, collision, full
// re-key across every sidecar) plus, in-process (no server boot needed), the
// collab-pin refusal — the one guard an HTTP-only black-box test can't drive,
// since pinning a room requires reaching into the dev-server's in-memory
// collab registry.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

async function createBoard(port: number, name: string, group?: string) {
  const r = await fetch(`http://localhost:${port}/_api/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, kind: 'brief-board', group }),
  });
  return (await r.json()) as { file: string; rel: string; slug: string };
}

function move(port: number, file: string, toDir: string) {
  return fetch(`http://localhost:${port}/_api/fs-move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, toDir }),
  });
}

describe('/_api/fs-move — POST round-trip', () => {
  test('happy path: relocates the primary + meta into the destination dir', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Movable');
      const r = await move(port, created.rel, 'ui/sub');
      expect(r.status).toBe(200);
      const j = (await r.json()) as {
        ok: boolean;
        fromRel: string;
        toRel: string;
        fromSlug: string;
        toSlug: string;
        moved: string[];
      };
      expect(j.ok).toBe(true);
      expect(j.toRel).toBe('ui/sub/Movable.tsx');
      expect(j.fromSlug).toBe('ui-movable');
      expect(j.toSlug).toBe('ui-sub-movable');

      expect(existsSync(join(designRoot, 'ui', 'Movable.tsx'))).toBe(false);
      expect(existsSync(join(designRoot, 'ui', 'sub', 'Movable.tsx'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'sub', 'Movable.meta.json'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  // Issue #114, second bug: the move used to relocate BYTES and leave the
  // relative specifiers pointing one level too high, so the canvas 500s on the
  // next build with `Could not resolve` — reported as
  // `ui/print/AlligatorsAcko.tsx` still importing `../system/…`. The unit tests
  // in canvas-imports.test.ts pin the rewrite itself; this pins that the move
  // actually CALLS it, which is the half that was missing.
  test('re-roots the canvas relative imports for its new depth', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Importer');
      const abs = join(designRoot, 'ui', 'Importer.tsx');
      writeFileSync(
        abs,
        [
          'import { DCArtboard } from "@maude/canvas-lib";',
          'import { Sign } from "../system/alligators/preview/_kit";',
          'import "../system/alligators/preview/_layout.css";',
          'export default function Importer() { return <DCArtboard><Sign /></DCArtboard>; }',
          '',
        ].join('\n'),
        'utf8'
      );

      const r = await move(port, created.rel, 'ui/print');
      expect(r.status).toBe(200);

      const moved = readFileSync(join(designRoot, 'ui', 'print', 'Importer.tsx'), 'utf8');
      expect(moved).toContain('from "../../system/alligators/preview/_kit"');
      expect(moved).toContain('import "../../system/alligators/preview/_layout.css"');
      // The bare specifier is resolved by the bundler, not by depth.
      expect(moved).toContain('from "@maude/canvas-lib"');
    } finally {
      await killProc(proc);
    }
  });

  // The move's containment checks cover the source DIRECTORY, never the source
  // file, which was harmless while the move was a bare `rename()` — renaming a
  // symlink moves the link and touches no out-of-root byte. The import rewrite
  // is the first code on this path that reads and writes CONTENT, so a planted
  // link would have become an out-of-root read + write behind a drag-and-drop.
  test('never rewrites THROUGH a symlinked canvas (no out-of-root write)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const outside = join(root, 'outside-the-design-root.ts');
      const outsideBody = 'import "./secrets/keys.ts";\nexport const secret = 1;\n';
      writeFileSync(outside, outsideBody, 'utf8');

      // A canvas-shaped symlink pointing out of the design root.
      symlinkSync(outside, join(designRoot, 'ui', 'Planted.tsx'));
      writeFileSync(
        join(designRoot, 'ui', 'Planted.meta.json'),
        JSON.stringify({ title: 'Planted' }),
        'utf8'
      );

      await move(port, 'ui/Planted.tsx', 'ui/deep');

      // Whatever the move decided about the link itself, the file it points at
      // must be byte-for-byte untouched.
      expect(readFileSync(outside, 'utf8')).toBe(outsideBody);
    } finally {
      await killProc(proc);
    }
  });

  // THE `.ydoc.bin` CACHE IS THE ONE ARTIFACT THAT MUST NOT FOLLOW.
  //
  // It is the OLD document's CRDT state, and the move's last act before the
  // rename is to stamp that document retired (`movedTo`) and flush it. Carried
  // over, the NEW document opens with the old one's last word — "I have moved
  // away" — so every peer releases the canvas as retired instead of syncing it.
  // Reported from a live pair as "folders don't sync": each machine showed its
  // own move and the other machine's canvas still sitting at the root.
  test("the old slug's .ydoc.bin cache is dropped, never carried to the new slug", async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Cached');
      const fromSlug = created.slug;
      mkdirSync(join(designRoot, '_state'), { recursive: true });
      writeFileSync(join(designRoot, '_state', `${fromSlug}.ydoc.bin`), 'STAMPED-RETIRED');

      const r = await move(port, created.rel, 'ui/sub');
      expect(r.status).toBe(200);
      const j = (await r.json()) as { toSlug: string; moved: string[] };

      expect(existsSync(join(designRoot, '_state', `${fromSlug}.ydoc.bin`))).toBe(false);
      expect(existsSync(join(designRoot, '_state', `${j.toSlug}.ydoc.bin`))).toBe(false);
      // And it is not claimed as relocated in the forensic list either.
      expect(j.moved.some((m) => m.includes('.ydoc.bin'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('full re-key: history, canvas-state view, comments, annotations, locator all follow the move', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Full Rekey');
      const fromSlug = created.slug; // 'ui-full_rekey'

      mkdirSync(join(designRoot, '_history', fromSlug), { recursive: true });
      writeFileSync(join(designRoot, '_history', fromSlug, 'snap.json'), '{}');
      mkdirSync(join(designRoot, '_canvas-state'), { recursive: true });
      writeFileSync(
        join(designRoot, '_canvas-state', `${fromSlug}.view.json`),
        JSON.stringify({ viewport: { x: 1, y: 2, scale: 1 } })
      );
      mkdirSync(join(designRoot, '_comments'), { recursive: true });
      writeFileSync(join(designRoot, '_comments', `${fromSlug}.json`), '[]');
      writeFileSync(
        join(designRoot, `${fromSlug}.annotations.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1"></svg>'
      );
      const locatorAbs = join(designRoot, '_locator.json');
      const locatorKey = 'ui/Full Rekey'; // locatorKeyFor shape: posix, ext-less, NOT slugified
      writeFileSync(
        locatorAbs,
        JSON.stringify({
          [locatorKey]: {
            a1b2c3d4: { canvas: '/x', line: 1, col: 0, jsxPath: [], componentName: '' },
          },
        })
      );

      const r = await move(port, created.rel, 'ui/nested');
      expect(r.status).toBe(200);
      const j = (await r.json()) as { toSlug: string };
      const toSlug = j.toSlug; // 'ui-nested-full_rekey'

      expect(existsSync(join(designRoot, '_history', toSlug, 'snap.json'))).toBe(true);
      expect(existsSync(join(designRoot, '_history', fromSlug))).toBe(false);
      expect(existsSync(join(designRoot, '_canvas-state', `${toSlug}.view.json`))).toBe(true);
      expect(existsSync(join(designRoot, '_canvas-state', `${fromSlug}.view.json`))).toBe(false);
      expect(existsSync(join(designRoot, '_comments', `${toSlug}.json`))).toBe(true);
      expect(existsSync(join(designRoot, `${toSlug}.annotations.svg`))).toBe(true);
      expect(existsSync(join(designRoot, `${fromSlug}.annotations.svg`))).toBe(false);

      const locator = JSON.parse(readFileSync(locatorAbs, 'utf8'));
      expect(locator['ui/nested/Full Rekey']).toBeDefined();
      expect(locator[locatorKey]).toBeUndefined();

      // Forensic log for the non-atomic move.
      expect(existsSync(join(designRoot, '_history', toSlug, '_move.json'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('containment: a toDir escaping the design root is rejected (400), nothing moved', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Contained');
      const r = await move(port, created.rel, '../../../../tmp');
      expect(r.status).toBe(400);
      expect(existsSync(join(designRoot, 'ui', 'Contained.tsx'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses moving a design-system canvas (400, untouched)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'system', 'project'), { recursive: true });
      const dsFile = join(designRoot, 'system', 'project', 'Spec.tsx');
      writeFileSync(dsFile, 'export default function S(){return null}');
      const r = await move(port, '.design/system/project/Spec.tsx', 'ui');
      expect(r.status).toBe(400);
      expect(existsSync(dsFile)).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses moving INTO the design-system group (400, untouched)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Into DS');
      const r = await move(port, created.rel, 'system/project');
      expect(r.status).toBe(400);
      expect(existsSync(join(designRoot, 'ui', 'Into DS.tsx'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('a name collision at the destination returns 409, nothing moved', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Dup');
      mkdirSync(join(designRoot, 'ui', 'sub'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'sub', 'Dup.tsx'),
        'export default function D(){return null}'
      );
      const r = await move(port, created.rel, 'ui/sub');
      expect(r.status).toBe(409);
      expect(existsSync(join(designRoot, 'ui', 'Dup.tsx'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('a no-op move (same dir) is rejected with 400', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Same Dir');
      const r = await move(port, created.rel, 'ui');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('a missing source canvas returns 404', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await move(port, 'ui/Nope.tsx', 'ui/sub');
      expect(r.status).toBe(404);
    } finally {
      await killProc(proc);
    }
  });

  test('emits a canvas-list-update "moved" action over the inspector WS', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    let socket: WebSocket | null = null;
    try {
      const messages: Array<{ type: string; payload?: Record<string, unknown> }> = [];
      const sock = new WebSocket(`ws://localhost:${port}/_ws`);
      socket = sock;
      await new Promise<void>((res, rej) => {
        sock.addEventListener('open', () => res());
        sock.addEventListener('error', () => rej(new Error('ws error')));
        setTimeout(() => rej(new Error('ws open timeout')), 2000);
      });
      sock.addEventListener('message', (ev) => {
        try {
          messages.push(JSON.parse(String(ev.data)));
        } catch {
          /* ignore */
        }
      });
      const created = await createBoard(port, 'Live Move');
      const r = await move(port, created.rel, 'ui/sub');
      expect(r.status).toBe(200);

      const deadline = Date.now() + 2000;
      let hit: (typeof messages)[number] | undefined;
      while (Date.now() < deadline && !hit) {
        hit = messages.find(
          (m) => m.type === 'canvas-list-update' && m.payload?.action === 'moved'
        );
        if (!hit) await Bun.sleep(25);
      }
      expect(hit?.payload?.toSlug ?? hit?.payload?.slug).toBeTruthy();
      expect(hit?.payload?.fromSlug).toBe('ui-live_move');
    } finally {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      await killProc(proc);
    }
  }, 10_000);

  test('unknown method (GET) returns 405', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/fs-move`, { method: 'GET' });
      expect(r.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects a cross-origin move (CSRF guard)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Forge Move');
      const r = await fetch(`http://localhost:${port}/_api/fs-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
        body: JSON.stringify({ file: created.rel, toDir: 'ui/sub' }),
      });
      expect(r.status).toBe(403);
    } finally {
      await killProc(proc);
    }
  });
});

// Security review finding: canvasSlugFromRel's `/`→`-` flattening is not
// injective — "ui/a-b.tsx" and "ui/a/b.tsx" both hash to slug "ui-a-b". A
// move that creates this collision would, pre-fix, silently clobber the
// OTHER canvas's history/comments/annotations the moment the primary rename
// landed. moveCanvas/moveFolder now refuse with 409 via fileForSlug().
// Security review finding: `path.resolve()`-only containment does not follow
// symlinks. A symlink planted inside a canvas group (malicious git peer, hub
// sync, or accident) pointing outside designRoot passed every pre-fix
// containment check while rename()/mkdir() followed it at the OS level.
describe('/_api/fs-move — symlink escape guard (security review finding)', () => {
  test('refuses moving a canvas INTO a symlinked destination folder', async () => {
    const { root, designRoot } = makeSandbox();
    const outside = join(root, 'OUTSIDE');
    mkdirSync(outside, { recursive: true });
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Escapee');
      symlinkSync(outside, join(designRoot, 'ui', 'link'));
      const r = await move(port, created.rel, 'ui/link');
      expect(r.status).toBe(400);
      expect(existsSync(join(outside, 'Escapee.tsx'))).toBe(false);
      expect(existsSync(join(designRoot, 'ui', 'Escapee.tsx'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses moving a symlinked FOLDER as the source', async () => {
    const { root, designRoot } = makeSandbox();
    const outside = join(root, 'OUTSIDE');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'Secret.tsx'), 'export default function S(){return null}');
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      symlinkSync(outside, join(designRoot, 'ui', 'evil'));
      const r = await move(port, 'ui/evil', 'ui/dest');
      expect(r.status).toBe(400);
      expect(existsSync(join(designRoot, 'ui', 'dest'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });
});

describe('/_api/fs-move — slug-collision guard (security review finding)', () => {
  test('refuses a move whose destination slug collides with an existing DIFFERENT canvas', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      // Victim: ui/a-b.tsx -> slug "ui-a-b". Give it a real annotations
      // sidecar so a silent clobber would be observable.
      const victim = await createBoard(port, 'a-b');
      expect(victim.slug).toBe('ui-a-b');
      writeFileSync(join(designRoot, `${victim.slug}.annotations.svg`), '<svg>VICTIM</svg>');

      // Mover: ui/b.tsx, about to move into ui/a/ -> would become
      // ui/a/b.tsx -> slug "ui-a-b" too.
      const mover = await createBoard(port, 'b');
      const r = await move(port, mover.rel, 'ui/a');
      expect(r.status).toBe(409);
      const j = (await r.json()) as { error: string };
      expect(j.error).toContain('ui-a-b');

      // Nothing moved; the victim's sidecar is untouched.
      expect(existsSync(join(designRoot, 'ui', 'b.tsx'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'a', 'b.tsx'))).toBe(false);
      expect(readFileSync(join(designRoot, `${victim.slug}.annotations.svg`), 'utf8')).toBe(
        '<svg>VICTIM</svg>'
      );
    } finally {
      await killProc(proc);
    }
  });

  test('a folder move refuses when a nested canvas would collide with an OUTSIDE canvas', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      // A folder move preserves the moved folder's OWN basename as a path
      // segment, so to collide with "ui/dest-sub-inner.tsx" (slug
      // "ui-dest-sub-inner"), move folder "ui/sub" (containing "inner.tsx")
      // into "ui/dest" -> "ui/dest/sub/inner.tsx" -> same slug.
      const victim = await createBoard(port, 'dest-sub-inner');
      expect(victim.slug).toBe('ui-dest-sub-inner');

      await createBoard(port, 'inner');
      const moveIntoSub = await move(port, 'ui/inner.tsx', 'ui/sub');
      expect(moveIntoSub.status).toBe(200);

      const r = await move(port, 'ui/sub', 'ui/dest');
      expect(r.status).toBe(409);
      expect(existsSync(join(designRoot, 'ui', 'sub'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'dest', 'sub'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('does NOT refuse when the "collision" is the canvas moving into its OWN new slug (no-op false positive)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Solo');
      const r = await move(port, created.rel, 'ui/sub');
      expect(r.status).toBe(200);
    } finally {
      await killProc(proc);
    }
  });
});

describe('/_api/fs-move — folder move (Task 11)', () => {
  test('moving a folder relocates every nested canvas + its sidecars', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      await createBoard(port, 'One', 'ui');
      const r1 = await move(port, 'ui/One.tsx', 'ui/Src');
      expect(r1.status).toBe(200);
      await createBoard(port, 'Two', 'ui');
      const r2 = await move(port, 'ui/Two.tsx', 'ui/Src');
      expect(r2.status).toBe(200);
      // Seed a history sidecar for One to prove slug-keyed sidecars follow too.
      mkdirSync(join(designRoot, '_history', 'ui-src-one'), { recursive: true });
      writeFileSync(join(designRoot, '_history', 'ui-src-one', 'snap.json'), '{}');

      const r = await move(port, 'ui/Src', 'ui/Dest');
      expect(r.status).toBe(200);
      const j = (await r.json()) as { ok: boolean; toRel: string; moved: string[] };
      expect(j.ok).toBe(true);
      expect(j.toRel).toBe('ui/Dest/Src');

      expect(existsSync(join(designRoot, 'ui', 'Src'))).toBe(false);
      expect(existsSync(join(designRoot, 'ui', 'Dest', 'Src', 'One.tsx'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'Dest', 'Src', 'Two.tsx'))).toBe(true);
      expect(existsSync(join(designRoot, '_history', 'ui-dest-src-one', 'snap.json'))).toBe(true);
      expect(existsSync(join(designRoot, '_history', 'ui-src-one'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses moving a folder into itself or a descendant (400)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui', 'Parent', 'Child'), { recursive: true });
      const intoSelf = await move(port, 'ui/Parent', 'ui/Parent');
      expect(intoSelf.status).toBe(400);
      const intoChild = await move(port, 'ui/Parent', 'ui/Parent/Child');
      expect(intoChild.status).toBe(400);
      expect(existsSync(join(designRoot, 'ui', 'Parent', 'Child'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses moving a canvas GROUP ROOT (not a user-created folder) (400)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await move(port, 'ui', 'system');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('a missing source folder returns 404', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await move(port, 'ui/Nope', 'ui/Dest');
      expect(r.status).toBe(404);
    } finally {
      await killProc(proc);
    }
  });

  test('a destination collision returns 409, nothing moved', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui', 'Src'), { recursive: true });
      mkdirSync(join(designRoot, 'ui', 'Dest', 'Src'), { recursive: true });
      const r = await move(port, 'ui/Src', 'ui/Dest');
      expect(r.status).toBe(409);
      expect(existsSync(join(designRoot, 'ui', 'Src'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });
});

// Plan T25/L04 — rename in place and duplicate, the two canvas verbs the file
// tree menu offers beside Move to….
describe('canvas rename and duplicate', () => {
  test('toName renames in place, sidecars follow, a bad name is refused', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Before');
      writeFileSync(join(designRoot, 'ui-before.annotations.svg'), '<svg/>');
      const rename = (toName: string) =>
        fetch(`http://localhost:${port}/_api/fs-move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: created.rel, toName }),
        });
      const bad = await rename('../escape');
      expect(bad.status).toBe(400);
      const r = await rename('After name');
      expect(r.status).toBe(200);
      const j = (await r.json()) as { toRel: string; toSlug: string };
      expect(j.toRel).toBe('ui/After name.tsx');
      expect(existsSync(join(designRoot, 'ui', 'Before.tsx'))).toBe(false);
      expect(existsSync(join(designRoot, 'ui', 'After name.tsx'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'After name.meta.json'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui-before.annotations.svg'))).toBe(false);
      expect(existsSync(join(designRoot, `${j.toSlug}.annotations.svg`))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('duplicate copies source, meta and whiteboard beside it as "<name> copy", then "copy 2"', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Orig');
      writeFileSync(join(designRoot, 'ui-orig.annotations.svg'), '<svg id="a"/>');
      const dup = () =>
        fetch(`http://localhost:${port}/_api/canvas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duplicateOf: created.rel }),
        });
      const r1 = await dup();
      expect(r1.status).toBe(201);
      const j1 = (await r1.json()) as { rel: string; slug: string };
      expect(j1.rel).toBe('ui/Orig copy.tsx');
      expect(readFileSync(join(designRoot, 'ui', 'Orig copy.tsx'), 'utf8')).toBe(
        readFileSync(join(designRoot, 'ui', 'Orig.tsx'), 'utf8')
      );
      const meta = JSON.parse(readFileSync(join(designRoot, 'ui', 'Orig copy.meta.json'), 'utf8'));
      expect(meta.title).toBe('Orig copy');
      expect(readFileSync(join(designRoot, `${j1.slug}.annotations.svg`), 'utf8')).toBe(
        '<svg id="a"/>'
      );
      const r2 = await dup();
      expect(((await r2.json()) as { rel: string }).rel).toBe('ui/Orig copy 2.tsx');
      const outside = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateOf: '../outside.tsx' }),
      });
      expect(outside.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });
});

// Plan T17/L03 — supporting files beside the canvases move, rename and delete
// as themselves; one a canvas still uses is refused by name.
describe('supporting files', () => {
  test('rename, move and delete a note; an image a canvas uses is refused', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui', 'docs'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'notes.md'), '# Notes\n');
    writeFileSync(join(designRoot, 'ui', 'hero.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(
      join(designRoot, 'ui', 'Uses.tsx'),
      'export default function U() { return <img src="./hero.png" />; }\n'
    );
    const port = nextPort();
    const proc = await bootServer(root, port);
    const post = (body: unknown) =>
      fetch(`http://localhost:${port}/_api/fs-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const renamed = await post({ file: 'ui/notes.md', toName: 'Meeting notes' });
      expect(renamed.status).toBe(200);
      expect(existsSync(join(designRoot, 'ui', 'Meeting notes.md'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'notes.md'))).toBe(false);

      const moved = await post({ file: 'ui/Meeting notes.md', toDir: 'ui/docs' });
      expect(moved.status).toBe(200);
      expect(readFileSync(join(designRoot, 'ui', 'docs', 'Meeting notes.md'), 'utf8')).toBe('# Notes\n');

      const used = await post({ file: 'ui/hero.png', toDir: 'ui/docs' });
      expect(used.status).toBe(409);
      expect(((await used.json()) as { error: string }).error).toContain('ui/Uses.tsx');
      expect(existsSync(join(designRoot, 'ui', 'hero.png'))).toBe(true);
      const usedDelete = await fetch(`http://localhost:${port}/_api/canvas?file=ui/hero.png`, { method: 'DELETE' });
      expect(usedDelete.status).toBe(409);

      const del = await fetch(`http://localhost:${port}/_api/canvas?file=${encodeURIComponent('ui/docs/Meeting notes.md')}`, {
        method: 'DELETE',
      });
      expect(del.status).toBe(200);
      expect(existsSync(join(designRoot, 'ui', 'docs', 'Meeting notes.md'))).toBe(false);
      // The folder itself survives a file delete.
      expect(existsSync(join(designRoot, 'ui', 'docs'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });
});

// In-process: the collab-pin guard. Reaching a REAL pinned room requires the
// MAUDE_SHARED_DOC sync runtime; exercising the guard through api.moveCanvas
// directly with a stub `isRoomPinned` hook proves the refusal wiring without
// standing up the whole shared-doc machinery.
describe('moveCanvas — collab-pin guard (in-process)', () => {
  function mkCtx(root: string, designRoot: string): Context {
    return {
      cfg: {
        canvasGroups: [
          { label: 'Design system', path: 'system' },
          { label: 'Canvases', path: 'ui' },
        ],
      } as Context['cfg'],
      projectLabel: 'test',
      bus: createBus(),
      paths: {
        repoRoot: root,
        designRel: '.design',
        designRoot,
        serverInfoFile: join(designRoot, '_server.json'),
        activeFile: join(designRoot, '_active.json'),
        commentsDir: join(designRoot, '_comments'),
        canvasStateDir: join(designRoot, '_canvas-state'),
        historyDir: join(designRoot, '_history'),
        tokensUrlRel: '',
        systemDirRel: 'system',
      },
    };
  }

  test('refuses the move (409) when the slug is pinned, and does not touch disk', async () => {
    const { root, designRoot } = makeSandbox();
    const abs = join(designRoot, 'ui', 'Pinned.tsx');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(abs, 'export default function P(){return null}');
    const ctx = mkCtx(root, designRoot);
    const api = createApi(ctx, {
      onCommentsChanged: () => {},
      isRoomPinned: (slug) => slug === 'ui-pinned',
      flushAndDropRoom: async () => {
        throw new Error('must not be called when pinned');
      },
    });

    const result = await api.moveCanvas({ file: 'ui/Pinned.tsx', toDir: 'ui/sub' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(existsSync(abs)).toBe(true);
  });

  test('calls flushAndDropRoom when NOT pinned', async () => {
    const { root, designRoot } = makeSandbox();
    const abs = join(designRoot, 'ui', 'Unpinned.tsx');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(abs, 'export default function U(){return null}');
    const ctx = mkCtx(root, designRoot);
    let flushed = false;
    const api = createApi(ctx, {
      onCommentsChanged: () => {},
      isRoomPinned: () => false,
      flushAndDropRoom: async (slug) => {
        expect(slug).toBe('ui-unpinned');
        flushed = true;
      },
    });

    const result = await api.moveCanvas({ file: 'ui/Unpinned.tsx', toDir: 'ui/sub' });
    expect(result.ok).toBe(true);
    expect(flushed).toBe(true);
  });
});
