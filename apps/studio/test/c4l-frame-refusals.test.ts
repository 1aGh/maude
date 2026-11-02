// gate-b-c4l — booted halves, on a desktop (the owner's frame) and a cell (a canvas-only member):
//   - the WRAPPER variant (ethical hacker M): B has no DesignCanvas, no meta, no board and renders
//     `<BoardShell>`, the canvas. A imports B. A's frame is refused, and B's source reaches the
//     member by NO door — not as a module through A's frame, not from the main origin's file lane;
//   - a DS specimen imported into a canvas is refused like any canvas (defender M1), while a canvas
//     using the DS's `_` kit and `_layout.css` still renders;
//   - a planted import of a MISSING file and of an existing canvas give the frame the same answer
//     (status and body) — no existence probe (defender L-b).
// Pure halves: c4l-units.test.ts. Hub file plane: apps/hub/test/access-c4l-blocked-walk.test.mjs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { asUser, frameCap, get, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');

const A = 'ui/a.tsx';
const MISSING = 'ui/m.tsx';
const REFUSED = 'ui/r.tsx';
const SPEC_USER = 'ui/s.tsx';
const DS_USER = 'ui/ds.tsx';
const FILES: Record<string, string> = {
  [A]: "import B from './b.tsx';\nexport default () => <main><B /></main>;\n",
  'ui/a.meta.json': '{}\n',
  'ui/b.tsx':
    "import BoardShell from './BoardShell.tsx';\nexport default function B() { return <BoardShell><p>CANARY-B-SECRET</p></BoardShell>; }\n",
  'ui/BoardShell.tsx':
    'import { DesignCanvas, DCSection, DCArtboard } from \'@maude/canvas-lib\';\nexport default function S(p) { return <DesignCanvas><DCSection id="s"><DCArtboard id="a" width={10} height={10}>{p.children}</DCArtboard></DCSection></DesignCanvas>; }\n',
  [MISSING]: "import X from './absent.tsx';\nexport default () => <X />;\n",
  'ui/m.meta.json': '{}\n',
  [REFUSED]: "import X from './other.tsx';\nexport default () => <X />;\n",
  'ui/r.meta.json': '{}\n',
  'ui/other.tsx': 'export default function O() { return <p>CANARY-OTHER</p>; }\n',
  'ui/other.meta.json': '{}\n',
  [SPEC_USER]:
    "import S from '../system/x/preview/button.tsx';\nexport default () => <main><S /></main>;\n",
  'ui/s.meta.json': '{}\n',
  'system/x/preview/button.tsx':
    'export default function Sp() { return <b>CANARY-SPECIMEN</b>; }\n',
  [DS_USER]:
    "import Kit from '../system/x/preview/_kit.tsx';\nimport '../system/x/preview/_layout.css';\nexport default () => <main><Kit /></main>;\n",
  'ui/ds.meta.json': '{}\n',
  'system/x/preview/_kit.tsx': 'export default function K() { return <i>DS-KIT-OK</i>; }\n',
  'system/x/preview/_layout.css': '.kit-layout { display: flex; }\n',
};

interface Booted {
  proc: Subprocess;
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
    base: `http://localhost:${port}`,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
}

const CELL_ENV = {
  MAUDE_WORKSPACE_MODE: '1',
  MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
  HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
  MAUDE_PROJECT_NAME: 'C4l',
};
const GRANTED = [A, MISSING, REFUSED, SPEC_USER, DS_USER];
const member = asUser(
  {
    'x-maude-access': header({
      v: 1,
      role: null,
      grants: GRANTED.map((c) => ({ c, r: 'member' as const })),
    }),
  },
  'm@example.com'
);

function suite(
  label: string,
  env: Record<string, string>,
  who: Record<string, string>,
  cell: boolean
) {
  describe(label, () => {
    let b: Booted;
    beforeAll(async () => {
      b = await boot(env);
    }, 60000);
    afterAll(async () => {
      if (b) await killProc(b.proc);
    });

    const moduleVia = async (frameOn: string, rel: string) => {
      const fc = await frameCap(b, who, frameOn);
      return get(withFc(`${b.canvasBase}/.design/${rel}`, fc), who);
    };

    test('the wrapper variant: A is refused, and B never comes back through A’s frame', async () => {
      const a = await moduleVia(A, A);
      expect(a.status).toBe(403);
      expect(a.text).not.toContain('CANARY-B-SECRET');
      for (const rel of ['ui/b.tsx', 'ui/BoardShell.tsx']) {
        const r = await moduleVia(A, rel);
        expect(r.status).toBe(403);
        expect(r.text).not.toContain('CANARY-B-SECRET');
      }
    }, 30000);

    if (cell)
      test('the wrapper variant: the main origin’s file lane does not serve B to a member of A', async () => {
        const r = await get(`${b.base}/.design/ui/b.tsx`, who);
        expect(r.status).not.toBe(200);
        expect(r.text).not.toContain('CANARY-B-SECRET');
      });

    test('a planted missing import and a planted canvas import answer the frame identically', async () => {
      const missing = await moduleVia(MISSING, MISSING);
      const refused = await moduleVia(REFUSED, REFUSED);
      expect(refused.status).toBe(403);
      expect([missing.status, missing.text]).toEqual([refused.status, refused.text]);
      expect(refused.text).not.toContain('CANARY-OTHER');
    }, 30000);

    test('an imported DS specimen is refused; a canvas on the DS kit + _layout.css renders', async () => {
      const s = await moduleVia(SPEC_USER, SPEC_USER);
      expect(s.status).toBe(403);
      expect(s.text).not.toContain('CANARY-SPECIMEN');
      const ok = await moduleVia(DS_USER, DS_USER);
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('DS-KIT-OK');
    }, 30000);
  });
}

suite('a desktop — the owner’s frame', { MAUDE_NO_AUTOBUILD: '1' }, {}, false);
suite('a cell — a canvas-only member', CELL_ENV, member, true);
