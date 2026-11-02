// gate-b-sec1 — `ds-upgrade prove` boots two headless studios on a STAGED copy. They inherit no credential and
// nothing that would make the throwaway copy a project participant (a cell's pairing, a hub's token), and a
// workspace cell refuses the proof outright (it would render tenant canvases inside vendor compute).
import { describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import { studioEnv } from '../ds/upgrade-prove.ts';
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
