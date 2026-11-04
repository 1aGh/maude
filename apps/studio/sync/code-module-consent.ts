// sync/code-module-consent.ts — may this hub DELIVER code modules (`.ts`/`.js`) to this checkout?
//
// DDR-054: a code module lands outside the sandboxed canvas origin — the agent and every
// `maude design *` helper read it — so only a hub this machine vouches for may move one. Three
// ways a hub is vouched for, and nothing a hub can say about itself is one of them:
//
//   1. `cell`     — this process is a cell's own paired child: the hub and the checkout are one
//                   trust domain, there is no remote party.
//   2. `recorded` — `codeModulesAllowed: true` in the profile's hubs.json, written only by the
//                   person at `maude design link` (cli/lib/design-link.mjs `askCodeModuleConsent`)
//                   and carried across every re-save by `saveHubCredential` — a sign-in response
//                   can change the stored role, never this.
//   3. `cloud`    — 2.0.4, Michal's decision ("automaticky pro Maude Cloud"): a Maude Cloud project
//                   the desktop app ITSELF opened from Home. The cloud's file door takes code-module
//                   uploads only from the project's OWNER role (DDR-217), so what arrives is the
//                   owner's own code; asking every member to say yes to it left a second Mac with
//                   12 helpers `stuck` and the canvases importing them undrawable.
//
// Why (3) is computed here, per boot, and NOT recorded into hubs.json:
//   - both inputs are out of a repo's and a hub's reach: `MAUDE_APP_BOUND_HUB` is set by the Rust
//     shell from the app's own registry (a committed `linkedHub` never is — sync/link-consent.ts),
//     and the cell zone is compiled in (`CELL_ZONE`, the same constant as Rust `windows.rs`), never
//     read from config or from `MAUDE_CLOUD_URL` — a self-hosted control plane is not Maude Cloud;
//   - a record would outlive its reason: a folder later re-linked to another hub, or a copy opened
//     outside the app, would inherit a `true` nobody gave. Computing it can't be planted or go stale.
//   - there is no per-hub consent row in Settings › Connections to keep in step with.
//
// An explicit recorded `false` still wins: a person who said no on this Mac keeps their no.

import { CELL_ZONE, cellDoorUrl } from '../client/v2/cloud/browser-door.js';
import { normHub } from './link-consent.ts';

export type CodeModuleConsentHow = 'cell' | 'recorded' | 'cloud';

export interface CodeModuleConsentInput {
  /** this process is a paired cell child (sync/cell-pairing.ts) */
  cellPairing: boolean;
  /** the linked hub the runtime is about to dial (already past link consent) */
  hubUrl: string;
  /** the profile's stored hub record — only its local `codeModulesAllowed` is read */
  storedRecord?: { codeModulesAllowed?: boolean } | null;
  env?: Record<string, string | undefined>;
}

/**
 * Is `url` the front door of a Maude Cloud project cell? https, no port, no userinfo, no path, one
 * cell label under the compiled-in zone (never `canvas`, `view-*`, `canvas-*` — `cellDoorUrl`).
 */
export function isMaudeCloudCell(url: unknown): boolean {
  const hub = normHub(url);
  if (!hub) return false;
  let origin: string;
  try {
    const u = new URL(hub);
    if (u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return false;
    origin = u.origin;
  } catch {
    return false;
  }
  if (!origin.endsWith(`.${CELL_ZONE}`)) return false;
  return cellDoorUrl(`${origin}/`) === `${origin}/`;
}

/** Why this hub may deliver code modules here, or null when it may not. */
export function codeModuleConsent(o: CodeModuleConsentInput): CodeModuleConsentHow | null {
  if (o.cellPairing) return 'cell';
  const recorded = o.storedRecord?.codeModulesAllowed;
  if (recorded === true) return 'recorded';
  if (recorded === false) return null;
  const env = o.env ?? process.env;
  const hub = normHub(o.hubUrl);
  if (hub && normHub(env.MAUDE_APP_BOUND_HUB) === hub && isMaudeCloudCell(hub)) return 'cloud';
  return null;
}
