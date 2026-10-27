/**
 * WebdriverIO config — the Maude Cloud lane (Phase 23 C4 + Phase 17).
 *
 * The CONTROL PLANE is stubbed here, in this process (device code / token / projects / handoff exchange): one
 * loopback server whose port lands in MAUDE_CLOUD_URL before the app spawns. The CELL it hands out is a REAL hub,
 * LOCAL and throwaway (fixtures/local-hub.mjs: apps/hub from source on 127.0.0.1, Node 24, cloud-identity mode with
 * a per-run project-token key) — so a project that is "attached" really signs in at the hub's own /auth/login with a
 * token the stub mints the way the control plane does, really syncs, and Resync really finishes (it used to dead-end
 * on a stub that answered nothing, hence "Resync never finished"). No account, no network, no production hub, cell,
 * Stripe or Cloudflare: MAUDE_CLOUD_CONFIG + HUBS_CONFIG_PATH point into the run dir, so the developer's
 * ~/.config/maude is never read or written.
 *
 * The e2e bundle registers the `maude-e2e` scheme, NOT `maude` (see
 * tauri.e2e.conf.json): registering the real scheme would teach this
 * machine's LaunchServices to route real maude:// links into a throwaway
 * debug app. The deep-link CONFIRM flow is still covered — the scenario
 * emits the same `maude://deep-link` Tauri event the Rust handler emits;
 * OS-level scheme registration itself is a bundled-.app smoke item (DDR-177).
 */

import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintProjectToken, startLocalHub } from './fixtures/local-hub.mjs';
import { useStubClaude } from './helpers/fake-ai';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── The stub control plane + cell (one server) ────────────────────────────
export const STUB_CODE = `mhc_${'a'.repeat(64)}`;

/** The local hub's address and the key its project tokens verify against — set by the launcher, read by the stub. */
const hubUrl = () => process.env.MAUDE_E2E_CLOUD_HUB as string;
const cloudKey = () => process.env.MAUDE_E2E_CLOUD_KEY as string;
/** What the control plane hands a person who opens a project: a project access token for the local hub. */
const projectToken = () =>
  mintProjectToken(cloudKey(), {
    email: 'e2e@example.com',
    role: 'owner',
    project: 'stub-project',
  });

function startStub(): Promise<{ port: number; close: () => void }> {
  /** S9.20b — set once step 2b's Move to cloud created the project. */
  let moved = false;
  return new Promise((resolvePort) => {
    const srv = createServer(async (req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const read = async () => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try {
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return {};
        }
      };
      const cell = hubUrl();
      // S9.20b — Move to cloud (step 2b): POST /api/projects creates `stub-moved`, which the
      // listing reports active from then on, so the move goes straight to open → attach.
      if (req.url === '/api/projects' && req.method === 'POST') {
        moved = true;
        return send(201, { id: 'stub-moved', name: 'Moved Project', state: 'provisioning' });
      }
      // S9.20b — Settings › Account's plan words come from /api/home `account.plan`.
      if (req.url === '/api/home') {
        return send(200, {
          account: {
            email: 'e2e@example.com',
            plan: { state: 'trialing', daysLeft: 12, name: 'Free trial' },
          },
          projects: [],
          shared: [],
        });
      }
      if (req.url === '/auth/device/code') {
        return send(200, {
          device_code: 'mdc_stub',
          user_code: 'STUB-CODE',
          verification_url: 'about:blank',
          interval: 1,
          expires_in: 900,
        });
      }
      if (req.url === '/auth/device/token') {
        // Approved instantly — no human in a stub.
        return send(200, { token: 'mpt_stub', account: { email: 'e2e@example.com' } });
      }
      if (req.url === '/api/projects') {
        return send(200, {
          projects: [
            {
              id: 'stub-project',
              name: 'Stub Project',
              state: 'active',
              role: 'owner',
              stateLabel: 'Ready',
              url: cell,
            },
            {
              id: 'stub-gallery',
              name: 'Stub Gallery',
              state: 'active',
              role: 'viewer',
              stateLabel: 'Ready',
              url: cell,
            },
            ...(moved
              ? [
                  {
                    id: 'stub-moved',
                    name: 'Moved Project',
                    state: 'active',
                    role: 'owner',
                    stateLabel: 'Ready',
                    url: cell,
                  },
                ]
              : []),
          ],
        });
      }
      if (req.url === '/projects/open') {
        return send(200, {
          token: await projectToken(),
          role: 'owner',
          url: cell,
          expiresAt: Date.now() + 3600_000,
        });
      }
      if (req.url === '/auth/handoff/exchange') {
        const body = await read();
        if (body?.code === STUB_CODE) {
          return send(200, {
            token: await projectToken(),
            role: 'owner',
            // Deliberately the FIXTURE FOLDER's own name (e2e/fixtures/project),
            // so the deep-link scenario exercises the one verdict that is allowed
            // to be silent: an exact identity match. Anything else — including a
            // near-match — now warns, by design (attacker pass B1).
            project: 'project',
            url: cell,
            expiresAt: Date.now() + 3600_000,
          });
        }
        return send(400, { error: 'that code is not valid or has expired' });
      }
      // /auth/login is the LOCAL HUB's own now (a project token minted above).
      if (req.url === '/health') return send(200, { ok: true, version: 'stub' });
      send(404, { error: 'not stubbed' });
    });
    srv.listen(0, '127.0.0.1', () =>
      resolvePort({ port: (srv.address() as { port: number }).port, close: () => srv.close() })
    );
  });
}

// WDIO evaluates this file in the launcher AND in each worker: the launcher starts the hub once (the app it launches
// inherits the env); a worker finds the env set and only runs its own stub for the spec's deep-link code.
useStubClaude();
let hub: Awaited<ReturnType<typeof startLocalHub>> | null = null;
const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-cloud-'));
mkdirSync(scratch, { recursive: true });
if (!process.env.MAUDE_E2E_CLOUD_HUB) {
  process.env.MAUDE_E2E_CLOUD_KEY = `e2e-cloud-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  hub = await startLocalHub({ dir: join(scratch, 'hub'), cloudKey: cloudKey() });
  process.env.MAUDE_E2E_CLOUD_HUB = hub.http;
}
const stub = await startStub();

// THE CROSS-ORIGIN SPLIT STAYS ON IN THIS LANE — the "revisit if a scenario
// must exercise the split-origin path" the base config's comment left open.
//
// The base default is `0`, so WebDriver's switchToFrame() can reach into the
// canvas iframe. TSX sync is deliberately coupled to that same switch (DDR-060
// / DDR-054 §F1: the per-canvas opt-in is inert without the sandbox), so with
// the split off this lane's fixture has NOTHING syncable — the rail reported
// "2 TSX canvas(es) found but none are syncable" and every step from the attach
// onward failed on a project that was linked and could never sync. Nothing in
// this lane enters the canvas frame; it is all rail, dialogs and panels.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';

process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${stub.port}`;
process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
process.env.MAUDE_E2E_CLOUD_STUB = '1';
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/cloud-attach',
  new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
);

// p8-e2e-fix-r10: this lane LINKS its project to a hub and syncs it — the sync writes a managed `.claudeignore`
// block at the project root, `_untrusted/`, `_sync.json` and the rest — so it runs on a throwaway COPY of
// fixtures/project, never the repo fixture (a stale, gitignored `.claudeignore` one linked run left there made
// photo-per-use red in the main checkout). The copy's folder is named `project` on purpose: step 4's handoff
// names that folder exactly. Copied ONCE, in the launcher (this file is evaluated again in the worker, which
// inherits the env); `_*` runtime state is not copied.
if (!process.env.MAUDE_E2E_CLOUD_ROOT) {
  const root = join(mkdtempSync(join(tmpdir(), 'maude-e2e-cloud-project-')), 'project');
  cpSync(join(HERE, 'fixtures', 'project'), root, {
    recursive: true,
    filter: (src) => !/[/\\]_[^/\\]*$/.test(src),
  });
  process.env.MAUDE_E2E_CLOUD_ROOT = root;
}

// Base config AFTER env is primed (it resolves the fixture + app path).
const { config: base, completeLane } = await import('./wdio.conf');
// …and the base config points the app at the repo fixture: the copy wins.
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_CLOUD_ROOT;

export const config: WebdriverIO.Config = {
  ...base,
  specs: [join(HERE, 'scenarios', 'cloud-attach.e2e.ts')],
  onComplete: async () => {
    await completeLane();
    stub.close();
    hub?.stop();
  },
};
