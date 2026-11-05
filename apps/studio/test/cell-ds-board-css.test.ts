// 2.0.4 task P — on a self-hosted workspace cell the design system's own stylesheets answered 403
// to the Design system canvas's frame (design.studyfi.com, v2.0.3).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDsConvert } from '../ds/convert.ts';
import { createDsEngine } from '../ds/engine.ts';
import { type AclCell, asUser, frameCap, get, MEMBER, OWNER, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SYS = 'system/brand';
const BOARD = `${SYS}/design-system.tsx`;
const UI = 'ui/home.tsx';
const SPECIMENS = ['logo', 'colors-accent', 'type-scale', 'buttons'];

let cell: AclCell;
const OWNER_O = asUser(OWNER, 'owner@example.com');
const MEMBER_O = asUser(MEMBER, 'member@example.com');
let dsCss: string[] = [];

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  cfg.designSystems = [
    {
      name: 'brand',
      path: SYS,
      rootClass: 'brand',
      themes: ['light', 'dark'],
      themeDefault: 'light',
    },
  ];
  cfg.defaultDesignSystem = 'brand';
  writeFileSync(join(designRoot, 'config.json'), JSON.stringify(cfg, null, 2));
  mkdirSync(join(designRoot, SYS, 'preview'), { recursive: true });
  writeFileSync(
    join(designRoot, SYS, 'colors_and_type.css'),
    '.brand { --accent: oklch(0.55 0.15 150); --fg-0: #111; --bg-0: #fff; }\n'
  );
  writeFileSync(join(designRoot, SYS, 'preview/_components.css'), '.btn { border-radius: 2px; }\n');
  writeFileSync(join(designRoot, SYS, 'preview/_layout.css'), '.x {}\n');
  for (const s of SPECIMENS)
    writeFileSync(join(designRoot, SYS, `preview/${s}.tsx`), `export default () => <p>${s}</p>;\n`);
  writeFileSync(join(designRoot, UI), 'export default () => <h1>Home</h1>;\n');
  const engine = createDsEngine({ designRoot, kernel: null, log: { warn() {}, error() {} } });
  await createDsConvert(engine).convert({ by: { kind: 'person', name: 'Tereza' } as const });
  const walk = (dir: string, rel: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name), `${rel}/${e.name}`)
        : e.name.endsWith('.css')
          ? [`${rel}/${e.name}`]
          : []
    );
  dsCss = walk(join(designRoot, SYS), SYS);
  const port = nextPort();
  const home = mkdtempSync(join(tmpdir(), 'cell-ds-board-home-'));
  const proc = await bootServer(root, port, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://design.example.com',
    MAUDE_PROJECT_NAME: 'Brand',
  });
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')) as {
    canvasPort?: number;
  };
  cell = {
    proc,
    root,
    designRoot,
    base: `http://localhost:${port}`,
    port,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
}, 60000);

afterAll(async () => {
  if (cell) await killProc(cell.proc);
});

describe('a converted design system on a workspace cell: frames read its stylesheets', () => {
  test('the conversion wrote the board and revision stylesheets', () => {
    expect(readdirSync(join(cell.designRoot, SYS))).toContain('design-system.tsx');
    expect(dsCss.some((r) => r.includes('/revisions/'))).toBe(true);
  });
  for (const [who, h] of [
    ['owner', () => OWNER_O],
    ['member', () => MEMBER_O],
  ] as const) {
    for (const canvas of [BOARD, UI]) {
      test(`${who} frame on ${canvas}: every DS stylesheet → 200`, async () => {
        const fc = (await frameCap(cell, h(), canvas)) as string;
        const out: Record<string, number> = {};
        for (const rel of dsCss)
          out[rel] = (await get(cell.canvasBase + withFc(`/.design/${rel}`, fc), h())).status;
        expect(out).toEqual(Object.fromEntries(dsCss.map((r) => [r, 200])));
      });
    }
    test(`${who} frame: the board module itself → 200`, async () => {
      const fc = (await frameCap(cell, h(), BOARD)) as string;
      const r = await get(cell.canvasBase + withFc(`/.design/${BOARD}`, fc), h());
      expect({ status: r.status, head: r.text.slice(0, 80) }).toMatchObject({ status: 200 });
    }, 60_000);
  }
});
