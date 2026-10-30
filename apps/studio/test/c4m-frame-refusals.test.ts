// gate-b-c4m — booted halves, on a desktop (the owner's frame) and a cell (a canvas-only member):
//   - ethical hacker round 7 (M): A imports `./b.html` (an `.html` canvas) or `./notes.md` as text —
//     A's frame is refused and B's bytes reach the member by no door (frame, main-origin file lane);
//   - defender M-B: a canvas lifting a DS specimen's stylesheet (`.design/ui/v2/01 Create Flow.tsx`
//     imports `preview/empty-state.css`) still renders for the owner and a member;
//   - defender L-B: an import the walk cannot see (a template-literal `import()`, a CSS
//     `@import url(...)`) that fails the build answers the frame like a refusal — no 500 existence
//     oracle.
// Pure halves: c4m-units.test.ts. Hub file plane: apps/hub/test/access-c4m-html-import.test.mjs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { asUser, frameCap, get, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');

const HTML_USER = 'ui/a.tsx';
const MD_USER = 'ui/n.tsx';
const LIFT = 'ui/v2/01 Create Flow.tsx';
const OK = 'ui/ok.tsx';
const FILES: Record<string, string> = {
  'config.json': JSON.stringify({
    designSystems: [{ name: 'x', path: 'system/x' }],
    defaultDesignSystem: 'x',
  }),
  'system/x/tokens.css': ':root { --a: 1; }\n',
  'system/x/preview/empty-state.tsx':
    "import './empty-state.css';\nexport default function S() { return <b>CANARY-SPECIMEN</b>; }\n",
  'system/x/preview/empty-state.css': '.lifted-empty-state { display: grid; }\n',
  [HTML_USER]:
    "import B from './b.html' with { type: 'text' };\nexport default () => <main>{B}</main>;\n",
  'ui/a.meta.json': '{}\n',
  'ui/b.html': '<html><body>CANARY-B-HTML</body></html>\n',
  [MD_USER]:
    "import N from './notes.md' with { type: 'text' };\nexport default () => <main>{N}</main>;\n",
  'ui/n.meta.json': '{}\n',
  'ui/notes.md': '# CANARY-NOTES\n',
  [LIFT]:
    'import { DesignCanvas, DCSection, DCArtboard } from \'@maude/canvas-lib\';\nimport \'../../system/x/preview/empty-state.css\';\nexport default function C() { return <DesignCanvas><DCSection id="s"><DCArtboard id="a" width={10} height={10}><p className="lifted-empty-state">LIFT-OK</p></DCArtboard></DCSection></DesignCanvas>; }\n',
  'ui/v2/01 Create Flow.meta.json': '{}\n',
  [OK]: 'export default () => <main>OK-RENDER</main>;\n',
  'ui/ok.meta.json': '{}\n',
  // defender L-B — imports the closure walk does not follow, missing vs existing
  'ui/t1.tsx': 'const m = import(`./absent.tsx`);\nexport default () => <main />;\n',
  'ui/t1.meta.json': '{}\n',
  'ui/t2.tsx': 'const m = import(`./other.tsx`);\nexport default () => <main />;\n',
  'ui/t2.meta.json': '{}\n',
  'ui/other.tsx': 'export default function O() { return <p>CANARY-OTHER</p>; }\n',
  'ui/other.meta.json': '{}\n',
  'ui/c1.tsx': "import './c1.css';\nexport default () => <main />;\n",
  'ui/c1.meta.json': '{}\n',
  'ui/c1.css': '@import url(./absent.css);\n',
  'ui/c2.tsx': "import './c2.css';\nexport default () => <main />;\n",
  'ui/c2.meta.json': '{}\n',
  'ui/c2.css': '@import url(./other.css);\n',
  'ui/other.css': '.canary-other-css { color: red; }\n',
  'ui/u1.tsx': "import './u1.css';\nexport default () => <main />;\n",
  'ui/u1.meta.json': '{}\n',
  'ui/u1.css': '.u { background: url(./absent.png); }\n',
  'ui/u2.tsx': "import './u2.css';\nexport default () => <main />;\n",
  'ui/u2.meta.json': '{}\n',
  'ui/u2.css': '.u { background: url(./secret.png); }\n',
  'ui/secret.png': 'PNG-CANARY',
  'ui/syntax.tsx': 'export default () => <main>{</main>;\n',
  'ui/syntax.meta.json': '{}\n',
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
const PAIRS: Array<[string, string, string]> = [
  ['a template-literal import()', 'ui/t1.tsx', 'ui/t2.tsx'],
  ['a CSS @import url()', 'ui/c1.tsx', 'ui/c2.tsx'],
  ['a CSS background url()', 'ui/u1.tsx', 'ui/u2.tsx'],
];
const GRANTED = [
  HTML_USER,
  MD_USER,
  LIFT,
  OK,
  'ui/syntax.tsx',
  ...PAIRS.flatMap(([, x, y]) => [x, y]),
];
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
const enc = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');

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
      return get(withFc(`${b.canvasBase}/.design/${enc(rel)}`, fc), who);
    };

    test('A imports ./b.html as text: A is refused, B never comes back', async () => {
      const a = await moduleVia(HTML_USER, HTML_USER);
      expect(a.status).toBe(403);
      expect(a.text).not.toContain('CANARY-B-HTML');
      const r = await moduleVia(HTML_USER, 'ui/b.html');
      expect(r.status).not.toBe(200);
      expect(r.text).not.toContain('CANARY-B-HTML');
    }, 30000);

    test('A imports ./notes.md as text: refused', async () => {
      const n = await moduleVia(MD_USER, MD_USER);
      expect(n.status).toBe(403);
      expect(n.text).not.toContain('CANARY-NOTES');
    }, 30000);

    if (cell)
      test('the main origin’s file lane does not serve b.html to a member of A', async () => {
        const r = await get(`${b.base}/.design/ui/b.html`, who);
        expect(r.status).not.toBe(200);
        expect(r.text).not.toContain('CANARY-B-HTML');
      });

    test('a canvas lifting a specimen stylesheet renders (defender M-B)', async () => {
      const ok = await moduleVia(LIFT, LIFT);
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('LIFT-OK');
      expect(ok.text).not.toContain('CANARY-SPECIMEN');
    }, 30000);

    for (const [what, missing, present] of PAIRS)
      test(`${what}: a missing and an existing target answer the frame identically (defender L-B)`, async () => {
        const m = await moduleVia(missing, missing);
        const p = await moduleVia(present, present);
        expect(m.status).toBe(p.status);
        // a refusal is one body; a built module never carries the target's bytes
        if (m.status !== 200) expect(m.text).toBe(p.text);
        expect(p.text).not.toContain('CANARY');
      }, 30000);

    if (!cell)
      test('the owner still reads a syntax error in the canvas’s own source', async () => {
        const r = await moduleVia('ui/syntax.tsx', 'ui/syntax.tsx');
        expect(r.status).toBe(500);
        expect(r.text).toContain('Transpile error');
      }, 30000);
  });
}

suite('a desktop — the owner’s frame', { MAUDE_NO_AUTOBUILD: '1' }, {}, false);
suite('a cell — a canvas-only member', CELL_ENV, member, true);
