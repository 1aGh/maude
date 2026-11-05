// gate-b-sec1 — `ds-upgrade prove` boots two headless studios on a STAGED copy. They inherit no credential and
// nothing that would make the throwaway copy a project participant (a cell's pairing, a hub's token), and a
// workspace cell refuses the proof outright (it would render tenant canvases inside vendor compute).
import { describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import { resolveStudioServer, studioEnv } from '../ds/upgrade-prove.ts';
import type { DsOpContext } from '../routes/ds.ts';
import { runUpgradeOp } from '../routes/ds-upgrade.ts';

describe('ds-upgrade prove', () => {
  test('a staged studio gets PATH and HOME, never a secret or a cell/hub link', () => {
    const env = studioEnv('/tmp/stage/after', '/tmp/m.json', {
      PATH: '/usr/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_CELL_PAIRING: '1',
      MAUDE_CELL_SECRET: 'cell-secret-1',
      MAUDE_LOOPBACK_SYNC_URL: 'ws://127.0.0.1:9/sync',
      MAUDE_LOOPBACK_SYNC_TOKEN: 'loop-token-1',
      MAUDE_HUB_TOKEN: 'hub-token-1',
      ANTHROPIC_API_KEY: 'sk-ant-1',
      GITHUB_TOKEN: 'gh-1',
      AWS_SECRET_ACCESS_KEY: 'aws-1',
      PORT: '4399',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: '/tmp/m.json',
      CLAUDE_PROJECT_DIR: '/tmp/stage/after',
    });
  });

  test('a staged studio runs on a throwaway home: it can never write the real ~/.config/maude', () => {
    const env = studioEnv(
      '/tmp/stage/after',
      '/tmp/m.json',
      {
        PATH: '/usr/bin',
        HOME: '/Users/x',
        XDG_CONFIG_HOME: '/Users/x/.config',
        HUBS_CONFIG_PATH: '/Users/x/.config/maude/hubs.json',
        MAUDE_CLOUD_CONFIG: '/Users/x/.config/maude/cloud.json',
        MAUDE_INDEX_DIR: '/Users/x/index',
      },
      '/tmp/scratch/home'
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/scratch/home',
      XDG_CONFIG_HOME: '/tmp/scratch/home/.config',
      MAUDE_INDEX_DIR: '/tmp/scratch/home/index',
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: '/tmp/m.json',
      CLAUDE_PROJECT_DIR: '/tmp/stage/after',
    });
  });

  test('a workspace cell refuses the proof: not-on-mac, nothing booted', async () => {
    const was = process.env.MAUDE_WORKSPACE_MODE;
    process.env.MAUDE_WORKSPACE_MODE = '1';
    try {
      const c = {
        access: resolveAccess({ v: 1, role: 'owner' }),
        engine: { designRoot: '/nonexistent/.design' },
      } as unknown as DsOpContext;
      const r = await runUpgradeOp({ ds: 'studio', step: 'prove', stage: '1' }, c);
      expect(r.status).toBe(409);
      expect((r.body as { code: string }).code).toBe('not-on-mac');
    } finally {
      if (was === undefined) delete process.env.MAUDE_WORKSPACE_MODE;
      else process.env.MAUDE_WORKSPACE_MODE = was;
    }
  });
});

// The staged studio boots the COMPILED studio whenever one exists (DDR-084, DDR-177): its source
// imports the hub's transaction core and jszip, which neither the packaged app nor npm has on disk.
describe('ds-upgrade prove — which studio boots', () => {
  const APP = '/Applications/Maude.app/Contents';
  const appRoot = `${APP}/Resources/apps/studio`;
  const fsOf = (files: string[]) => (p: string) => files.includes(p);
  const appFiles = [
    `${appRoot}/server.ts`,
    `${APP}/Resources/cli/commands/design.mjs`,
    `${APP}/MacOS/maude-server`,
  ];

  test('the packaged app, run through its bun shim: the sidecar binary, never server.ts', () => {
    const r = resolveStudioServer({
      env: { BUN_BE_BUN: '1' },
      execPath: `${APP}/MacOS/maude-server`,
      devServerRoot: appRoot,
      compiled: false,
      exists: fsOf(appFiles),
    });
    expect(r).toEqual({
      cmd: [`${APP}/MacOS/maude-server`],
      env: { MAUDE_DEV_SERVER_ROOT: appRoot, MAUDE_PKG_ROOT: `${APP}/Resources` },
      kind: 'compiled',
    });
  });

  test('the packaged app under a real bun: Contents/MacOS/maude-server is found by layout', () => {
    const r = resolveStudioServer({
      env: {},
      execPath: '/opt/homebrew/bin/bun',
      devServerRoot: appRoot,
      compiled: false,
      exists: fsOf(appFiles),
    });
    expect(r.kind).toBe('compiled');
    expect(r.cmd).toEqual([`${APP}/MacOS/maude-server`]);
  });

  test('MAUDE_DEV_SERVER_BIN wins — but only a path shaped like a compiled studio', () => {
    const bin = '/x/maude-server';
    const ok = resolveStudioServer({
      env: { MAUDE_DEV_SERVER_BIN: bin },
      execPath: '/usr/local/bin/bun',
      devServerRoot: '/repo/apps/studio',
      compiled: false,
      exists: fsOf([
        bin,
        '/repo/apps/studio/server.ts',
        '/repo/packages/maude-darwin-arm64/package.json',
      ]),
    });
    expect(ok.cmd).toEqual([bin]);
    const evil = resolveStudioServer({
      env: { MAUDE_DEV_SERVER_BIN: '/tmp/evil.sh' },
      execPath: '/usr/local/bin/bun',
      devServerRoot: '/repo/apps/studio',
      compiled: false,
      exists: fsOf([
        '/tmp/evil.sh',
        '/repo/apps/studio/server.ts',
        '/repo/packages/maude-darwin-arm64/package.json',
      ]),
    });
    expect(evil.kind).toBe('source');
  });

  test('an npm install: the maude-<slug>/maude platform package', () => {
    const root = '/g/lib/node_modules/@1agh/maude/apps/studio';
    const bin = '/g/lib/node_modules/@1agh/maude-darwin-arm64/maude';
    const r = resolveStudioServer({
      env: {},
      execPath: '/usr/local/bin/bun',
      devServerRoot: root,
      compiled: false,
      exists: fsOf([`${root}/server.ts`, bin]),
      platformSlugs: ['darwin-arm64'],
    });
    expect(r).toEqual({ cmd: [bin], env: { MAUDE_DEV_SERVER_ROOT: root }, kind: 'compiled' });
  });

  test('a dev tree runs the source; the compiled studio runs itself', () => {
    const src = resolveStudioServer({
      env: {},
      execPath: '/usr/local/bin/bun',
      devServerRoot: '/repo/apps/studio',
      compiled: false,
      exists: fsOf([
        '/repo/apps/studio/server.ts',
        '/repo/packages/maude-darwin-arm64/package.json',
      ]),
    });
    expect(src).toEqual({
      cmd: ['/usr/local/bin/bun', 'run', '/repo/apps/studio/server.ts'],
      env: {},
      kind: 'source',
    });
    const self = resolveStudioServer({
      env: {},
      execPath: `${APP}/MacOS/maude-server`,
      devServerRoot: appRoot,
      compiled: true,
      exists: fsOf(appFiles),
    });
    expect(self.cmd).toEqual([`${APP}/MacOS/maude-server`]);
    expect(self.env.MAUDE_DEV_SERVER_ROOT).toBe(appRoot);
  });
});
