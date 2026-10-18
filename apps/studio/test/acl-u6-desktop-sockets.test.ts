// S9.12b — V2-1.16 U6, the desktop half, and the collab read-only lane on a desktop.
//
// A hub-linked desktop reads its access from hubs.json (the linked hub's stored claim). A
// socket is stamped with that access at the upgrade (S9.11), so before this a role drop or a
// re-sign-in at a narrower claim left every socket open under the OLD, wider one. Now:
//   - a viewer's collab socket (same origin) is read-only: a Y update to a non-comment lane is
//     refused and the room's doc is unchanged;
//   - hubs.json rewritten at the same role (a re-sign-in) or a wider one closes nothing;
//   - rewritten to a narrower role, every socket opened under the wider claim — inspector,
//     collab (both origins), canvas HMR — is closed; the ones opened under the narrower
//     claim stay open.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import { MESSAGE_SYNC } from '../collab/protocol.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';
const A_REL = 'ui/a.tsx';
const SLUG = canvasSlugFromRel(A_REL, '.design');

let proc: Awaited<ReturnType<typeof bootServer>> | null = null;
let main = '';
let canvas = '';
let hubsPath = '';

function writeRole(role: string, token = `t-${role}-${Date.now()}`) {
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [HUB_URL]: { token, linkedAt: Date.now(), role } } })
  );
}

interface Sock {
  ws: WebSocket;
  closed: () => boolean;
  binary: Uint8Array[];
}

function open(url: string): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    let closed = false;
    const binary: Uint8Array[] = [];
    ws.addEventListener('message', (e) => {
      if (e.data instanceof ArrayBuffer) binary.push(new Uint8Array(e.data));
    });
    ws.addEventListener('close', () => {
      closed = true;
    });
    const t = setTimeout(() => reject(new Error(`no socket: ${url}`)), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve({ ws, closed: () => closed, binary });
    });
    ws.addEventListener('error', () => {
      clearTimeout(t);
      reject(new Error(`socket error: ${url}`));
    });
  });
}

async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await Bun.sleep(50);
  }
  return pred();
}

const frame = (write: (e: encoding.Encoder) => void): Uint8Array => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  write(e);
  return encoding.toUint8Array(e);
};

/** The room's doc as a fresh peer sees it: sync step 1 from an empty doc, apply the replies. */
async function roomDoc(): Promise<Y.Doc> {
  const s = await open(`${main}/_ws/collab/${SLUG}`);
  const doc = new Y.Doc();
  s.ws.send(frame((e) => writeSyncStep1(e, doc)));
  await Bun.sleep(600);
  for (const msg of s.binary) {
    const d = decoding.createDecoder(msg);
    if (decoding.readVarUint(d) !== MESSAGE_SYNC) continue;
    readSyncMessage(d, encoding.createEncoder(), doc, 'server');
  }
  s.ws.close();
  return doc;
}

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, A_REL), 'export default () => <div>a</div>;\n');
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  hubsPath = join(root, 'hubs.json');
  writeRole('viewer');
  const port = nextPort();
  proc = await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath });
  main = `ws://localhost:${port}`;
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
  canvas = `ws://localhost:${info.canvasPort}`;
}, 60000);
afterAll(async () => {
  if (proc) await killProc(proc);
});

describe('a hub-linked desktop viewer’s collab socket (same origin)', () => {
  test('a Y update to a non-comment lane is refused; the room is unchanged', async () => {
    const s = await open(`${main}/_ws/collab/${SLUG}`);
    try {
      const peer = new Y.Doc();
      const before = Y.encodeStateVector(peer);
      peer.getMap('annotations2').set('planted', 'VIEWER-WRITE');
      peer.getText('html').insert(0, 'VIEWER-BODY');
      s.ws.send(frame((e) => writeUpdate(e, Y.encodeStateAsUpdate(peer, before))));
      await Bun.sleep(400);
      expect(s.closed()).toBe(false);
    } finally {
      s.ws.close();
    }
    const doc = await roomDoc();
    expect(doc.getMap('annotations2').get('planted')).toBeUndefined();
    expect(doc.getText('html').toString()).not.toContain('VIEWER-BODY');
  }, 20000);
});

describe('U6 — sockets opened under a wider claim close when hubs.json narrows it', () => {
  test('same role and a raise close nothing; a drop closes the wider sockets only', async () => {
    const asViewer = await open(`${main}/_ws`);
    writeRole('member');
    await Bun.sleep(1500); // a raise: nothing closes
    expect(asViewer.closed()).toBe(false);

    const wider = [
      await open(`${main}/_ws`),
      await open(`${main}/_ws/collab/${SLUG}`),
      await open(`${canvas}/_ws/collab/${SLUG}`),
      await open(`${canvas}/_ws`),
    ];
    try {
      writeRole('member', 'a-fresh-sign-in'); // re-sign-in at the same role
      await Bun.sleep(1500);
      expect(wider.map((s) => s.closed())).toEqual([false, false, false, false]);

      writeRole('viewer'); // the role drop
      expect(await until(() => wider.every((s) => s.closed()), 5000)).toBe(true);
      // Opened under the narrower claim: still open.
      expect(asViewer.closed()).toBe(false);
      // And a reconnect gets the new access (read-only, as above).
      const again = await open(`${main}/_ws/collab/${SLUG}`);
      await Bun.sleep(300);
      expect(again.closed()).toBe(false);
      again.ws.close();
    } finally {
      asViewer.ws.close();
      for (const s of wider) s.ws.close();
    }
  }, 30000);
});
