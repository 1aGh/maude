// S9.11 — the canary cell the L11–L16 studio tests share (V2-1.16 §7 fixture, studio half).
//
// One workspace-mode child with canvas A (`ui/a.tsx`, its CSS and asset) and canvas B
// (`ui/canary-b-zx.tsx`, carrying `CANARY-B-SOURCE`, using the B-only asset whose bytes are
// `CANARY-B-ASSET`). `x-maude-access` is read per request, so the same boot answers the
// owner and an A-only canvas session. A test asserts that nothing an A-only session
// receives contains `canary-b` (case-folded).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { bootServer, makeSandbox, nextPort } from './_helpers.ts';

export const A_REL = 'ui/a.tsx';
export const B_REL = 'ui/canary-b-zx.tsx';
export const A_ASSET = 'assets/aaaa0001.png';
export const B_ASSET = 'assets/bbbb0001.png';

export const A_SRC =
  'import \'./a.css\';\nexport default function A() { return <img src="assets/aaaa0001.png" />; }\n';
export const B_SRC =
  '// CANARY-B-SOURCE\nexport default function B() { return <img src="assets/bbbb0001.png" />; }\n';

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');

export const OWNER: Record<string, string> = {
  'x-maude-access': header({ v: 1, role: 'owner' }),
  'x-maude-role': 'owner',
  'x-maude-readonly': '0',
};
export const MEMBER: Record<string, string> = {
  'x-maude-access': header({ v: 1, role: 'member' }),
  'x-maude-role': 'member',
  'x-maude-readonly': '0',
};
export const VIEWER: Record<string, string> = {
  'x-maude-access': header({ v: 1, role: 'viewer' }),
  'x-maude-role': 'viewer',
  'x-maude-readonly': '1',
};
/** A canvas-only member of A (the proxy vouches read-only: no PROJECT edit role). */
export const A_ONLY: Record<string, string> = {
  'x-maude-access': header({ v: 1, role: null, grants: [{ c: A_REL, r: 'member' }] }),
  'x-maude-readonly': '1',
};

export const hasCanary = (text: string): boolean => /canary-b/i.test(text);

export interface AclCell {
  proc: Subprocess;
  root: string;
  designRoot: string;
  base: string;
  port: number;
  canvasBase: string;
}

export async function bootAclCell(): Promise<AclCell> {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, A_REL), A_SRC);
  writeFileSync(join(designRoot, 'ui', 'a.css'), '.a { color: red }\n');
  writeFileSync(join(designRoot, B_REL), B_SRC);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, A_ASSET), 'A-ASSET-BYTES');
  writeFileSync(join(designRoot, B_ASSET), 'CANARY-B-ASSET');
  const port = nextPort();
  const proc = await bootServer(root, port, {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Canary',
  });
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')) as {
    canvasPort?: number;
  };
  return {
    proc,
    root,
    designRoot,
    base: `http://localhost:${port}`,
    port,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
}

export async function get(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  return { status: r.status, text: await r.text() };
}

/** A socket that records every text frame it hears; `null` when the upgrade was refused. */
export interface Listener {
  ws: WebSocket;
  frames: string[];
  close(): void;
}

export async function listen(
  url: string,
  headers: Record<string, string>
): Promise<Listener | { refused: true; status?: number }> {
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  const frames: string[] = [];
  ws.addEventListener('message', (e) => {
    frames.push(
      typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
    );
  });
  const opened = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve(true);
    });
    ws.addEventListener('error', () => {
      clearTimeout(t);
      resolve(false);
    });
    ws.addEventListener('close', () => {
      clearTimeout(t);
      resolve(false);
    });
  });
  if (!opened) return { refused: true };
  return { ws, frames, close: () => ws.close() };
}

/** Poll until `pred` holds or `ms` elapse. */
export async function until(pred: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await Bun.sleep(50);
  }
  return pred();
}

/** gate-b-c4 — `headers` as member `user` (the proxy's `x-maude-user`: the frame key's subject). */
export const asUser = (headers: Record<string, string>, user: string): Record<string, string> => ({
  ...headers,
  'x-maude-user': user,
});

/**
 * gate-b-c4 — the frame capability the shell mints for `canvas` (designRoot-relative) under this
 * session's `/_config` key (client/frame-cap.js — the same bytes the server verifies), or null.
 */
export async function frameCap(
  cell: { base: string },
  headers: Record<string, string>,
  canvas: string
): Promise<string | null> {
  const { frameCapFor } = await import('../client/frame-cap.js');
  const r = await fetch(`${cell.base}/_config`, { headers });
  const cfg = (await r.json()) as { frameKey?: string };
  return frameCapFor(cfg.frameKey, canvas);
}
