/**
 * WebdriverIO config — cloud/desktop parity, Cloud Phase 27 E4.
 *
 * ONE spec file, two targets. Without `MAUDE_E2E_CLOUD_URL` this is the native
 * config with the parity spec selected, so `shell-parity.e2e.ts` runs inside the
 * bundled `.app`. With it, the same file runs in a browser against a cell.
 *
 *   pnpm test:e2e:desktop:parity                          # the .app          → shell `desktop`
 *   pnpm test:e2e:desktop:parity:cloud                    # a local cell stand-in → shell `cloud-viewer`
 *   MAUDE_E2E_PARITY_ROLE=owner pnpm test:e2e:desktop:parity:cloud   # …vouching an owner (or `member`)
 *   MAUDE_E2E_CLOUD_URL=https://x.cloud.maude.sh \
 *   MAUDE_E2E_CLOUD_COOKIE='maude_session=…' \
 *     pnpm test:e2e:desktop:parity:cloud                  # a REAL deployment
 *
 * The spec checks the v2 shell parity contract (client/v2/shell/shell-parity.json) for the shell it finds
 * itself in. `MAUDE_E2E_PARITY_SHELL` names the shell the run is MEANT for — set here for the native lane and
 * the stand-in — so a run that quietly fell back to another column fails instead of passing against it.
 *
 * THE LOCAL STAND-IN, AND WHAT IT DOES NOT EMULATE. With no URL given, this
 * boots the studio in workspace mode behind a tiny proxy that injects the two
 * headers a real cell's proxy vouches (`x-maude-role`, `x-maude-session`). That
 * is enough to exercise the SHELL — the client, the panels, the role — and it is
 * emphatically NOT a cell: no sign-in, no capability cookie, no segregated
 * canvas origin, no supervised child. The phase's own retro is the reason this
 * paragraph exists: a stand-in that quietly fails to emulate something produces
 * a bug report about the product.
 */

import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, 'scenarios', 'shell-parity.e2e.ts');
const FIXTURE = join(HERE, 'fixtures', 'project');

const EXPLICIT_URL = process.env.MAUDE_E2E_CLOUD_URL;
const WANT_CLOUD = Boolean(EXPLICIT_URL) || process.env.MAUDE_E2E_PARITY_CLOUD === '1';

// ---- the native target: the base config, one spec ------------------------
if (!WANT_CLOUD) {
  const { config: base } = await import('./wdio.conf.ts');
  // biome-ignore lint/suspicious/noExplicitAny: the config shape is wdio's
  (globalThis as any).__maudeParityConfig = { ...base, specs: [SPEC] };
  process.env.MAUDE_E2E_PARITY_SHELL ||= 'desktop';
}

// ---- the cloud target ----------------------------------------------------
async function startStandIn(): Promise<{ url: string; close: () => void }> {
  const studioEntry = resolve(HERE, '../../studio/server.ts');
  const studioPort = 4894;
  // p8-e2e-fix-r10: a workspace-mode studio writes its runtime state into the tree it serves — a throwaway copy
  // of the fixture, never the repo's own (`_*` runtime state is not copied)
  const root = mkdtempSync(join(tmpdir(), 'maude-e2e-parity-cloud-'));
  cpSync(FIXTURE, root, { recursive: true, filter: (src) => !/[/\\]_[^/\\]*$/.test(src) });
  const child = spawn('bun', [studioEntry, '--root', root, '--port', String(studioPort)], {
    env: {
      ...process.env,
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Parity Fixture',
      NO_OPEN: '1',
    },
    stdio: 'ignore',
  });

  await new Promise<void>((ready, fail) => {
    const deadline = Date.now() + 60_000;
    const poll = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${studioPort}/_health`);
        if (r.ok) return ready();
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) return fail(new Error('the studio never became ready'));
      setTimeout(poll, 500);
    };
    void poll();
  });

  // The proxy: vouch a VIEWER by default, which is the role with the most to lose from a
  // parity regression (C1 — a reviewer who cannot inspect). MAUDE_E2E_PARITY_ROLE picks another.
  const role = (process.env.MAUDE_E2E_PARITY_ROLE || 'viewer') as 'owner' | 'member' | 'viewer';
  if (!['owner', 'member', 'viewer'].includes(role))
    throw new Error(`MAUDE_E2E_PARITY_ROLE must be owner, member or viewer (got "${role}")`);
  process.env.MAUDE_E2E_PARITY_SHELL ||= `cloud-${role}`;
  const proxyPort = 4895;
  const proxy = createServer((req, res) => {
    // Everything the browser sent EXCEPT `host` (the real data plane drops it
    // too — the cell takes its public identity from configuration, D4), plus
    // the headers a real cell's proxy vouches.
    const { host: _dropped, ...forwarded } = req.headers;
    const headers = {
      ...forwarded,
      'x-maude-role': role,
      // The real proxy injects the capability both ways (studio-proxy upstreamHeaders); a cell reads
      // a missing header as read-only (defaults closed), so an owner/member must get '0'.
      'x-maude-readonly': role === 'viewer' ? '1' : '0',
      'x-maude-session': `parity${role}0001`,
      'x-maude-user': `${role}@example.com`,
    };
    const up = httpRequest(
      { host: '127.0.0.1', port: studioPort, method: req.method, path: req.url, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  await new Promise<void>((r) => proxy.listen(proxyPort, () => r()));

  return {
    url: `http://127.0.0.1:${proxyPort}`,
    close: () => {
      proxy.close();
      child.kill();
    },
  };
}

let standIn: { url: string; close: () => void } | null = null;
if (WANT_CLOUD && !EXPLICIT_URL) {
  standIn = await startStandIn();
  process.env.MAUDE_E2E_CLOUD_URL = standIn.url;
}

export const config: WebdriverIO.Config = WANT_CLOUD
  ? {
      runner: 'local',
      specs: [SPEC],
      maxInstances: 1,
      capabilities: [
        {
          browserName: 'chrome',
          'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox'] },
        },
      ],
      logLevel: 'warn',
      framework: 'mocha',
      reporters: ['spec'],
      mochaOpts: { ui: 'bdd', timeout: 180_000 },
      onComplete: () => standIn?.close(),
    }
  : // biome-ignore lint/suspicious/noExplicitAny: handed over from the branch above
    ((globalThis as any).__maudeParityConfig as WebdriverIO.Config);
