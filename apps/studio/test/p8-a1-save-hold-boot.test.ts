// p8-a1-save-hold — the hold through the REAL server: every request is wrapped in `withSession`
// (server.ts), which marks a browser write as the person's save (`withSaveRequest`). A terminal Claude
// Code call that cannot claim opens its window through the hook routes; the studio page's
// `POST /_api/edit-css` to that canvas then waits, and lands when the run ends — or, when the app quits
// mid-hold (SIGTERM), before the server exits.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Subprocess } from 'bun';

import { SHELL_SETTLE_MS } from '../sync/action-stage.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const RED = "color: 'red'";

const procs: Subprocess[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const p of procs) killProc(p);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function boot() {
  const { root, designRoot } = makeSandbox();
  dirs.push(root);
  const index = mkdtempSync(join(tmpdir(), 'maude-a1-hold-index-'));
  dirs.push(index);
  const abs = join(designRoot, 'ui', 'Home.tsx');
  writeFileSync(abs, SRC);
  const port = nextPort();
  const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1', MAUDE_INDEX_DIR: index });
  procs.push(proc);
  const base = `http://127.0.0.1:${port}`;
  /** a hook route: the CLI's plain client, no Origin */
  const hook = (p: string, body: unknown) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** the studio page's write: a browser, so it carries Origin */
  const paint = () =>
    fetch(`${base}/_api/edit-css`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({
        canvas: '.design/ui/Home.tsx',
        id: 'footer',
        property: 'color',
        value: 'red',
      }),
    });
  expect(
    (await hook('/_api/agent/run/begin', { session: 't1', actor: 'claude-code' })).status
  ).toBe(200);
  const win = await hook('/_api/agent/bash/window', {
    session: 't1',
    toolUseId: 'b1',
    open: true,
    files: ['ui/Home.tsx'],
  });
  expect(await win.json()).toEqual({ window: true });
  return { proc, abs, hook, paint, read: () => readFileSync(abs, 'utf8') };
}

describe('A1 hold through the real server (withSession)', () => {
  test('a person’s edit-css to a canvas a terminal call names waits, then lands when the run ends', async () => {
    const s = await boot();
    const res = await s.paint();
    expect(res.status).toBe(200);
    expect(s.read()).not.toContain(RED); // held, not written
    await s.hook('/_api/agent/run/end', { session: 't1', outcome: 'done' });
    await sleep(SHELL_SETTLE_MS + 500);
    expect(s.read()).toContain(RED);
  }, 60_000);

  test('quitting the app mid-hold (SIGTERM) lands the held save before the server exits', async () => {
    const s = await boot();
    expect((await s.paint()).status).toBe(200);
    expect(s.read()).not.toContain(RED);
    s.proc.kill('SIGTERM');
    await s.proc.exited;
    expect(s.read()).toContain(RED);
  }, 60_000);
});
