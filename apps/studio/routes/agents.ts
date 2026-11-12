// GET /_api/agents — F2 (universal ACP, plan B1 discovery half; contract
// .ai/plans/notes/universal-acp-contract.md, DDR-252): which ACP agents are installed on this Mac.
//
//   → { agents: [{ id, label, vendor, installed, realBin, version, fit, policy, offerable }] }
//
// One row per catalog entry (acp/agents/catalog.ts), from `discoverAgents()` (acp/agents/discover.ts):
// the PATH walk, wrapper resolution by READING, and the cached, 5 s-bounded `--version` probe all
// happen there, lazily, on first call: never on the boot path. `?refresh=1` re-probes.
//
// PRIVILEGED: `origin: 'main'`, in neither canvas allowlist (a canvas has no business learning which
// agents and which binary paths this Mac has). About this Mac, not a canvas: a `none` class in
// test/_acl-route-classes.ts, `read` in sync/writer-registry.ts, refused in a cell (a cell runs no
// local AI).

import {
  type DiscoveredAgent,
  type DiscoverOptions,
  discoverAgents,
} from '../acp/agents/discover.ts';
import type { RouteSpec } from './table.ts';

export interface AgentsRouteDeps {
  /** The discovery to ask; defaults to the real one. Tests hand it a stub. */
  discover?: (opts?: DiscoverOptions) => Promise<DiscoveredAgent[]>;
}

const noStore = { 'Cache-Control': 'no-store' };

export function createAgentsRoutes(deps: AgentsRouteDeps = {}): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/agents',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const force = new URL(req.url).searchParams.get('refresh') === '1';
        try {
          const agents = await (deps.discover ?? discoverAgents)({ force });
          return Response.json({ agents }, { status: 200, headers: noStore });
        } catch (err) {
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : 'Could not look for agents.' },
            { status: 500, headers: noStore }
          );
        }
      },
    },
  ];
}
