// p8-c4b — the stored-grant canvas-ness signal (gate-b-c4k's split). An OLD canvas — no meta, no
// board, no DesignCanvas — is "a helper" by its file, so a canvas importing it inlined it into its
// frame and handed its source to a session granted only the importer. A canvas a stored grant names
// is a canvas: the closure refuses it as an import (error card), on the hub, in a cell child (the
// file its hub hands it) and on a hub-linked desktop (its stored claim's grants).
// Hub halves: apps/hub/test/access-known-canvases.test.mjs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { stubClaudeEnv } from '../../../scripts/lib/stub-claude.mjs';
import {
  canvasImportsReport,
  closureConfigOf,
  closureFor,
  type ProjectReader,
  projectClosureConfig,
} from '../access/closure.ts';
import { narrowToFrame } from '../access/frame.ts';
import {
  HUB_KNOWN_CANVASES_ENV,
  knownCanvasesFor,
  readHubKnownCanvases,
} from '../access/known-canvases.ts';
import type { AccessClaim } from '../access/scope.ts';
import { resolveAccess } from '../access/scope.ts';
import { asUser, frameCap, get, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const A = 'ui/a.tsx';
const OLD = 'ui/old-board.tsx';
const CANARY = 'CANARY-OLD-MELESS-CANVAS';
const A_SRC = `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';\nimport Old from './old-board.tsx';\nexport default function A() { return <DesignCanvas><DCSection id="s"><DCArtboard id="a" width={10} height={10}><Old /></DCArtboard></DCSection></DesignCanvas>; }\n`;
// An old canvas: no meta, no board, no DesignCanvas — its file says "helper".
const OLD_SRC = `export default function OldBoard() { return <section>${CANARY}</section>; }\n`;
const FILES: Record<string, string> = {
  [A]: A_SRC,
  'ui/a.meta.json': '{}\n',
  [OLD]: OLD_SRC,
};

function project(files: Record<string, string>): ProjectReader {
  return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
}
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });
const OWNER = resolveAccess({ v: 1, role: 'owner' });

describe('the closure — a known canvas is never inlined', () => {
  for (const [who, access] of [
    ['a canvas-only member of A', member(A)],
    ["the owner's frame on A", narrowToFrame(OWNER, [A])],
  ] as const) {
    test(`${who}: without the signal the old canvas is A's helper (the gap)`, () => {
      const c = closureFor(access, project(FILES));
      expect(c.read.has(OLD)).toBe(true);
      expect(c.blocked.has(A)).toBe(false);
    });

    test(`${who}: a stored grant names it → refused, A blocked, A reads only its own`, () => {
      const cfg = projectClosureConfig(project(FILES), [OLD]);
      const c = closureFor(access, project(FILES), undefined, cfg);
      expect(c.read.has(OLD)).toBe(false);
      expect(c.blocked.has(A)).toBe(true);
      expect(c.read.has(A)).toBe(true);
    });
  }

  test('the error card names it (canvasImportsReport)', () => {
    expect(canvasImportsReport(project(FILES), [A]).get(A)).toBeUndefined();
    expect(
      canvasImportsReport(project(FILES), [A], projectClosureConfig(project(FILES), [OLD])).get(A)
    ).toEqual([OLD]);
  });

  test('a session granted both still reads it (its own grant, U7)', () => {
    const cfg = projectClosureConfig(project(FILES), [OLD]);
    const c = closureFor(member(A, OLD), project(FILES), undefined, cfg);
    expect(c.read.has(OLD)).toBe(true);
    expect(c.blocked.has(A)).toBe(false);
  });

  test('the list is normalized: .tsx/.html only, relative, no traversal, sorted', () => {
    const cfg = closureConfigOf({}, [
      'ui/b.tsx',
      './ui/a.tsx',
      '../x.tsx',
      'ui/c.css',
      7,
      'ui/a.tsx',
    ]);
    expect(cfg.knownCanvases).toEqual(['ui/a.tsx', 'ui/b.tsx']);
  });
});

describe('the studio sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p8-c4b-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("a cell child reads its hub's file (re-read after a rename), nothing without one", () => {
    const file = join(dir, 'known-canvases.json');
    const env = { MAUDE_WORKSPACE_MODE: '1', [HUB_KNOWN_CANVASES_ENV]: file };
    expect(knownCanvasesFor(undefined, env)).toEqual([]);
    writeFileSync(file, JSON.stringify({ canvases: [OLD] }));
    expect(knownCanvasesFor(undefined, env)).toEqual([OLD]);
    writeFileSync(`${file}.tmp`, JSON.stringify({ canvases: [OLD, A] }));
    renameSync(`${file}.tmp`, file);
    expect(readHubKnownCanvases(file)).toEqual([OLD, A]);
    expect(knownCanvasesFor(undefined, { MAUDE_WORKSPACE_MODE: '1' })).toEqual([]);
  });

  test("a hub-linked desktop reads its stored claim's grants; unlinked: none", () => {
    const hubs = join(dir, 'hubs.json');
    const url = 'http://hub.invalid:9';
    writeFileSync(
      hubs,
      JSON.stringify({
        hubs: {
          [url]: {
            token: 't',
            linkedAt: 1,
            access: { v: 1, role: null, grants: [{ c: OLD, r: 'member' }] },
          },
        },
      }),
      { mode: 0o600 }
    );
    const prev = process.env.HUBS_CONFIG_PATH;
    process.env.HUBS_CONFIG_PATH = hubs;
    try {
      expect(knownCanvasesFor({ linkedHub: { url } }, {})).toEqual([OLD]);
      expect(knownCanvasesFor({}, {})).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.HUBS_CONFIG_PATH;
      else process.env.HUBS_CONFIG_PATH = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Booted: the frame on A is refused (403, no canary) once the authority names the old canvas.

interface Booted {
  proc: Subprocess;
  base: string;
  canvasBase: string;
  designRoot: string;
  root: string;
}

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');
const HUB = 'http://hub.invalid:9';

async function boot(
  mode: 'cell' | 'desktop'
): Promise<Booted & { knownFile: string; hubs: string }> {
  const { root, designRoot } = makeSandbox();
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  const home = join(root, 'home');
  mkdirSync(join(home, '.config'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'home/\nhub-data/\n');
  // The hub's own data dir — outside the design root (DDR-054).
  const hubData = join(root, 'hub-data');
  mkdirSync(hubData, { recursive: true });
  const knownFile = join(hubData, 'known-canvases.json');
  const hubs = join(home, 'hubs.json');
  if (mode === 'desktop') {
    const cfgPath = join(designRoot, 'config.json');
    const cfg = JSON.parse(await Bun.file(cfgPath).text());
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, linkedHub: { url: HUB, linkedAt: 1 } }));
  }
  const port = nextPort();
  const proc = await bootServer(root, port, {
    ...stubClaudeEnv(home),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    HUBS_CONFIG_PATH: hubs,
    MAUDE_CLOUD_CONFIG: join(home, 'cloud.json'),
    MAUDE_NO_AUTOBUILD: '1',
    // dead egress: nothing here may reach a network
    HTTPS_PROXY: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    ...(mode === 'cell'
      ? {
          MAUDE_WORKSPACE_MODE: '1',
          MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
          HUB_DASHBOARD_URL: 'http://127.0.0.1:9',
          MAUDE_PROJECT_NAME: 'C4b',
          [HUB_KNOWN_CANVASES_ENV]: knownFile,
        }
      : { MAUDE_APP_BOUND_HUB: HUB }),
  });
  const info = (await Bun.file(join(designRoot, '_server.json')).json()) as { canvasPort: number };
  return {
    proc,
    root,
    designRoot,
    knownFile,
    hubs,
    base: `http://localhost:${port}`,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
}

const writeAtomic = (file: string, text: string) => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};
const storedClaim = (hubs: string, grants: string[]) =>
  writeFileSync(
    hubs,
    JSON.stringify({
      hubs: {
        [HUB]: {
          token: 't',
          linkedAt: 1,
          access: { v: 1, role: null, grants: grants.map((c) => ({ c, r: 'member' })) },
        },
      },
    }),
    { mode: 0o600 }
  );

async function moduleOf(b: Booted, who: Record<string, string>, canvas: string) {
  const fc = await frameCap(b, who, canvas);
  return get(withFc(`${b.canvasBase}/.design/${canvas}`, fc), who);
}

async function until403(b: Booted, who: Record<string, string>) {
  let r = { status: 0, text: '' };
  for (let i = 0; i < 24; i++) {
    r = await moduleOf(b, who, A);
    if (r.status === 403) break;
    await Bun.sleep(250);
  }
  return r;
}

describe('booted — a cell (a member of A only; the hub hands the child its grant set)', () => {
  let b: Awaited<ReturnType<typeof boot>>;
  const who = asUser(
    { 'x-maude-access': header({ v: 1, role: null, grants: [{ c: A, r: 'member' }] }) },
    'm@example.com'
  );
  beforeAll(async () => {
    b = await boot('cell');
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });

  test('before the hub names it, A carries the old canvas (the gap this closes)', async () => {
    const r = await moduleOf(b, who, A);
    expect(r.status).toBe(200);
    expect(r.text).toContain(CANARY);
  });

  test('once the hub file names it, the frame on A is refused and carries none of it', async () => {
    writeAtomic(b.knownFile, JSON.stringify({ canvases: [OLD] }));
    const r = await until403(b, who);
    expect(r.status).toBe(403);
    expect(r.text).not.toContain(CANARY);
  }, 20000);
});

describe("booted — a hub-linked desktop (its stored claim's grants)", () => {
  let b: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    b = await boot('desktop');
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });

  test('a claim granting A only: A carries the old canvas (nothing names it)', async () => {
    storedClaim(b.hubs, [A]);
    const r = await moduleOf(b, {}, A);
    expect(r.status).toBe(200);
    expect(r.text).toContain(CANARY);
  });

  test('a claim granting A and the old canvas: the frame on A is refused (its own grant only)', async () => {
    storedClaim(b.hubs, [A, OLD]);
    const r = await until403(b, {});
    expect(r.status).toBe(403);
    expect(r.text).not.toContain(CANARY);
  }, 20000);
});
