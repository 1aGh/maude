// The two-canvas project the S9.4 leak-row tests share (V2-1.16 L1, L3, L5).
//
//   ui/a.tsx  imports ui/a-styles.css, references assets/a-only.png + assets/shared.png
//   ui/b.tsx  imports ui/b-styles.css, references assets/b-only.png + assets/shared.png
//   assets/b-only.photo.json — a sidecar of B's asset
//
// A canvas-only token for A is minted the way the mint door mints one
// (`peerTokenDoor` → `peerSessionFields` → `addToken`), so the stored fields are
// exactly the fail-closed projection a real canvas-only session carries.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { peerTokenDoor } from '../../studio/access/scope.ts';
import { resetFileAccessCaches } from '../src/access-files.mjs';
import { peerSessionFields } from '../src/cloud-identity.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const png = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n]);

export const PROJECT = {
  'config.json': JSON.stringify({ name: 'acl', canvasGroups: [{ label: 'UI', path: 'ui' }] }),
  'ui/a.tsx': `import './a-styles.css';\nexport default function A() {\n  return <div><img src="assets/a-only.png" /><img src="assets/shared.png" /></div>;\n}\n`,
  'ui/a-styles.css': '.a { color: red; }\n',
  'ui/b.tsx': `import './b-styles.css';\nexport default function B() {\n  return <div><img src="assets/b-only.png" /><img src="assets/shared.png" /></div>;\n}\n`,
  'ui/b-styles.css': '.b { color: blue; }\n',
  'assets/a-only.png': png(1),
  'assets/b-only.png': png(2),
  'assets/shared.png': png(3),
  'assets/b-only.photo.json': JSON.stringify({ v: 1, adjust: { exposure: 0.2 } }),
};

/** What canvas A's closure holds of the plane-B files above. */
export const A_VISIBLE = ['assets/a-only.png', 'assets/shared.png', 'ui/a-styles.css'];
/** What it must never learn exists. */
export const B_ONLY = ['assets/b-only.png', 'assets/b-only.photo.json', 'ui/b-styles.css'];

export function writeProject(designRoot, files = PROJECT) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(designRoot, rel)), { recursive: true });
    writeFileSync(join(designRoot, rel), body);
  }
}

/** A canvas-only peer token, minted through the real door + session fields. */
export function canvasOnlyToken(dataDir, label, grants) {
  const door = peerTokenDoor({ v: 1, role: null, grants }, { declaredAccess: 2 });
  if (door.outcome !== 'mint') throw new Error(`mint door said ${door.outcome}`);
  return addToken(dataDir, { label, owner: `${label}@x.test`, ...peerSessionFields(door) }).value;
}

/** Boot a workspace hub over the fixture; returns { http, tokens, designRoot, dataDir, stop }. */
export async function bootAclHub(prefix, { files } = {}) {
  resetFileAccessCaches();
  const dataDir = mkdtempSync(join(tmpdir(), `${prefix}-data-`));
  const repoDir = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  const designRoot = join(repoDir, '.design');
  writeProject(designRoot, files ?? PROJECT);
  const saved = {
    HUB_WORKSPACE_MODE: process.env.HUB_WORKSPACE_MODE,
    MAUDE_STUDIO_CHILD: process.env.MAUDE_STUDIO_CHILD,
    MAUDE_REPO_DIR: process.env.MAUDE_REPO_DIR,
  };
  process.env.HUB_WORKSPACE_MODE = '1';
  process.env.MAUDE_STUDIO_CHILD = '0';
  process.env.MAUDE_REPO_DIR = repoDir;
  const peer = (label, fields) => addToken(dataDir, { label, scope: '*', ...fields }).value;
  const tokens = {
    owner: peer('owner', { role: 'owner', owner: 'o@x.test' }),
    member: peer('member', { role: 'member', owner: 'm@x.test' }),
    viewer: peer('viewer', { role: 'viewer', owner: 'v@x.test', readOnly: true }),
    observer: peer('observer', {
      role: 'observer',
      owner: 'b@x.test',
      readOnly: true,
      access: { v: 1, role: 'observer' },
    }),
    canvasA: canvasOnlyToken(dataDir, 'canvas-a', [{ c: 'ui/a.tsx', r: 'member' }]),
    canvasAViewer: canvasOnlyToken(dataDir, 'canvas-a-viewer', [{ c: 'ui/a.tsx', r: 'viewer' }]),
  };
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  // Journal the checkout now (the boot walk-import), so every file has a row.
  await built.startJournalReconciler({ target: null, intervalMs: 3_600_000 });
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  return {
    http,
    tokens,
    designRoot,
    dataDir,
    built,
    async stop() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await built.stopJournal?.();
      await built.server.destroy();
      built.projectStore?.close?.();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
    },
  };
}

/** One request; the body parsed as JSON when it is JSON. */
export async function call(hub, method, path, token, { body, headers = {} } = {}) {
  const res = await fetch(`${hub.http}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body } : {}),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {}
  return { status: res.status, body: json, bytes: buf };
}
