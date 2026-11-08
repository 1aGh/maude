// sec-loopback-bearer §7.6 — a desktop-started server requires its key from every caller, so the CLI
// (verbs, hooks) must take it from the app's registry entry of the attested port and send it. This
// boots a real server the way the app does (both per-spawn keys in env) behind a registry fixture.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { postStudio, probeStudio } from '../../../cli/lib/studio-locate.mjs';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const API_KEY = '7a'.repeat(32);
const ATTEST_KEY = '8b'.repeat(32);
const MAUDE = join(import.meta.dir, '..', '..', '..', 'cli', 'bin', 'maude.mjs');

describe('CLI callers on a desktop-started server', () => {
  let proc: Subprocess;
  let root: string;
  let port: number;
  let registry: string;
  beforeAll(async () => {
    ({ root } = makeSandbox());
    port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_SHELL_API_KEY: API_KEY,
      MAUDE_SHELL_ATTEST_KEY: ATTEST_KEY,
    });
    const real = realpathSync(root);
    registry = join(root, '..', `servers-${port}.json`);
    writeFileSync(
      registry,
      JSON.stringify({
        v: 1,
        app: { pid: process.pid },
        servers: [
          {
            root: real,
            rootId: createHash('sha256').update(real).digest('hex').slice(0, 12),
            label: 'p-l0123456789abcdef',
            state: 'running',
            port,
            pid: proc.pid,
            attestKey: ATTEST_KEY,
            apiKey: API_KEY,
            profile: 'default',
            kind: 'project',
            busy: false,
          },
        ],
      }),
      { mode: 0o600 }
    );
    process.env.MAUDE_APP_REGISTRY_FILE = registry;
  }, 60_000);
  afterAll(async () => {
    delete process.env.MAUDE_APP_REGISTRY_FILE;
    if (proc) await killProc(proc);
  });

  test('without the key the server refuses; studio-locate finds it and sends the key', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/_config`)).status).toBe(401);
    const { studio } = (await probeStudio(root, { timeoutMs: 3000 })) as {
      studio?: { owner?: string; apiKey?: string };
    };
    expect(studio?.owner).toBe('app');
    expect(studio?.apiKey).toBe(API_KEY);
    const r = await postStudio(studio, '/_api/ui/open', { panel: 'chat' }, { timeoutMs: 5000 });
    expect(r?.status).not.toBe(401);
    expect(r?.status).toBeLessThan(500);
  });

  test('a verb works end to end (`maude design runs list`)', () => {
    const out = spawnSync('node', [MAUDE, 'design', 'runs', 'list', '--json'], {
      cwd: root,
      // a terminal run: none of the AI-session confinement inputs of the session running this suite
      env: Object.fromEntries(
        Object.entries({ ...process.env, MAUDE_APP_REGISTRY_FILE: registry, NO_OPEN: '1' }).filter(
          ([k]) =>
            ![
              'MAUDE_SESSION_ROOT',
              'MAUDE_HOOK_SESSION',
              'MAUDE_AGENT_ACTOR',
              'MAUDE_CHAT_ID',
              'CLAUDE_PROJECT_DIR',
            ].includes(k)
        )
      ),
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(`${out.status} ${out.stderr}`).toBe('0 ');
  }, 40_000);
});
