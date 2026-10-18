// S3.10a — GET /_api/links under a canvas-only session (S9.9 `x-maude-access`): the route's `sees` predicate is the
// cell's own (http.ts wires `access/scope.ts` `sees` + the session's closure). A link to a canvas the session was not
// granted reads `dangling` with the fallback label — byte-equal to a link to a canvas that does not exist (no
// existence oracle, V2-1.16 U1) — while a project role resolves it. The file itself: one body for "not granted" and
// "not there".

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const claimHeader = (claim: AccessClaim) => ({
  'x-maude-access': Buffer.from(JSON.stringify(claim)).toString('base64url'),
});
const CANVAS_ONLY_A = {
  ...claimHeader({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] }),
  'x-maude-readonly': '1',
};
const OWNER = { ...claimHeader({ v: 1, role: 'owner' }), 'x-maude-readonly': '0' };

const canvas = (
  name: string,
  extra = ''
) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function ${name}() {
  return (
    <DesignCanvas>
      <DCArtboard id="main" label="Main" width={800} height={500}>
        ${extra}
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const A = canvas(
  'A',
  `<button data-cd-id="to-b" data-cd-link="ui/b.tsx#main">B</button>
        <button data-cd-id="to-gone" data-cd-link="ui/gone.tsx#main">Gone</button>
        <button data-cd-id="to-self" data-cd-link="#main">Self</button>`
);

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

let cell = '';
beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), A);
  writeFileSync(join(designRoot, 'ui', 'b.tsx'), canvas('B'));
  const port = nextPort();
  procs.push(
    await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Alligators',
    })
  );
  cell = `http://localhost:${port}`;
}, 60000);

async function links(file: string, headers: Record<string, string>) {
  const r = await fetch(`${cell}/_api/links?file=${encodeURIComponent(file)}`, {
    headers: { origin: cell, ...headers },
  });
  const text = await r.text();
  return { status: r.status, text, json: r.status === 200 ? JSON.parse(text) : null };
}
const entry = (j: { links: Array<{ id: string }> }, id: string) => j.links.find((l) => l.id === id);

describe('GET /_api/links with a session predicate', () => {
  test('a project role resolves a link to another canvas it can read', async () => {
    const r = await links('.design/ui/a.tsx', OWNER);
    expect(r.status).toBe(200);
    expect(entry(r.json, 'to-b')).toMatchObject({
      state: 'ok',
      canvas: 'ui/b.tsx',
      toArtboard: 'main',
    });
  });

  test('a canvas-only session: a canvas it was not granted reads dangling — the same as one that is not there', async () => {
    const r = await links('.design/ui/a.tsx', CANVAS_ONLY_A);
    expect(r.status).toBe(200);
    const b = entry(r.json, 'to-b');
    const gone = entry(r.json, 'to-gone');
    expect(b?.state).toBe('dangling');
    // nothing but what the author wrote tells "exists, not yours" from "not there"
    const mask = (e: object | undefined) => ({ ...e, id: '', target: '', canvas: '', label: '' });
    expect(mask(b)).toEqual(mask(gone));
    expect(b?.label).toBe('Go to B');
    expect(entry(r.json, 'to-self')?.state).toBe('ok'); // its own artboard is its own
  });

  test('a file the session was not granted answers like a file that is not there', async () => {
    const notGranted = await links('.design/ui/b.tsx', CANVAS_ONLY_A);
    const missing = await links('.design/ui/gone.tsx', CANVAS_ONLY_A);
    expect(notGranted.status).toBe(missing.status);
    expect([403, 404]).toContain(notGranted.status);
    expect(notGranted.text).toBe(missing.text);
  });
});
