// /_api/annotations — GET / PUT round-trip + validation gates, and the
// DDR-242 op path /_api/annotations/ops.
//
// Verifies:
//   - GET returns the canonical EMPTY board for a canvas with no annotations
//   - PUT { board } writes `<designRoot>/<slug>.annotations.json` (canonical)
//   - PUT { svg } — a v1 tab still open across the upgrade — is converted
//   - GET on a canvas whose only file is a legacy `.annotations.svg` returns
//     the migrated board
//   - PUT rejects bodies that are neither a board nor SVG (400) and never
//     turns them into an empty board
//   - PUT rejects oversized bodies (> MAX_ANNOTATIONS_BYTES)
//   - POST /ops applies a batch, reports `gone` for a patch on a missing element
//   - Unknown method → 405

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseBoard } from '../annotations/schema.ts';
import { MAX_ANNOTATIONS_BYTES } from '../sync/limits.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import {
  board,
  boardIds,
  EMPTY_BOARD,
  elements,
  sticky,
  v1,
  v1Sticky,
} from './fixtures/annotations-v2/boards.ts';

const BOARD_OK = board(sticky('s1', 'hello'), sticky('s2', 'world', { x: 300, index: 'a1' }));

describe('/_api/annotations — GET/PUT', () => {
  test('accepts bounded write identities without changing the board and rejects invalid identities', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const post = (writeId: unknown) =>
        fetch(`http://localhost:${port}/_api/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: '.design/ui/Identity.tsx', board: BOARD_OK, writeId }),
        });
      expect((await post('session-operation-1')).status).toBe(204);
      const written = join(designRoot, 'ui-identity.annotations.json');
      expect(readFileSync(written, 'utf8')).toBe(BOARD_OK);
      for (const invalid of ['', 'a'.repeat(97), {}, 17, '<script>']) {
        expect((await post(invalid)).status).toBe(400);
      }
      expect(readFileSync(written, 'utf8')).toBe(BOARD_OK);
    } finally {
      await killProc(proc);
    }
  });

  test('GET on a canvas with no annotations returns the canonical empty board (200)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'Phase5.tsx'),
        'export default function P(){return <main/>}\n'
      );
      const r = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent(
          '.design/ui/Phase5.tsx'
        )}`
      );
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(await r.text()).toBe(EMPTY_BOARD);
      // A read never materializes a file.
      expect(existsSync(join(designRoot, 'ui-phase5.annotations.json'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT { board } writes <designRoot>/<slug>.annotations.json canonically and GET round-trips', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'Round.tsx'),
        'export default function P(){return <main/>}\n'
      );
      // Non-canonical input (reversed order, pretty-printed) is stored canonical.
      const scrambled = JSON.stringify(
        {
          format: 'maude.annotations',
          v: 2,
          elements: [...elements(...parseBoard(BOARD_OK).elements)].reverse(),
        },
        null,
        2
      );
      const put = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/Round.tsx', board: scrambled }),
      });
      expect(put.status).toBe(204);

      // File slug derives from the path under designRoot: `ui-round`.
      const written = join(designRoot, 'ui-round.annotations.json');
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written, 'utf8')).toBe(BOARD_OK);
      expect(existsSync(join(designRoot, 'ui-round.annotations.svg'))).toBe(false);

      const get = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent(
          '.design/ui/Round.tsx'
        )}`
      );
      expect(get.status).toBe(200);
      expect(get.headers.get('content-type')).toContain('application/json');
      expect(await get.text()).toBe(BOARD_OK);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT { svg } from a v1 tab still works — converted and stored as the v2 board', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const legacy = v1([v1Sticky('a', 'from v1'), v1Sticky('b', 'second', 300)]);
      const put = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/Legacy.tsx', svg: legacy.svg }),
      });
      expect(put.status).toBe(204);
      expect(readFileSync(join(designRoot, 'ui-legacy.annotations.json'), 'utf8')).toBe(
        legacy.board
      );
      expect(existsSync(join(designRoot, 'ui-legacy.annotations.svg'))).toBe(false);
      expect(boardIds(legacy.board)).toEqual(['a', 'b']);
    } finally {
      await killProc(proc);
    }
  });

  test('GET on a canvas whose only file is a legacy .annotations.svg returns the migrated board', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      // Written AFTER boot, so the boot migration has not converted it: the
      // read path itself must see through the legacy sidecar.
      const legacy = v1([v1Sticky('only', 'legacy note')]);
      writeFileSync(join(designRoot, 'ui-old.annotations.svg'), legacy.svg);
      const get = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent('.design/ui/Old.tsx')}`
      );
      expect(get.status).toBe(200);
      expect(get.headers.get('content-type')).toContain('application/json');
      expect(await get.text()).toBe(legacy.board);
      expect(boardIds(legacy.board)).toEqual(['only']);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT rejects bodies that are neither a board nor SVG with 400', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      writeFileSync(join(designRoot, 'ui-x.annotations.json'), BOARD_OK);
      for (const bad of [{ board: '{"hello":"world"}' }, { board: 'not json' }, { svg: 42 }, {}]) {
        const r = await fetch(`http://localhost:${port}/_api/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: '.design/ui/X.tsx', ...bad }),
        });
        expect(r.status).toBe(400);
      }
      // A refused write never becomes emptiness (DDR-223).
      expect(readFileSync(join(designRoot, 'ui-x.annotations.json'), 'utf8')).toBe(BOARD_OK);
    } finally {
      await killProc(proc);
    }
  });

  // v1 rejected any body not starting with `<svg` (the old "must look like an
  // <svg> document" content gate). In v2, `canonicalAnnotations` routes ANY
  // text starting with `<` through the v1 migration, so `<p>nope</p>` becomes
  // an EMPTY board and is written over the existing one. Reported as a
  // production bug (DDR-223 class: a malformed write erases content); this
  // test pins the correct guarantee and fails until it is fixed.
  test('PUT rejects a non-SVG markup body with 400 and leaves the board intact', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      writeFileSync(join(designRoot, 'ui-x.annotations.json'), BOARD_OK);
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/X.tsx', svg: '<p>nope</p>' }),
      });
      expect(r.status).toBe(400);
      expect(readFileSync(join(designRoot, 'ui-x.annotations.json'), 'utf8')).toBe(BOARD_OK);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT with a base merges onto the current board instead of erasing concurrent edits (review M5)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    const file = '.design/ui/Merge.tsx';
    const written = join(designRoot, 'ui-merge.annotations.json');
    const other = sticky('s2', 'peer', { x: 300, index: 'a1' });
    // Disk already has a peer's s2; this writer only ever saw s1.
    writeFileSync(written, board(sticky('s1', 'one'), other));
    try {
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file,
          board: board(sticky('s1', 'ONE')),
          base: board(sticky('s1', 'one')),
        }),
      });
      expect(r.status).toBe(204);
      expect(readFileSync(written, 'utf8')).toBe(board(sticky('s1', 'ONE'), other));
    } finally {
      await killProc(proc);
    }
  });

  test('PUT rejects missing file', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: BOARD_OK }),
      });
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT rejects bodies above the MAX_ANNOTATIONS_BYTES ceiling', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const huge = `{"format":"maude.annotations","v":2,"elements":[],"pad":"${'x'.repeat(
        MAX_ANNOTATIONS_BYTES + 100
      )}"}`;
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/X.tsx', board: huge }),
      });
      // saveAnnotations rejects on length (readJson's own cap is 2× + slack).
      expect(r.status).toBe(400);
      expect(existsSync(join(designRoot, 'ui-x.annotations.json'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('Unknown method (DELETE) returns 405', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'DELETE',
      });
      expect(r.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  });
});

describe('/_api/annotations/ops — DDR-242 §4 op batches', () => {
  test('applies a batch, then reports `gone` for a patch on a missing element', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    const file = '.design/ui/Ops.tsx';
    const written = join(designRoot, 'ui-ops.annotations.json');
    const post = (body: unknown) =>
      fetch(`http://localhost:${port}/_api/annotations/ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const [s1, s2] = elements(sticky('s1', 'one'), sticky('s2', 'two', { x: 300, index: 'a1' }));
      const r1 = await post({
        file,
        actionId: 'act-1',
        ops: [
          { op: 'put', el: s1 },
          { op: 'put', el: s2 },
        ],
      });
      expect(r1.status).toBe(200);
      expect(await r1.json()).toEqual({ ok: true, changed: true, rejected: [] });
      expect(readFileSync(written, 'utf8')).toBe(
        board(sticky('s1', 'one'), sticky('s2', 'two', { x: 300, index: 'a1' }))
      );

      // One batch: a real patch, a delete, and a patch on an element that
      // does not exist. The good ops land; the missing one is reported.
      const r2 = await post({
        file,
        actionId: 'act-2',
        ops: [
          { op: 'patch', id: 's1', set: { text: 'ONE' } },
          { op: 'delete', id: 's2' },
          { op: 'patch', id: 'ghost', set: { text: 'lost?' } },
        ],
      });
      expect(r2.status).toBe(200);
      const res = (await r2.json()) as {
        ok: boolean;
        changed: boolean;
        rejected: Array<{ id?: string; reason: string }>;
      };
      expect(res.ok).toBe(true);
      expect(res.changed).toBe(true);
      expect(res.rejected).toEqual([{ id: 'ghost', reason: 'gone' }]);
      expect(readFileSync(written, 'utf8')).toBe(board(sticky('s1', 'ONE')));

      // A batch that changes nothing is a no-op, and says so.
      const r3 = await post({
        file,
        actionId: 'act-3',
        ops: [{ op: 'patch', id: 's2', set: { text: 'x' } }],
      });
      expect(await r3.json()).toEqual({
        ok: true,
        changed: false,
        rejected: [{ id: 's2', reason: 'gone' }],
      });
      expect(readFileSync(written, 'utf8')).toBe(board(sticky('s1', 'ONE')));

      // GET reflects the ops.
      const get = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent(file)}`
      );
      expect(await get.text()).toBe(board(sticky('s1', 'ONE')));
    } finally {
      await killProc(proc);
    }
  });

  test('an existing but unreadable board is never treated as empty or written over (review H2)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    const file = '.design/ui/Broken.tsx';
    const written = join(designRoot, 'ui-broken.annotations.json');
    // e.g. a half-resolved git merge — the work is in there, the parser can't read it.
    const broken = `<<<<<<< HEAD\n${BOARD_OK}=======\n${EMPTY_BOARD}>>>>>>> theirs\n`;
    writeFileSync(written, broken);
    try {
      const get = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent(file)}`
      );
      expect(get.status).toBe(409);
      const ops = await fetch(`http://localhost:${port}/_api/annotations/ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file,
          actionId: 'act-h2',
          ops: [{ op: 'put', el: elements(sticky('s9', 'new'))[0] }],
        }),
      });
      expect(ops.status).toBe(409);
      expect((await ops.json()).unreadable).toBe(true);
      const put = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, board: BOARD_OK }),
      });
      expect(put.status).toBe(400);
      expect(readFileSync(written, 'utf8')).toBe(broken);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects malformed requests and non-POST methods', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    const url = `http://localhost:${port}/_api/annotations/ops`;
    try {
      expect((await fetch(url)).status).toBe(405);
      const post = (body: unknown) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await post({ actionId: 'a', ops: [] })).status).toBe(400);
      expect((await post({ file: '.design/ui/X.tsx', actionId: '<bad>', ops: [] })).status).toBe(
        400
      );
      expect((await post({ file: '.design/ui/X.tsx', actionId: 'a', ops: 'nope' })).status).toBe(
        400
      );
    } finally {
      await killProc(proc);
    }
  });
});
