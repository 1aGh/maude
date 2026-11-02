// S8.1 — V2-1.16 L7 for ExportSpec v2, through the REAL gate: a cell child reads the proxy's
// `x-maude-access` claim per request, so one boot serves every session here. A canvas-only
// session can never reach Folder or Whole project — 403 `not-in-scope`, the same status and
// body a missing canvas gets — and an ungranted canvas is indistinguishable from a missing one.
// Can view (observer) is refused the estimate like every export.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SRC = (id: string) => `import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="${id}" label="${id}" width={200} height={100}><div>${id}</div></DCArtboard>
    </DesignCanvas>
  );
}
`;

const claim = (c: AccessClaim, readonly = '1') => ({
  'x-maude-access': Buffer.from(JSON.stringify(c)).toString('base64url'),
  'x-maude-readonly': readonly,
});
const ONLY_A = claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] });
const OBSERVER = {
  ...claim({ v: 1, role: 'observer' } as AccessClaim),
  'x-maude-role': 'observer',
};
const VIEWER = { ...claim({ v: 1, role: 'viewer' } as AccessClaim), 'x-maude-role': 'viewer' };
const NOT_IN_SCOPE = { error: 'not-in-scope', reason: 'not-in-scope' };

let proc: Subprocess | undefined;
let cell = '';

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), SRC('a1'));
  writeFileSync(join(designRoot, 'ui', 'b.tsx'), SRC('b1'));
  const port = nextPort();
  proc = await bootServer(root, port, {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Alligators',
  });
  cell = `http://localhost:${port}`;
}, 60_000);

afterAll(async () => {
  if (proc) await killProc(proc);
});

async function send(path: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(cell + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: r.status, json };
}

const estimate = (h: Record<string, string>, spec: unknown) =>
  send('/_api/export-estimate', h, { spec });

describe('canvas-only session (grant on ui/a.tsx only)', () => {
  test('Folder and Whole project: 403 not-in-scope on the estimate and the export-jobs door', async () => {
    for (const spec of [
      { v: 2, scope: 'folder', folder: 'ui', format: 'png' },
      { v: 2, scope: 'project', format: 'zip' },
      { v: 2, scope: 'project', format: 'png' },
    ]) {
      expect(await estimate(ONLY_A, spec)).toEqual({ status: 403, json: NOT_IN_SCOPE });
      expect(await send('/_api/export-jobs', ONLY_A, { v: 2, spec })).toEqual({
        status: 403,
        json: NOT_IN_SCOPE,
      });
      // (the synchronous `/_api/export` is not served in a cell at all — DDR-209 A′1: 404)
    }
  });

  test('an ungranted canvas answers exactly like a missing one', async () => {
    const ungranted = { v: 2, scope: 'canvas', canvas: 'ui/b.tsx', format: 'png' };
    const missing = { v: 2, scope: 'canvas', canvas: 'ui/nope.tsx', format: 'png' };
    const a = await estimate(ONLY_A, ungranted);
    expect(a).toEqual({ status: 403, json: NOT_IN_SCOPE });
    expect(await estimate(ONLY_A, missing)).toEqual(a);
    expect(await send('/_api/export-jobs', ONLY_A, { v: 2, spec: ungranted })).toEqual(a);
  });

  test('its own canvas is estimated, with Folder / Whole project as —', async () => {
    const r = await estimate(ONLY_A, { v: 2, scope: 'canvas', canvas: 'ui/a.tsx', format: 'png' });
    expect(r.status).toBe(200);
    expect((r.json as { counts: unknown }).counts).toEqual({
      selection: null,
      canvas: 1,
      folder: null,
      project: null,
    });
  });
});

describe('project roles', () => {
  test('Can view is refused the estimate; Can comment gets numbers', async () => {
    const spec = { v: 2, scope: 'project', format: 'png' };
    expect((await estimate(OBSERVER, spec)).status).toBe(403);
    const ok = await estimate(VIEWER, spec);
    expect(ok.status).toBe(200);
    expect((ok.json as { counts: unknown }).counts).toMatchObject({ project: 2 });
  });
});
