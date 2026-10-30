// p8-e2e-rolefix — a person invited Can view on ONE canvas (share-roles: Petra) saw "Can comment" on her
// own studio. The desktop's access is the linked hub's stored claim (hubs.json `access`), and the shell's
// access word read `cfg.cloud.role` — a field only a cloud cell sends — so every read-only desktop session
// fell through to "Can comment".
//
// Two halves, both on a hub-linked desktop holding Petra's exact record (v1 projection `viewer`, v2 claim
// `{ role: null, grants: [{ c, r: 'observer' }] }`):
//   · the access is right: a comment on her canvas is REFUSED (Can view looks only), and the same record
//     with a Can comment grant may comment — so the refusal is about the role, not the route;
//   · `/_config.access` hands the shell the session's own claim (project role + grants), so the word is
//     the server's, not a guess.

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';
const SRC = 'export default function C() { return <div>c</div>; }\n';
const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function bootLinked(record: Record<string, unknown>) {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), SRC);
  writeFileSync(join(designRoot, 'ui', 'b.tsx'), SRC);
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), ...record } } })
  );
  const port = nextPort();
  procs.push(await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath }));
  return `http://localhost:${port}`;
}

const petra = (r: 'observer' | 'viewer') => ({
  role: 'viewer',
  access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r }] },
});

const comment = async (base: string, file: string) => {
  const r = await fetch(`${base}/_api/comments/op`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ op: 'add', file, text: 'hello', x: 1, y: 1 }),
  });
  return r.status;
};

const config = async (base: string) =>
  (await (await fetch(`${base}/_config`)).json()) as Record<string, unknown>;

describe('Can view on one canvas, on her own desktop (share-roles Petra)', () => {
  test('her comment on that canvas is refused; a Can comment grant may comment', async () => {
    const view = await bootLinked(petra('observer'));
    expect(await comment(view, '.design/ui/a.tsx')).toBe(403);
    const cmt = await bootLinked(petra('viewer'));
    expect(await comment(cmt, '.design/ui/a.tsx')).toBe(200);
  }, 90000);

  test('/_config.access names her claim: no project role, Can view on that one canvas', async () => {
    const base = await bootLinked(petra('observer'));
    const cfg = await config(base);
    expect(cfg.readOnly).toBe(true);
    expect(cfg.readOnlyReason).toBe('role');
    expect(cfg.access).toEqual({ role: null, grants: [{ c: 'ui/a.tsx', r: 'observer' }] });
  }, 60000);

  test('an unlinked project is the owner’s own', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    procs.push(await bootServer(root, port, {}));
    const cfg = await config(`http://localhost:${port}`);
    expect(cfg.access).toEqual({ role: 'owner', grants: [] });
  }, 60000);
});
