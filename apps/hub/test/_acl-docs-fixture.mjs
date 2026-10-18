// Shared fixture for the S9.5 document-door tests (V2-1.16 L2 / L4 / L6 / L11 +
// the hub canary sweep). Not a test file (leading underscore).
//
// Canvas A is the granted one; canvas B is the canary (`canary-b-zx`, carrying
// CANARY-B-SOURCE). Peer tokens are stored exactly as the mint door stores them
// once `peerSessionFields` lets a canvas-only session through (scope '*', the
// claim in `access`, the read_only projection set — the claim decides).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { docSlugOf } from '../src/access-docs.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

export const A = 'ui/Alpha.tsx';
export const B = 'ui/canary-b-zx.tsx';
/** A canvas that does not exist anywhere — the U1 twin of B. */
export const NOPE = 'ui/nothing-here.tsx';
export const docOf = (canvas) => `ws/local/main/${docSlugOf(canvas)}`;

export const CANARY = /canary-b/i;

export function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function rm(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Every role a test walks: owner · member · viewer · observer + canvas-only grants. */
export function seedTokens(dataDir) {
  const add = (label, extra) => addToken(dataDir, { label, scope: '*', ...extra }).value;
  const grant = (r, c = A) => ({ v: 1, role: null, grants: [{ c, r }] });
  return {
    owner: add('owner-mac', { role: 'owner', owner: 'olga@x.test' }),
    member: add('member-mac', { role: 'member', owner: 'max@x.test' }),
    viewer: add('viewer-mac', { role: 'viewer', owner: 'vera@x.test', readOnly: true }),
    // Can view's browser-door cookie: a peer token (S9.2 browser lane).
    observer: add('studio-observer', {
      role: 'observer',
      owner: 'otto@x.test',
      readOnly: true,
      access: { v: 1, role: 'observer' },
    }),
    aEdit: add('petra-mac', { owner: 'petra@x.test', readOnly: true, access: grant('member') }),
    aComment: add('cyril-mac', { owner: 'cyril@x.test', readOnly: true, access: grant('viewer') }),
    aView: add('studio-ada', { owner: 'ada@x.test', readOnly: true, access: grant('observer') }),
  };
}

/**
 * Every provider a test opened. A provider left open after a failed assertion
 * reconnects forever and keeps the test process alive (it held the shared lane
 * once) — `closeAll()` in every file's `after()` is the backstop.
 */
const OPEN = new Set();
export function closeAll() {
  for (const close of OPEN) {
    try {
      close();
    } catch {
      /* already closed */
    }
  }
  OPEN.clear();
}

export async function startHub(dataDir, opts = {}) {
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false, ...opts });
  await built.server.listen();
  await built.acceptedReady;
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');
  return {
    built,
    http,
    ws,
    close: async () => {
      closeAll();
      await built.server.destroy();
    },
  };
}

/**
 * Open one Yjs document. Resolves `{ status: 'synced', scope, doc, provider, close }`
 * or `{ status: <auth-failure reason> }`.
 */
export function openDoc(ws, token, name, { keep = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    let scope = null;
    const timer = setTimeout(() => {
      provider.destroy();
      reject(new Error(`no sync or auth failure for ${name} within 5s`));
    }, 5000);
    const close = () => {
      OPEN.delete(close);
      provider.destroy();
      doc.destroy();
    };
    OPEN.add(close);
    const provider = new HocuspocusProvider({
      url: ws,
      name,
      token,
      document: doc,
      onAuthenticated: (data) => {
        scope = data?.scope ?? null;
      },
      onSynced: () => {
        clearTimeout(timer);
        if (!keep) close();
        resolve({ status: 'synced', scope, doc, provider, close });
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer);
        close();
        resolve({ status: reason });
      },
    });
  });
}

export async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() >= end) throw new Error(`${what} not reached before deadline`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function http(base, token) {
  const headers = (extra = {}) => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const read = async (res) => {
    const text = await res.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* text */
    }
    return { status: res.status, text, body, headers: [...res.headers.entries()] };
  };
  return {
    get: async (path) => read(await fetch(`${base}${path}`, { headers: headers() })),
    post: async (path, body) =>
      read(
        await fetch(`${base}${path}`, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: typeof body === 'string' ? body : JSON.stringify(body),
        })
      ),
    send: async (method, path, body) =>
      read(
        await fetch(`${base}${path}`, {
          method,
          headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      ),
  };
}

let tx = 0;
/** A proposal envelope (DDR-241) for `/api/projects/local/v1/proposals`. */
export function proposal(epoch, operations, extra = {}) {
  return JSON.stringify({
    protocol: 1,
    projectId: 'local',
    epoch,
    transactionId: extra.transactionId ?? `tx_acl_${++tx}_${Date.now()}`,
    origin: { deviceId: 'acl-test', sessionId: 's1' },
    action: { kind: 'edit', label: extra.label ?? 'edit', operations },
  });
}

export const src = (text) => `export default () => <h1>${text}</h1>;\n`;
