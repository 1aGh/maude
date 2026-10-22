// Phase 8 (G5 fidelity regression) — booted halves of p8-ds-board-specimens.test.ts, on a desktop
// (the owner's frame) and a cell (a canvas-only member granted only the board): a converted Design
// system canvas whose own artboards draw `preview/ui_kits-*.tsx` specimens builds and serves its
// module with every specimen inlined (it was `403 not-in-scope`, a blank page), while a ui/ canvas
// importing the same specimen is still refused.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { designSystemCanvasSource } from '../ds/board/template.ts';
import { asUser, frameCap, get, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');

const BOARD = 'system/x/design-system.tsx';
const SPEC_USER = 'ui/s.tsx';
const FILES: Record<string, string> = {
  [BOARD]: designSystemCanvasSource('x', 'X', [
    {
      id: 'ds-own-ui-kits-desktop-index',
      label: 'Desktop index',
      src: 'preview/ui_kits-desktop-index.tsx',
    },
    {
      id: 'ds-own-ui-kits-desktop-showcase',
      label: 'Desktop showcase',
      src: 'preview/ui_kits-desktop-showcase.tsx',
    },
  ]),
  'system/x/design-system.meta.json': '{"designSystem":"x"}\n',
  'system/x/colors_and_type.css': ':root { --accent: oklch(0.6 0.2 30); }\n',
  'system/x/preview/_layout.css': '.l { display: flex; }\n',
  'system/x/preview/_specimen-controls.tsx':
    'export function SpecimenHeader() { return <h1>HDR</h1>; }\n',
  'system/x/preview/ui_kits-desktop-index.tsx':
    "import './_layout.css';\nimport './ui_kits-desktop-index.css';\nimport { SpecimenHeader } from './_specimen-controls';\nexport default function I() { return <main><SpecimenHeader />CANARY-KIT-INDEX</main>; }\n",
  'system/x/preview/ui_kits-desktop-index.css': '.i { color: red; }\n',
  'system/x/preview/ui_kits-desktop-showcase.tsx':
    "import './ui_kits-desktop-showcase.css';\nexport default function S() { return <main>CANARY-KIT-SHOWCASE</main>; }\n",
  'system/x/preview/ui_kits-desktop-showcase.css': '.s { color: blue; }\n',
  [SPEC_USER]:
    "import S from '../system/x/preview/ui_kits-desktop-index.tsx';\nexport default () => <main><S /></main>;\n",
  'ui/s.meta.json': '{}\n',
};

interface Booted {
  proc: Subprocess;
  base: string;
  canvasBase: string;
}

async function boot(env: Record<string, string>): Promise<Booted> {
  const { root, designRoot } = makeSandbox();
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({
      name: 'test',
      designRoot: '.design',
      canvasGroups: [
        { label: 'System', path: 'system' },
        { label: 'UI', path: 'ui' },
      ],
      designSystems: [{ name: 'x', path: 'system/x' }],
      defaultDesignSystem: 'x',
    })
  );
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
  MAUDE_PROJECT_NAME: 'P8',
};
const boardMember = asUser(
  { 'x-maude-access': header({ v: 1, role: null, grants: [{ c: BOARD, r: 'member' }] }) },
  'm@example.com'
);
const bothMember = asUser(
  {
    'x-maude-access': header({
      v: 1,
      role: null,
      grants: [
        { c: BOARD, r: 'member' },
        { c: SPEC_USER, r: 'member' },
      ],
    }),
  },
  'm@example.com'
);

function suite(
  label: string,
  env: Record<string, string>,
  board: Record<string, string>,
  both: Record<string, string>
) {
  describe(label, () => {
    let b: Booted;
    beforeAll(async () => {
      b = await boot(env);
    }, 60000);
    afterAll(async () => {
      if (b) await killProc(b.proc);
    });

    const moduleVia = async (who: Record<string, string>, frameOn: string, rel: string) => {
      const fc = await frameCap(b, who, frameOn);
      return get(withFc(`${b.canvasBase}/.design/${rel}`, fc), who);
    };

    test('the converted DS board serves its module with every own specimen inlined', async () => {
      const r = await moduleVia(board, BOARD, BOARD);
      expect(r.status).toBe(200);
      expect(r.text).toContain('CANARY-KIT-INDEX');
      expect(r.text).toContain('CANARY-KIT-SHOWCASE');
    }, 30000);

    test('a ui/ canvas importing the same specimen is still refused', async () => {
      const r = await moduleVia(both, SPEC_USER, SPEC_USER);
      expect(r.status).toBe(403);
      expect(r.text).not.toContain('CANARY-KIT-INDEX');
    }, 30000);
  });
}

suite('a desktop — the owner’s frame', { MAUDE_NO_AUTOBUILD: '1' }, {}, {});
suite('a cell — a canvas-only member granted the board', CELL_ENV, boardMember, bothMember);
