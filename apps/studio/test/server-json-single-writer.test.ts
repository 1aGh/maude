// #206 T6.3a (contract 206-cli-reuses-desktop.md §6 "Handover" step 2, DDR-250 decision 7) —
// `_server.json` has ONE writer at a time: the server that wrote it. A server stopping removes
// the file only while it still names that server (pid + `started`), so a CLI server's graceful
// shutdown can no longer delete the desktop sidecar's file (and send the next `server-up` off to
// start a third server). Written atomically, so a reader never sees half a file.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { removeServerJsonIfOurs, writeServerJson } from '../shell/server-json.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function sandbox() {
  const s = makeSandbox();
  roots.push(s.root);
  return s;
}

const INFO = {
  pid: 4242,
  port: 4399,
  url: 'http://localhost:4399',
  started: '2026-11-08T10:00:00.000Z',
  project: 'test',
  config_source: 'config.json',
};

describe('writeServerJson / removeServerJsonIfOurs', () => {
  test('writes the facts atomically and leaves no temp file behind', () => {
    const { designRoot } = sandbox();
    const file = join(designRoot, '_server.json');
    writeServerJson(file, INFO);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(INFO);
    expect(readdirSync(designRoot).filter((n) => n.startsWith('_server.json'))).toEqual([
      '_server.json',
    ]);
  });

  test('removes the file when it still names this server', () => {
    const { designRoot } = sandbox();
    const file = join(designRoot, '_server.json');
    writeServerJson(file, INFO);
    expect(removeServerJsonIfOurs(file, { pid: INFO.pid, started: INFO.started })).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  test('leaves another server’s file alone: a different pid, or the same pid at another start', () => {
    const { designRoot } = sandbox();
    const file = join(designRoot, '_server.json');
    writeServerJson(file, INFO);
    expect(removeServerJsonIfOurs(file, { pid: 1, started: INFO.started })).toBe(false);
    // a recycled pid is not the same server
    expect(removeServerJsonIfOurs(file, { pid: INFO.pid, started: 'earlier' })).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(INFO);
  });

  test('a missing, empty or unreadable file is no error and nothing is removed', () => {
    const { designRoot } = sandbox();
    const file = join(designRoot, '_server.json');
    expect(removeServerJsonIfOurs(file, { pid: INFO.pid, started: INFO.started })).toBe(false);
    writeFileSync(file, '');
    expect(removeServerJsonIfOurs(file, { pid: INFO.pid, started: INFO.started })).toBe(false);
    writeFileSync(file, '{not json');
    expect(removeServerJsonIfOurs(file, { pid: INFO.pid, started: INFO.started })).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{not json');
  });
});

describe('a real server stopping', () => {
  let proc: Subprocess | null = null;
  afterEach(async () => {
    if (proc) await killProc(proc);
    proc = null;
  });

  async function boot(root: string) {
    proc = await bootServer(root, nextPort(), { MAUDE_NO_AUTOBUILD: '1' });
    const file = join(root, '.design', '_server.json');
    for (let i = 0; i < 100 && !existsSync(file); i++) await Bun.sleep(50);
    return file;
  }

  test('removes its own _server.json on shutdown', async () => {
    const { root } = sandbox();
    const file = await boot(root);
    expect(JSON.parse(readFileSync(file, 'utf8')).pid).toBe(proc?.pid);
    await killProc(proc as Subprocess);
    proc = null;
    expect(existsSync(file)).toBe(false);
  });

  test('another server rewrote the file meanwhile: stopping leaves it naming that server', async () => {
    const { root } = sandbox();
    const file = await boot(root);
    // B (the desktop's sidecar) booted on the same root and wrote its own file
    const b = { ...INFO, pid: 999_999, port: 46399, url: 'http://localhost:46399' };
    writeFileSync(file, JSON.stringify(b, null, 2));
    await killProc(proc as Subprocess);
    proc = null;
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(b);
  });
});
