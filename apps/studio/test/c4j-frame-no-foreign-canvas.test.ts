// gate-b-c4j — a frame never inlines a canvas outside its own grant, end to end on a booted desktop
// (the owner) and a booted cell (a member who sees every canvas, and a member of one canvas only).
// Supersedes gate-b-c4h's "an importing frame is read-only" (this file was c4h-import-read-only).
//
// Mallory edits A but cannot see B; she adds `import B from './b.tsx'`; V (who reads B) opens A. A's
// frame does not build B in: B is not in the frame's closure, so the serve-time inputs gate refuses
// A's module (403) — for the desktop owner too — and B's text never reaches A's frame, so nothing A
// writes can carry it. A is otherwise an ordinary canvas: no read-only mode, no closed lanes. The shell
// is told (`/_index-data` `canvasImportsCanvases`) so it shows why on A. A canvas importing a
// COMPONENT — the default layout, `ui/home.tsx` → `ui/components/Button.tsx` — renders for all (M1).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import * as Y from 'yjs';

import type { AccessClaim } from '../access/scope.ts';
import { encodeSyncUpdate, MESSAGE_SYNC } from '../collab/protocol.ts';
import { asUser, frameCap, get, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');

const A = 'ui/imp-b.tsx'; // imports canvas B
const H = 'ui/uses-helper.tsx'; // imports a helper outside the groups — the control
const HOME = 'ui/home.tsx'; // imports a component in the default newComponentDir (M1)
const B = 'ui/canary-b-zx.tsx';

const FILES: Record<string, string> = {
  [B]: "export const MARK = 'CANARY-B-SOURCE';\nexport default function B() { return <p>{MARK}</p>; }\n",
  'ui/canary-b-zx.meta.json': '{}\n',
  [A]: "import B from './canary-b-zx.tsx';\nexport default () => <div><B /></div>;\n",
  'ui/imp-b.meta.json': '{}\n',
  [H]: "import Btn from '../components/button.tsx';\nexport default () => <div><Btn /></div>;\n",
  'ui/uses-helper.meta.json': '{}\n',
  'components/button.tsx': 'export default function Btn() { return <button>HELPER-OK</button>; }\n',
  [HOME]:
    "import Button from './components/Button.tsx';\nexport default () => <main><Button /></main>;\n",
  'ui/home.meta.json': '{}\n',
  'ui/components/Button.tsx':
    'export default function Button() { return <button>BUTTON-COMPONENT-OK</button>; }\n',
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

/** The canvas module as `canvas`'s own frame loads it. */
async function moduleOf(b: Booted, who: Record<string, string>, canvas: string) {
  const fc = await frameCap(b, who, canvas);
  return get(withFc(`${b.canvasBase}/.design/${canvas}`, fc), who);
}

const slugOf = (canvas: string) => canvas.replace(/\.tsx$/, '').replace(/\//g, '-');

/** Collab: does a comments-lane write from `canvas`'s frame reach a main-origin peer? */
async function collabWriteReaches(b: Booted, who: Record<string, string>, canvas: string) {
  const fc = (await frameCap(b, who, canvas)) as string;
  const slug = slugOf(canvas);
  const open = (url: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: who } as unknown as string[]);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error(`ws ${url}`));
    });
  const peer = await open(`${b.base.replace('http', 'ws')}/_ws/collab/${slug}`);
  const got: Uint8Array[] = [];
  peer.onmessage = (e) => got.push(new Uint8Array(e.data as ArrayBuffer));
  const writer = await open(withFc(`${b.canvasBase.replace('http', 'ws')}/_ws/collab/${slug}`, fc));
  await Bun.sleep(700);
  got.length = 0;
  const d = new Y.Doc();
  d.getMap('comments').set('c_planted', 'a comment');
  writer.send(encodeSyncUpdate(Y.encodeStateAsUpdate(d)));
  await Bun.sleep(900);
  writer.close();
  peer.close();
  return got.some((m) => m[0] === MESSAGE_SYNC);
}

function suite(label: string, env: Record<string, string>, who: Record<string, string>) {
  describe(label, () => {
    let b: Booted;
    beforeAll(async () => {
      b = await boot(env);
    }, 60000);
    afterAll(async () => {
      if (b) await killProc(b.proc);
    });

    test("A (imports canvas B) is refused in its own frame, and carries none of B's text", async () => {
      const r = await moduleOf(b, who, A);
      expect(r.status).toBe(403);
      expect(r.text).not.toContain('CANARY-B-SOURCE');
    });

    test('B renders in its own frame (the control)', async () => {
      const r = await moduleOf(b, who, B);
      expect(r.status).toBe(200);
      expect(r.text).toContain('CANARY-B-SOURCE');
    });

    test('a helper and a component (ui/components/Button.tsx) still come along', async () => {
      const h = await moduleOf(b, who, H);
      expect(h.status).toBe(200);
      expect(h.text).toContain('HELPER-OK');
      const home = await moduleOf(b, who, HOME);
      expect(home.status).toBe(200);
      expect(home.text).toContain('BUTTON-COMPONENT-OK');
    });

    test("A's frame is not read-only any more: its own meta takes a layout write", async () => {
      const fc = (await frameCap(b, who, A)) as string;
      const r = await fetch(withFc(`${b.canvasBase}/_api/canvas-meta`, fc), {
        method: 'PATCH',
        headers: { ...who, 'content-type': 'application/json' },
        body: JSON.stringify({ file: `.design/${A}`, patch: { layout: { artboards: [] } } }),
      });
      expect(r.status).toBe(200);
    });

    test("collab: A's frame writes its lanes like the helper canvas's (no lanes closed)", async () => {
      // the comments lane as c4h measured it: a Can comment session (a desktop ignores the header)
      const commenter = { ...who, 'x-maude-readonly': '1' };
      expect({
        H: await collabWriteReaches(b, commenter, H),
        A: await collabWriteReaches(b, commenter, A),
      }).toEqual({ H: true, A: true });
    });

    test('the shell is told: /_index-data names A → B, and nothing else', async () => {
      const r = await get(`${b.base}/_index-data`, who);
      const data = JSON.parse(r.text) as { canvasImportsCanvases?: Record<string, string[]> };
      expect(data.canvasImportsCanvases).toEqual({ [`.design/${A}`]: [B] });
    });
  });
}

const CELL_ENV = {
  MAUDE_WORKSPACE_MODE: '1',
  MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
  HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
  MAUDE_PROJECT_NAME: 'C4j',
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

suite('a desktop — the owner opens A', {}, {});
suite(
  'a cell — a member who sees A and B opens A',
  CELL_ENV,
  memberOf([A, B, H, HOME], 'v@example.com')
);

describe('a cell — a member of ui/home.tsx only (the default component layout, M1)', () => {
  let b: Booted;
  const who = memberOf([HOME], 'h@example.com');
  beforeAll(async () => {
    b = await boot(CELL_ENV);
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });
  test('home renders with its component', async () => {
    const r = await moduleOf(b, who, HOME);
    expect(r.status).toBe(200);
    expect(r.text).toContain('BUTTON-COMPONENT-OK');
  });
});
