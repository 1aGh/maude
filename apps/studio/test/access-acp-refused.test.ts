// S9.9 (Phase 4 security D2) — the AI chat needs `edit` (V2-1.7 C30), and the SERVER says so.
//
// `/_ws/acp` checked where the handshake came from (loopback + same origin) and never who: a
// hub-linked Can comment / Can view desktop could open the chat socket and drive edits its sync
// would then refuse — the read-only gate was the client's. Now `acpRefusal` answers the upgrade,
// every state-changing frame (S5.6's per-frame predicate) and every `/_api/acp/*` write.

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { acpRefusal } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';
const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function bootLinked(role: string) {
  const { root, designRoot } = makeSandbox();
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), role } } })
  );
  const port = nextPort();
  procs.push(await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath }));
  return `http://localhost:${port}`;
}

/** A plain GET to the socket path: 403 = refused by the gate, 400 = reached the upgrade. */
const handshake = async (base: string) =>
  (await fetch(`${base}/_ws/acp`, { signal: AbortSignal.timeout(3000) })).status;

const write = async (base: string, path: string) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: '{}',
  });
  const error = ((await r.json().catch(() => ({}))) as { error?: unknown }).error ?? null;
  return `${r.status} ${error}`;
};

describe('acpRefusal', () => {
  test('only a role that edits may chat', () => {
    const rows = ['observer', 'viewer', 'member', 'owner', 'guest'].map((role) => [
      role,
      acpRefusal(resolveAccess({ v: 1, role } as never))?.status ?? 'ok',
    ]);
    expect(rows).toEqual([
      ['observer', 403],
      ['viewer', 403],
      ['member', 'ok'],
      ['owner', 'ok'],
      ['guest', 403],
    ]);
    // A canvas grant never opens the chat: it drives the project, not one canvas.
    const canvasOnly = resolveAccess({
      v: 1,
      role: null,
      grants: [{ c: 'ui/a.tsx', r: 'member' }],
    });
    expect(acpRefusal(canvasOnly)?.status).toBe(403);
  });
});

describe('/_ws/acp + /_api/acp/* on a hub-linked desktop', () => {
  for (const role of ['viewer', 'observer']) {
    test(`${role}: the chat socket and the chat writes are refused`, async () => {
      const base = await bootLinked(role);
      expect(await handshake(base)).toBe(403);
      for (const p of ['/_api/acp/chats/trash', '/_api/acp/chats/restore', '/_api/acp/focus'])
        expect([p, await write(base, p)]).toEqual([p, '403 read-only']);
    }, 60000);
  }

  test('member: the socket is reached (400 = no upgrade headers, not a refusal)', async () => {
    const base = await bootLinked('member');
    expect(await handshake(base)).toBe(400);
  }, 60000);
});
