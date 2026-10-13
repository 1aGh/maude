// THE route table — V2-2.5. Every route that is not a key of http.ts's legacy
// `routes` literal is declared here, through one `routes/<area>.ts` factory
// per area, so two work packages adding routes never edit the same switch.
//
// Adding a route:
//   1. write (or extend) `routes/<area>.ts`: a factory `(deps) => RouteSpec[]`
//      (shape in ./table.ts). It takes a deps object — never a global `ctx` —
//      and only CLOSES over it: it must not call a dep while building the
//      array (the table tests build it from stubs, with no server).
//   2. add the factory below, and its deps to `RouteDeps`.
//   3. classify each `/_api/*` path in `sync/writer-registry.ts` and, when a
//      cell serves it, in `apps/hub/src/studio-manifest.mjs` — both scrapers
//      read routes/*.ts, so an unclassified route is a red test.
// `origin: 'canvas'` is the only way onto the canvas origins; http.ts and
// routes/canvas-origin.ts derive both allowlists from it.

import { createAgentRuns } from '../agent-runs.ts';
import { type AgentRouteDeps, agentRouteSpecs } from './agent.ts';
import { createOutboxRoutes } from './outbox.ts';
import { createPinsRoutes, type PinsRouteDeps } from './pins.ts';
import { createProjectFormatRoutes, type ProjectFormatDeps } from './project-format.ts';
import { createShellRoutes, type ShellRouteDeps } from './shell.ts';
import type { RouteSpec } from './table.ts';

export interface RouteDeps {
  outbox: Parameters<typeof createOutboxRoutes>[0];
  projectFormat: ProjectFormatDeps;
  agent: AgentRouteDeps;
  /** V2-3.4 — the desktop shell's probe; its run count reads the agent table's registry */
  shell: Omit<ShellRouteDeps, 'runs'>;
  pins: PinsRouteDeps;
}

/** Every table route, in mount order. http.ts wraps each in `guardTableRoute`. */
export function allSpecs(deps: RouteDeps): RouteSpec[] {
  // ONE run registry: the hook routes write it, the shell status counts it (V2-3.4).
  deps.agent.runs ??= createAgentRuns(deps.agent.bracket);
  return [
    ...createOutboxRoutes(deps.outbox),
    ...createProjectFormatRoutes(deps.projectFormat),
    ...agentRouteSpecs(deps.agent),
    ...createShellRoutes({ ...deps.shell, runs: deps.agent.runs }),
    ...createPinsRoutes(deps.pins),
  ];
}
