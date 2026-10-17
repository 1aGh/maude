// Phase 4 gate security review D1 — the project folder names this Mac's user and folder layout, so it
// is served only from `/_api/diagnostics`, never on `/_config`; and `/_config` itself (project, hub
// link, canvas origin + port, build) sits behind the same rebinding + cross-site gate (EH-P4-1).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { realpathSync, rmSync } from 'node:fs';
import type { Subprocess } from 'bun';
import { diagnosticsInfo } from '../client/v2/diagnostics/diagnostics-model.js';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('diagnosticsInfo reads the folder from the guarded payload', () => {
  test('projectFolder in the /_api/diagnostics answer fills the folder fact', () => {
    expect(diagnosticsInfo({ projectFolder: '/Users/me/Maude/a' }).folder).toBe(
      '/Users/me/Maude/a'
    );
    expect(diagnosticsInfo({ projectFolder: 42 }).folder).toBe('');
    expect(diagnosticsInfo(null).folder).toBe('');
  });
});

describe('a booted studio', () => {
  let proc: Subprocess | null = null;
  let root = '';
  let port = 0;

  beforeAll(async () => {
    root = makeSandbox().root;
    port = nextPort();
    proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
  });

  afterAll(async () => {
    if (proc) await killProc(proc);
    rmSync(root, { recursive: true, force: true });
  });

  test('/_config never carries the project folder', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/_config`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('projectFolder');
    expect(text).not.toContain(realpathSync(root));
  });

  test('/_config refuses a rebound host and a cross-site read (EH-P4-1: the config is recon)', async () => {
    const rebound = await fetch(`http://127.0.0.1:${port}/_config`, {
      headers: { host: `attacker.example:${port}` },
    });
    expect(rebound.status).toBe(403);
    const crossSite = await fetch(`http://127.0.0.1:${port}/_config`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.text()).not.toContain('canvasOrigin');
  });

  test('/_api/diagnostics gives the folder to a loopback request and refuses a rebound host', async () => {
    const ok = await fetch(`http://127.0.0.1:${port}/_api/diagnostics`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { projectFolder?: string };
    expect([root, realpathSync(root)]).toContain(body.projectFolder ?? '');

    const rebound = await fetch(`http://127.0.0.1:${port}/_api/diagnostics`, {
      headers: { host: `attacker.example:${port}` },
    });
    expect(rebound.status).toBe(403);
    expect(await rebound.text()).not.toContain(root);
  });
});
