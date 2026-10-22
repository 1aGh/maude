// gate-b-c4h (defender round 3, M3) — a canvas that imports another canvas opens READ-ONLY, end to
// end on a booted desktop (the owner) and a booted cell (a member who sees both canvases).
//
// Mallory edits A but cannot see B; she adds `import B from './b.tsx'`; V (who reads B) opens A.
// A's frame builds B into the module — so A still renders for V — but nothing A's frame writes may
// land where Mallory reads it: every write door from that frame is refused (canvas-meta layout,
// the board, board ops, comment replies, asset uploads, photo edits, every collab lane), and the
// shell is told (`/_index-data` `canvasImportsCanvases`) so it frames A `ro=1` and says why. A canvas
// importing only helpers keeps every door it had.

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
const H = 'ui/uses-helper.tsx'; // imports a component only — the control
const B = 'ui/canary-b-zx.tsx';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const thread = (id: string, file: string) =>
  `[{"id":"${id}","file":".design/${file}","selector":"[data-dc-screen]","text":"t","status":"open","created":"2026-10-01T00:00:00.000Z","author":"V","thread":[]}]\n`;

const FILES: Record<string, string> = {
  [B]: "export const MARK = 'CANARY-B-SOURCE';\nexport default function B() { return <p>{MARK}</p>; }\n",
  'ui/canary-b-zx.meta.json': '{}\n',
  [A]: 'import B from \'./canary-b-zx.tsx\';\nexport default () => <div><img src="assets/aaaa0001.png" /><B /></div>;\n',
  'ui/imp-b.meta.json': '{}\n',
  [H]: 'import Btn from \'../components/button.tsx\';\nexport default () => <div><img src="assets/cccc0001.png" /><Btn /></div>;\n',
  'ui/uses-helper.meta.json': '{}\n',
  'components/button.tsx': 'export default function Btn() { return <button>HELPER-OK</button>; }\n',
  'assets/aaaa0001.png': PNG.toString('latin1'),
  'assets/cccc0001.png': PNG.toString('latin1'),
  // existing photo edits (a new one from a frame is a per-use create, judged by its bytes)
  'assets/aaaa0001.photo.json': '{}\n',
  'assets/cccc0001.photo.json': '{}\n',
  '_comments/ui-imp-b.json': thread('c_aaaaaaaaaaaa', A),
  '_comments/ui-uses-helper.json': thread('c_hhhhhhhhhhhh', H),
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
    writeFileSync(join(designRoot, rel), rel.endsWith('.png') ? PNG : text);
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

type Door = {
  name: string;
  send: (b: Booted, fc: string, canvas: string, who: Record<string, string>) => Promise<Response>;
};
/** A JSON request carrying the proxy's headers (a cell; a desktop ignores them). */
const json = (method: string, body: unknown, who: Record<string, string> = {}) => ({
  method,
  headers: { ...who, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const slugOf = (canvas: string) => canvas.replace(/\.tsx$/, '').replace(/\//g, '-');
const assetOf = (canvas: string) => (canvas === A ? 'assets/aaaa0001.png' : 'assets/cccc0001.png');
const threadOf = (canvas: string) => (canvas === A ? 'c_aaaaaaaaaaaa' : 'c_hhhhhhhhhhhh');

/** Every write door a canvas frame has (http.ts CANVAS_SAFE_API + the dynamic reply path). */
const DOORS: Door[] = [
  {
    name: 'PATCH /_api/canvas-meta (layout)',
    send: (b, fc, c, who) =>
      fetch(
        withFc(`${b.canvasBase}/_api/canvas-meta`, fc),
        json('PATCH', { file: `.design/${c}`, patch: { layout: { artboards: [] } } }, who)
      ),
  },
  {
    name: 'PUT /_api/annotations',
    send: (b, fc, c, who) =>
      fetch(
        withFc(`${b.canvasBase}/_api/annotations`, fc),
        json('PUT', { file: `.design/${c}`, board: { v: 2, items: [] } }, who)
      ),
  },
  {
    name: 'POST /_api/annotations/ops',
    send: (b, fc, c, who) =>
      fetch(
        withFc(`${b.canvasBase}/_api/annotations/ops`, fc),
        json('POST', { file: `.design/${c}`, ops: [] }, who)
      ),
  },
  {
    name: 'POST /_api/comments/<id>/reply',
    send: (b, fc, c, who) =>
      fetch(
        withFc(`${b.canvasBase}/_api/comments/${threadOf(c)}/reply`, fc),
        json('POST', { text: 'CANARY-B-SOURCE' }, who)
      ),
  },
  {
    name: 'PUT /_api/photo-edit',
    send: (b, fc, c, who) =>
      fetch(
        withFc(`${b.canvasBase}/_api/photo-edit?asset=${encodeURIComponent(assetOf(c))}`, fc),
        json('PUT', { v: 1, adjust: { exposure: 0.1 } }, who)
      ),
  },
  {
    name: 'POST /_api/asset',
    // gate-b-c4i — an upload names no target; a frame that may edit a canvas of its grant passes
    // (access/request.ts FRAME_UPLOAD_WRITES), so the helper-only canvas's frame is the control.
    send: (b, fc, _c, who) =>
      fetch(withFc(`${b.canvasBase}/_api/asset`, fc), {
        method: 'POST',
        headers: { ...who, 'content-type': 'image/png' },
        body: Buffer.concat([PNG, Buffer.from(String(Math.random()))]),
      }),
  },
];

async function statusOf(door: Door, b: Booted, who: Record<string, string>, canvas: string) {
  const fc = (await frameCap(b, who, canvas)) as string;
  const r = await door.send(b, fc, canvas, who).catch(() => null);
  if (!r) return { status: 0, reason: '' };
  const text = await r.text();
  let reason = '';
  try {
    reason = (JSON.parse(text) as { reason?: string }).reason ?? '';
  } catch {}
  return { status: r.status, reason };
}

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
  d.getMap('comments').set('c_planted', 'CANARY-B-SOURCE');
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

    test('A (imports canvas B) still renders in its frame', async () => {
      const fc = await frameCap(b, who, A);
      const r = await get(withFc(`${b.canvasBase}/.design/${A}`, fc), who);
      expect(r.status).toBe(200);
      expect(r.text).toContain('CANARY-B-SOURCE');
    });

    for (const door of DOORS) {
      test(`${door.name}: refused from A's frame, not from the helper-only canvas's`, async () => {
        const ro = await statusOf(door, b, who, A);
        expect({ door: door.name, ro }).toEqual({
          door: door.name,
          ro: { status: 403, reason: 'read-only' },
        });
        const ok = await statusOf(door, b, who, H);
        expect({ door: door.name, okRefused: ok.status === 403 }).toEqual({
          door: door.name,
          okRefused: false,
        });
      });
    }

    test("the camera (viewport lane) still persists from A's frame — per-user state", async () => {
      const fc = (await frameCap(b, who, A)) as string;
      const r = await fetch(
        withFc(`${b.canvasBase}/_api/canvas-meta`, fc),
        json('PATCH', { file: `.design/${A}`, patch: { viewport: { x: 1, y: 2, zoom: 1 } } }, who)
      );
      expect(r.status).toBe(200);
    });

    test("collab: A's frame writes no lane (comments included); the helper-only canvas's does", async () => {
      expect(await collabWriteReaches(b, who, A)).toBe(false);
      expect(await collabWriteReaches(b, who, H)).toBe(true);
    });

    test('the shell is told: /_index-data names A → B, and not the helper-only canvas', async () => {
      const r = await get(`${b.base}/_index-data`, who);
      const data = JSON.parse(r.text) as { canvasImportsCanvases?: Record<string, string[]> };
      expect(data.canvasImportsCanvases).toEqual({ [`.design/${A}`]: [B] });
    });
  });
}

suite('a desktop — the owner opens A', {}, {});
suite(
  'a cell — a member who sees A and B opens A',
  {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'C4h',
  },
  asUser(
    {
      'x-maude-access': header({
        v: 1,
        role: null,
        grants: [
          { c: A, r: 'member' },
          { c: B, r: 'member' },
          { c: H, r: 'member' },
        ],
      }),
      'x-maude-readonly': '1',
    },
    'v@example.com'
  )
);
