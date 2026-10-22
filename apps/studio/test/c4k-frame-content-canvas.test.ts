// gate-b-c4k — booted halves: a frame never inlines a canvas the FILE says is a canvas, wherever it
// sits and whatever this machine's config names (M1, M2), on a desktop (the owner) and a cell (a
// member of A only). A real component (`ui/components/Button.tsx`, no DesignCanvas) still renders,
// and a canvas that built clean is refused once it gains a foreign canvas import (the HMR swap: the
// same module URL fetched again). The index halves are unit tests (c4k-units.test.ts).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { asUser, frameCap, get, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');

const CANVAS = (mark: string) =>
  `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';\nexport const MARK = '${mark}';\nexport default function C() { return <DesignCanvas><DCSection id="s"><DCArtboard id="a" width={10} height={10}><p>{MARK}</p></DCArtboard></DCSection></DesignCanvas>; }\n`;

const A = 'ui/imports-canvases.tsx';
const HOME = 'ui/home.tsx';
const SWAP = 'ui/swap.tsx';
const SWAP_CLEAN =
  "import Button from './components/Button.tsx';\nexport default () => <main><Button /></main>;\n";
const SWAP_DIRTY =
  "import Button from './components/Button.tsx';\nimport O from './other.tsx';\nexport default () => <main><Button /><O /></main>;\n";

const FILES: Record<string, string> = {
  [A]: "import C1 from './components/Secret.tsx';\nimport C2 from '../system/x/Board.tsx';\nimport C3 from '../elsewhere/Plan.tsx';\nexport default () => <div><C1 /><C2 /><C3 /></div>;\n",
  'ui/imports-canvases.meta.json': '{}\n',
  // meta-less canvases at paths c4j called components, and in a group this machine does not know
  'ui/components/Secret.tsx': CANVAS('CANARY-COMPONENTS-DIR'),
  'system/x/Board.tsx': CANVAS('CANARY-SYSTEM-DIR'),
  'elsewhere/Plan.tsx': CANVAS('CANARY-UNKNOWN-GROUP'),
  [HOME]:
    "import Button from './components/Button.tsx';\nexport default () => <main><Button /></main>;\n",
  'ui/home.meta.json': '{}\n',
  'ui/components/Button.tsx':
    'export default function Button() { return <button>BUTTON-COMPONENT-OK</button>; }\n',
  [SWAP]: SWAP_CLEAN,
  // the canvas SWAP gains: a canvas by its meta (the c4j rule), so this pins the serve-time gate
  'ui/other.tsx': 'export default function O() { return <p>CANARY-OTHER</p>; }\n',
  'ui/other.meta.json': '{}\n',
  'ui/swap.meta.json': '{}\n',
};
const CANARIES = ['CANARY-COMPONENTS-DIR', 'CANARY-SYSTEM-DIR', 'CANARY-UNKNOWN-GROUP'];

interface Booted {
  proc: Subprocess;
  base: string;
  canvasBase: string;
  designRoot: string;
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
    designRoot,
  };
}

async function moduleOf(b: Booted, who: Record<string, string>, canvas: string) {
  const fc = await frameCap(b, who, canvas);
  return get(withFc(`${b.canvasBase}/.design/${canvas}`, fc), who);
}

const CELL_ENV = {
  MAUDE_WORKSPACE_MODE: '1',
  MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
  HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
  MAUDE_PROJECT_NAME: 'C4k',
};
const memberOf = (canvases: string[], user: string) =>
  asUser(
    {
      'x-maude-access': header({
        v: 1,
        role: null,
        grants: canvases.map((c) => ({ c, r: 'member' as const })),
      }),
    },
    user
  );

function suite(label: string, env: Record<string, string>, who: Record<string, string>) {
  describe(label, () => {
    let b: Booted;
    beforeAll(async () => {
      b = await boot(env);
    }, 60000);
    afterAll(async () => {
      if (b) await killProc(b.proc);
    });

    test('A (imports three meta-less DesignCanvas files) is refused, carrying none of them', async () => {
      const r = await moduleOf(b, who, A);
      expect(r.status).toBe(403);
      for (const c of CANARIES) expect(r.text).not.toContain(c);
    });

    test('home renders with its component (no DesignCanvas: importable)', async () => {
      const r = await moduleOf(b, who, HOME);
      expect(r.status).toBe(200);
      expect(r.text).toContain('BUTTON-COMPONENT-OK');
    });

    test('a clean canvas that gains a foreign canvas import is refused on the next fetch', async () => {
      const clean = await moduleOf(b, who, SWAP);
      expect(clean.status).toBe(200);
      writeFileSync(join(b.designRoot, SWAP), SWAP_DIRTY);
      let r = { status: 0, text: '' };
      for (let i = 0; i < 24; i++) {
        await Bun.sleep(250);
        r = await moduleOf(b, who, SWAP);
        if (r.status === 403) break;
      }
      expect(r.status).toBe(403);
      expect(r.text).not.toContain('CANARY-OTHER');
    }, 20000);
  });
}

suite('a desktop — the owner', {}, {});
suite(
  'a cell — a member of A, home and swap only',
  CELL_ENV,
  memberOf([A, HOME, SWAP], 'm@example.com')
);
