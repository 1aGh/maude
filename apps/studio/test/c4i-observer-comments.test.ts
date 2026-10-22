// gate-b-c4i — Can view (`observer`) does not comment on the studio's sockets either.
//
// The role table (access/roles.ts) holds `observer` to read, session and request — no `comment`;
// `viewer` (Can comment) is the role that comments. The HTTP comment writes already refused an
// observer (access-local-gate), but the sockets stamped only `readOnly`, and a read-only collab
// conn keeps the comments lane writable (collab/room.ts — the Can comment path), so an observer's
// comment synced to every peer, on the main AND the canvas listener; the inspector socket's
// `comments-add` stored one too. Now a socket whose access cannot comment on its canvas writes no
// lane at all (presence stays live), and the inspector refuses its comment frames.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as Y from 'yjs';

import type { AccessClaim } from '../access/scope.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { encodeSyncUpdate, MESSAGE_SYNC } from '../collab/protocol.ts';
import {
  A_REL,
  type AclCell,
  asUser,
  bootAclCell,
  frameCap,
  OWNER,
  until,
  VIEWER,
  withFc,
} from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');
const OBSERVER: Record<string, string> = {
  'x-maude-access': header({ v: 1, role: 'observer' }),
  'x-maude-role': 'observer',
  'x-maude-readonly': '1',
};
/** A Can view grant on A only (no project role). */
const A_VIEW_ONLY: Record<string, string> = {
  'x-maude-access': header({ v: 1, role: null, grants: [{ c: A_REL, r: 'observer' }] }),
  'x-maude-readonly': '1',
};
const A_SLUG = canvasSlugFromRel(A_REL, '.design');

function commentLane(key: string): Uint8Array {
  const d = new Y.Doc();
  d.getMap('comments').set(key, `note-${key}`);
  return encodeSyncUpdate(Y.encodeStateAsUpdate(d));
}

interface Sock {
  ws: WebSocket;
  frames: Uint8Array[];
  texts: string[];
}

async function openSocket(url: string, headers: Record<string, string>): Promise<Sock | null> {
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  ws.binaryType = 'arraybuffer';
  const frames: Uint8Array[] = [];
  const texts: string[] = [];
  ws.addEventListener('message', (e) => {
    if (e.data instanceof ArrayBuffer) frames.push(new Uint8Array(e.data));
    else if (typeof e.data === 'string') texts.push(e.data);
  });
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    const done = (v: boolean) => () => {
      clearTimeout(t);
      resolve(v);
    };
    ws.addEventListener('open', done(true));
    ws.addEventListener('error', done(false));
    ws.addEventListener('close', done(false));
  });
  return ok ? { ws, frames, texts } : null;
}

const isSync = (f: Uint8Array) => f[0] === MESSAGE_SYNC;

describe('booted cell — a Can view socket writes no comment', () => {
  let cell: AclCell;
  beforeAll(async () => {
    cell = await bootAclCell();
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  const sessions = {
    owner: asUser(OWNER, 'owner@example.com'),
    observer: asUser(OBSERVER, 'observer@example.com'),
    aViewOnly: asUser(A_VIEW_ONLY, 'grantee@example.com'),
    viewer: asUser(VIEWER, 'viewer@example.com'),
  };
  async function openAs(origin: 'canvas' | 'main', who: keyof typeof sessions) {
    const headers = sessions[who];
    const base = origin === 'canvas' ? cell.canvasBase : cell.base;
    const url = `${base.replace('http', 'ws')}/_ws/collab/${A_SLUG}`;
    if (origin === 'main') return openSocket(url, headers);
    return openSocket(withFc(url, await frameCap(cell, headers, A_REL)), headers);
  }

  /** Does a comments-lane write from `who`'s socket reach the owner's peer socket? */
  async function reaches(origin: 'canvas' | 'main', who: keyof typeof sessions) {
    const owner = await openAs(origin, 'owner');
    const writer = await openAs(origin, who);
    expect({ who, owner: !!owner, writer: !!writer }).toEqual({ who, owner: true, writer: true });
    if (!owner || !writer) return true;
    await Bun.sleep(300);
    owner.frames.length = 0;
    writer.ws.send(commentLane(`${who}-${origin}`));
    const got = await until(() => owner.frames.some(isSync), 1200);
    owner.ws.close();
    writer.ws.close();
    return got;
  }

  for (const origin of ['main', 'canvas'] as const) {
    test(`${origin} collab: a Can view member's comment never reaches a peer`, async () => {
      expect(await reaches(origin, 'observer')).toBe(false);
    });
    test(`${origin} collab: a Can view grant's comment never reaches a peer`, async () => {
      expect(await reaches(origin, 'aViewOnly')).toBe(false);
    });
    test(`${origin} collab: control — a Can comment viewer's comment does`, async () => {
      expect(await reaches(origin, 'viewer')).toBe(true);
    });
  }

  test("inspector: a Can view member's comments-add is refused and never stored", async () => {
    const url = `${cell.base.replace('http', 'ws')}/_ws`;
    const sidecar = join(cell.designRoot, '_comments', `${A_SLUG}.json`);
    const read = (): Array<{ text?: string }> => {
      try {
        const j = JSON.parse(readFileSync(sidecar, 'utf8'));
        return Array.isArray(j) ? j : (j.comments ?? []);
      } catch {
        return [];
      }
    };
    const add = (text: string) =>
      JSON.stringify({
        type: 'comments-add',
        payload: { file: `.design/${A_REL}`, selector: 'img', text },
      });
    const observer = await openSocket(url, sessions.observer);
    expect(observer).not.toBeNull();
    if (!observer) return;
    observer.ws.send(add('observer note'));
    expect(
      await until(
        () => observer.texts.some((t) => t.includes('"refused"') && t.includes('read-only')),
        3000
      )
    ).toBe(true);
    // control: a Can comment viewer still comments over the same socket kind
    const viewer = await openSocket(url, sessions.viewer);
    expect(viewer).not.toBeNull();
    if (!viewer) return;
    viewer.ws.send(add('viewer note'));
    expect(await until(() => read().some((c) => c.text === 'viewer note'), 5000)).toBe(true);
    expect(read().some((c) => c.text === 'observer note')).toBe(false);
    for (const s of [observer, viewer]) s.ws.close();
  });
});
