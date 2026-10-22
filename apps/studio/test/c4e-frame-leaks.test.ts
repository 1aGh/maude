// gate-b-c4e — the ethical-hacker round 2 on C4, end to end on a booted cell (workspace mode: the
// sandboxed build) and a booted desktop (the in-process build).
//
//   1. The canvas build could read the frame secret: it sat in `<designRoot>/_state/`, and an
//      `import k from '../_state/frame-cap.key' with { type: 'text' }` inlined its bytes into the
//      module served to the canvas's own frame. The key now lives in this machine's per-project
//      state (`<index dir>/projects/<pid>/`), the old file is deleted, the build refuses any import
//      of DDR-115 runtime state (`_*` first segment), and a built module is served to a frame only
//      when every input it inlined is in the frame's closure (another canvas's board, too).
//   2. The closure followed A's whole import graph — a comment naming `./B.tsx` was enough — so
//      B's source became readable from A's frame. An imported canvas now counts only when the
//      opener's own (unnarrowed) access can read it, and comments / plain strings are not imports.
//   4. Two canvases whose paths fold to one slug (`ui/a-b.tsx`, `ui/a/b.tsx`) share a collab room:
//      a socket joins only the room whose real canvas it can see.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { frameKeyFor, mintFrameCap } from '../access/frame.ts';
import type { AccessClaim } from '../access/scope.ts';
import { pidOf } from '../index/snapshot.ts';
import { asUser, frameCap, get, OWNER, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');
const OWNER_O = asUser(OWNER, 'owner@example.com');
/** A canvas-only member holding exactly `rel` (Can edit there, nothing else). */
const only = (rel: string) =>
  asUser(
    {
      'x-maude-access': header({ v: 1, role: null, grants: [{ c: rel, r: 'member' }] }),
      'x-maude-readonly': '1',
    },
    `member-${rel}@example.com`
  );
/** Any of B's CONTENTS (upper case — a file name like `ui-canary-b-zx` in an error is not). */
const canary = (t: string) => /CANARY-B-/.test(t);
const LEGACY_SECRET = 'ab'.repeat(32);

const B_REL = 'ui/canary-b-zx.tsx';
const FILES: Record<string, string> = {
  // B — a canvas (it has its own meta), its board and comments, and runtime state beside them
  [B_REL]:
    "export const MARK = 'CANARY-B-SOURCE';\nexport default function B() { return <p>{MARK}</p>; }\n",
  'ui/canary-b-zx.meta.json': '{}\n',
  'ui-canary-b-zx.annotations.json': '{"v":2,"note":"CANARY-B-BOARD"}\n',
  '_comments/ui-canary-b-zx.json': '{"note":"CANARY-B-COMMENT"}\n',
  '_state/planted.txt': 'CANARY-B-STATE\n',
  '_state/frame-cap.key': `${LEGACY_SECRET}\n`,
  // 1 — canvases inlining what they must not
  'ui/leak-state.tsx':
    "import k from '../_state/planted.txt' with { type: 'text' };\nexport default () => <p>{k}</p>;\n",
  'ui/leak-key.tsx':
    "import k from '../_state/frame-cap.key' with { type: 'text' };\nexport default () => <p>{k}</p>;\n",
  'ui/leak-comments.tsx':
    "import c from '../_comments/ui-canary-b-zx.json' with { type: 'text' };\nexport default () => <p>{c}</p>;\n",
  'ui/leak-board.tsx':
    "import b from '../ui-canary-b-zx.annotations.json' with { type: 'text' };\nexport default () => <p>{b}</p>;\n",
  // 2 — a canvas importing another canvas, and one that only mentions it
  'ui/imp-b.tsx': "import B from './canary-b-zx.tsx';\nexport default () => <B />;\n",
  'ui/imp-b.meta.json': '{}\n',
  'ui/comment-b.tsx':
    "// import B from './canary-b-zx.tsx'\n/* import './canary-b-zx.tsx'; */\nconst s = \"import './canary-b-zx.tsx'\";\nexport default () => <p>{s.length}</p>;\n",
  // normal canvases: a helper component, a system token file, a JSON data file
  'ui/uses-helper.tsx':
    "import Btn from '../components/button.tsx';\nimport '../system/ds/tokens.css';\nimport d from './data.json';\nexport default () => <Btn label={d.label} />;\n",
  'components/button.tsx':
    'export default function Btn({ label }: { label: string }) { return <button>{label}</button>; }\n',
  'ui/data.json': '{"label":"HELPER-OK"}\n',
  'system/ds/tokens.css': ':root { --token-ok: 1px }\n',
  // 4 — two canvases whose paths fold to the slug `ui-a-b`
  'ui/a-b.tsx': 'export default () => <p>dash</p>;\n',
  'ui/a/b.tsx': 'export default () => <p>nested</p>;\n',
  // gate-b-c4g — the shared slug's comments and board, written for ui/a/b.tsx
  '_comments/ui-a-b.json':
    '[{"id":"c_abababababab","file":".design/ui/a/b.tsx","selector":"[data-dc-screen]","text":"CANARY-B-THREAD","status":"open","created":"2026-10-01T00:00:00.000Z","author":"B","thread":[]}]\n',
  'ui-a-b.annotations.json': '{"v":2,"note":"CANARY-B-SLUG-BOARD"}\n',
  // gate-b-c4g — a directory import a package.json sends out of the design root
  '../outside-c4g.txt': 'CANARY-B-OUTSIDE\n',
  'ui/pkg/package.json': '{"main":"../../../outside-c4g.txt"}\n',
  'ui/leak-pkg.tsx':
    "import x from './pkg' with { type: 'text' };\nexport default () => <p>{x}</p>;\n",
};

interface Booted {
  proc: Subprocess;
  root: string;
  designRoot: string;
  base: string;
  canvasBase: string;
}

async function boot(env: Record<string, string>): Promise<Booted> {
  const { root, designRoot } = makeSandbox();
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  const port = nextPort();
  const proc = await bootServer(root, port, env);
  const info = (await Bun.file(join(designRoot, '_server.json')).json()) as { canvasPort: number };
  return {
    proc,
    root,
    designRoot,
    base: `http://localhost:${port}`,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
}

/** GET `rel`'s module on the canvas origin through a frame opened (by `who`) for `frame`. */
async function moduleVia(b: Booted, who: Record<string, string>, frame: string, rel = frame) {
  const fc = await frameCap(b, who, frame);
  return get(withFc(`${b.canvasBase}/.design/${rel}`, fc), who);
}

function filesNamed(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesNamed(p, name));
    else if (e.name === name) out.push(p);
  }
  return out;
}

describe('a cell (sandboxed build)', () => {
  let cell: Booted;
  beforeAll(async () => {
    cell = await boot({
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Leaks',
    });
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  test('1a — the frame secret is not under the design root; the old one is gone and dead', async () => {
    expect(existsSync(join(cell.designRoot, '_state', 'frame-cap.key'))).toBe(false);
    expect(filesNamed(cell.designRoot, 'frame-cap.key')).toEqual([]);
    const home = join(
      process.env.MAUDE_INDEX_DIR as string,
      'projects',
      pidOf(realpathSync(cell.root)),
      'frame-cap.key'
    );
    expect(existsSync(home)).toBe(true);
    // a capability minted under the planted (old) secret opens nothing
    const key = frameKeyFor(Buffer.from(LEGACY_SECRET, 'hex'), 'owner@example.com');
    const forged = mintFrameCap(key, ['ui/uses-helper.tsx']) as string;
    const r = await get(withFc(`${cell.canvasBase}/.design/ui/uses-helper.tsx`, forged), OWNER_O);
    expect(r.status).toBe(403);
  });

  for (const rel of ['ui/leak-state.tsx', 'ui/leak-key.tsx', 'ui/leak-comments.tsx']) {
    test(`1b — ${rel} (imports runtime state) does not build, even for the owner`, async () => {
      const r = await moduleVia(cell, OWNER_O, rel);
      expect({ rel, ok: r.status === 200 }).toEqual({ rel, ok: false });
      expect(canary(r.text)).toBe(false);
      expect(r.text).not.toContain(LEGACY_SECRET);
    });
  }

  test("1c — a canvas inlining another canvas's board is not served to its frame", async () => {
    const r = await moduleVia(cell, OWNER_O, 'ui/leak-board.tsx');
    expect(r.status).toBe(403);
    expect(canary(r.text)).toBe(false);
  });

  test('c4g 1 — a package.json redirect out of the design root is not inlined (sandbox)', async () => {
    const r = await moduleVia(cell, OWNER_O, 'ui/leak-pkg.tsx');
    expect(r.status === 200).toBe(false);
    expect(canary(r.text)).toBe(false);
  });

  test('2 — a member of A only: A importing canvas B is refused, B never inlined', async () => {
    const r = await moduleVia(cell, only('ui/imp-b.tsx'), 'ui/imp-b.tsx');
    expect(r.status).toBe(403);
    expect(canary(r.text)).toBe(false);
  });

  test('2 — the owner (who reads B) still renders A importing B', async () => {
    const r = await moduleVia(cell, OWNER_O, 'ui/imp-b.tsx');
    expect(r.status).toBe(200);
    expect(r.text).toContain('CANARY-B-SOURCE');
  });

  test('2 — a canvas that only MENTIONS B (comment, string) does not open B to its frame', async () => {
    const who = only('ui/comment-b.tsx');
    expect((await moduleVia(cell, who, 'ui/comment-b.tsx')).status).toBe(200);
    const b = await moduleVia(cell, who, 'ui/comment-b.tsx', B_REL);
    expect(b.status).toBe(403);
    expect(canary(b.text)).toBe(false);
  });

  test('normal canvases still render: a helper component, a system token file, JSON data', async () => {
    for (const who of [OWNER_O, only('ui/uses-helper.tsx')]) {
      const r = await moduleVia(cell, who, 'ui/uses-helper.tsx');
      expect(r.status).toBe(200);
      expect(r.text).toContain('HELPER-OK');
      expect(r.text).toContain('--token-ok');
    }
  });

  test('4 — of two canvases sharing the slug ui-a-b, only the room’s real canvas joins it', async () => {
    const statuses: number[] = [];
    for (const rel of ['ui/a-b.tsx', 'ui/a/b.tsx']) {
      const who = only(rel);
      const fc = await frameCap(cell, who, rel);
      statuses.push((await get(withFc(`${cell.canvasBase}/_ws/collab/ui-a-b`, fc), who)).status);
    }
    // 400 = reached srv.upgrade (a plain GET is no handshake); 403 = not in scope
    expect(statuses.sort()).toEqual([400, 403]);
  });

  test('c4g 3 — a member of ui/a-b.tsx reads none of ui/a/b.tsx’s threads or board (one slug)', async () => {
    const who = only('ui/a-b.tsx');
    const one = await get(`${cell.base}/_comments?file=.design/ui/a-b.tsx`, who);
    const all = await get(`${cell.base}/_comments-all`, who);
    const board = await get(`${cell.base}/.design/ui-a-b.annotations.json`, who);
    expect(canary(one.text + all.text + board.text)).toBe(false);
    // the owner still sees the shared thread (a project session is not narrowed)
    const owner = await get(`${cell.base}/_comments-all`, OWNER_O);
    expect(canary(owner.text)).toBe(true);
  });
});

describe('a desktop (in-process build)', () => {
  let desk: Booted;
  beforeAll(async () => {
    desk = await boot({});
  }, 60000);
  afterAll(async () => {
    if (desk) await killProc(desk.proc);
  });

  test('1a — the frame secret is not under the design root', () => {
    expect(filesNamed(desk.designRoot, 'frame-cap.key')).toEqual([]);
  });

  for (const rel of ['ui/leak-state.tsx', 'ui/leak-key.tsx', 'ui/leak-comments.tsx']) {
    test(`1b — ${rel} does not build`, async () => {
      const r = await moduleVia(desk, {}, rel);
      expect({ rel, ok: r.status === 200 }).toEqual({ rel, ok: false });
      expect(canary(r.text)).toBe(false);
    });
  }

  test("1c — another canvas's board inlined: refused", async () => {
    const r = await moduleVia(desk, {}, 'ui/leak-board.tsx');
    expect(r.status).toBe(403);
    expect(canary(r.text)).toBe(false);
  });

  test('c4g 4 — the refused request wrote no locator for that canvas', async () => {
    const r = await moduleVia(desk, {}, 'ui/leak-board.tsx');
    expect(r.status).toBe(403);
    const loc = join(desk.designRoot, '_locator.json');
    const text = existsSync(loc) ? await Bun.file(loc).text() : '';
    expect(text).not.toContain('leak-board');
  });

  test('c4g 1 — a package.json redirect out of the design root is not inlined', async () => {
    const r = await moduleVia(desk, {}, 'ui/leak-pkg.tsx');
    expect(r.status === 200).toBe(false);
    expect(canary(r.text)).toBe(false);
  });

  test('2 — the desktop owner still renders A importing B; helpers and tokens render', async () => {
    const r = await moduleVia(desk, {}, 'ui/imp-b.tsx');
    expect(r.status).toBe(200);
    const h = await moduleVia(desk, {}, 'ui/uses-helper.tsx');
    expect(h.status).toBe(200);
    expect(h.text).toContain('HELPER-OK');
  });
});
