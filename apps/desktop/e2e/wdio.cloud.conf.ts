/**
 * WebdriverIO config — the Maude Cloud lane (Phase 23 C4 + Phase 17).
 *
 * Everything the CloudBar talks to is STUBBED here, in this process: the
 * control plane (device code / token / projects / handoff exchange) and the
 * "cell" (POST /auth/login) are one loopback server whose port lands in
 * MAUDE_CLOUD_URL before the app spawns. No account, no network, no cleanup
 * on anyone's real credential: MAUDE_CLOUD_CONFIG + HUBS_CONFIG_PATH point
 * into the run dir, so the developer's ~/.config/maude is never read or
 * written.
 *
 * The e2e bundle registers the `maude-e2e` scheme, NOT `maude` (see
 * tauri.e2e.conf.json): registering the real scheme would teach this
 * machine's LaunchServices to route real maude:// links into a throwaway
 * debug app. The deep-link CONFIRM flow is still covered — the scenario
 * emits the same `maude://deep-link` Tauri event the Rust handler emits;
 * OS-level scheme registration itself is a bundled-.app smoke item (DDR-177).
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── The stub control plane + cell (one server) ────────────────────────────
export const STUB_CODE = `mhc_${'a'.repeat(64)}`;

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
      const origin = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
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
              url: origin,
            },
            {
              id: 'stub-gallery',
              name: 'Stub Gallery',
              state: 'active',
              role: 'viewer',
              stateLabel: 'Ready',
              url: origin,
            },
            ...(moved
              ? [
                  {
                    id: 'stub-moved',
                    name: 'Moved Project',
                    state: 'active',
                    role: 'owner',
                    stateLabel: 'Ready',
                    url: origin,
                  },
                ]
              : []),
          ],
        });
      }
      if (req.url === '/projects/open') {
        return send(200, {
          token: 'x.y',
          role: 'owner',
          url: origin,
          expiresAt: Date.now() + 3600_000,
        });
      }
      if (req.url === '/auth/handoff/exchange') {
        const body = await read();
        if (body?.code === STUB_CODE) {
          return send(200, {
            token: 'x.y',
            role: 'owner',
            // Deliberately the FIXTURE FOLDER's own name (e2e/fixtures/project),
            // so the deep-link scenario exercises the one verdict that is allowed
            // to be silent: an exact identity match. Anything else — including a
            // near-match — now warns, by design (attacker pass B1).
            project: 'project',
            url: origin,
            expiresAt: Date.now() + 3600_000,
          });
        }
        return send(400, { error: 'that code is not valid or has expired' });
      }
      if (req.url === '/auth/login') {
        const body = await read();
        return body?.token === 'x.y'
          ? send(200, {
              token: 'mau_stub_hub',
              user: { email: 'e2e@example.com', role: 'owner' },
              expiresAt: Date.now() + 3600_000,
            })
          : send(401, { error: 'no' });
      }
      if (req.url === '/health') return send(200, { ok: true, version: 'stub' });
      send(404, { error: 'not stubbed' });
    });
    srv.listen(0, '127.0.0.1', () =>
      resolvePort({ port: (srv.address() as { port: number }).port, close: () => srv.close() })
    );
  });
}

const stub = await startStub();
const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-cloud-'));
mkdirSync(scratch, { recursive: true });

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

// Base config AFTER env is primed (it resolves the fixture + app path).
const { config: base } = await import('./wdio.conf.ts');

export const config: WebdriverIO.Config = {
  ...base,
  specs: [join(HERE, 'scenarios', 'cloud-attach.e2e.ts')],
  onComplete: () => {
    stub.close();
  },
};
