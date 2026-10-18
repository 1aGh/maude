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
import { type AiRouteDeps, createAiRoutes } from './ai.ts';
import { type ChatRouteDeps, createChatRoutes } from './chat.ts';
import { createEditRoutes, type EditRouteDeps } from './edit.ts';
import { createOutboxRoutes } from './outbox.ts';
import { createPinsRoutes, type PinsRouteDeps } from './pins.ts';
import { createPresentRoutes, type PresentRouteDeps } from './present.ts';
import { createProjectFormatRoutes, type ProjectFormatDeps } from './project-format.ts';
import { createProjectUndoRoutes, type ProjectUndoDeps } from './project-undo.ts';
import { createShellRoutes, type ShellRouteDeps } from './shell.ts';
import type { RouteSpec } from './table.ts';

// S5.4 / S2.18 — the held-by-ai backstop http.ts's legacy `/_api/edit-*` routes ask before a
// write. Re-exported here because http.ts reaches routes/ only through index + table.
export { heldByAiRefusal } from './agent.ts';

export interface RouteDeps {
  outbox: Parameters<typeof createOutboxRoutes>[0];
  projectFormat: ProjectFormatDeps;
  agent: AgentRouteDeps;
  /** V2-3.4 — the desktop shell's probe; its run count reads the agent table's registry */
  shell: Omit<ShellRouteDeps, 'runs'>;
  pins: PinsRouteDeps;
  /** S5.3 — `/_api/ai/runs*` + the v1 `/_api/ai` routes, on THE run registry */
  ai: AiRouteDeps;
  /** S5.7 — the chat store: search, trash, the resume session id */
  chat: ChatRouteDeps;
  /** S2.1 — `POST /_api/edit-op`, the one dispatch route for structural edits (main origin only) */
  edit: Omit<EditRouteDeps, 'runs'>;
  /** S5.5 — `POST /_api/project/undo` (one id, several, a chat) + `GET …/undo-stack` */
  projectUndo?: ProjectUndoDeps;
  /** S3.5 — `PATCH /_api/present-meta`: Present order, skip and notes in the versioned meta */
  present: PresentRouteDeps;
}

/** Every table route, in mount order. http.ts wraps each in `guardTableRoute`. */
export function allSpecs(deps: RouteDeps): RouteSpec[] {
  // ONE run registry (S5.3, ai/runs.ts): the hook routes' view writes it, the shell status counts
  // it (V2-3.4), and `/_api/ai/runs*` reads it — never a second map.
  deps.agent.runs ??= createAgentRuns(deps.agent.bracket, undefined, deps.ai.registry);
  return [
    ...createOutboxRoutes(deps.outbox),
    ...createProjectFormatRoutes(deps.projectFormat),
    ...agentRouteSpecs(deps.agent),
    ...createShellRoutes({ ...deps.shell, runs: deps.agent.runs }),
    ...createPinsRoutes(deps.pins),
    ...createAiRoutes(deps.ai),
    ...createChatRoutes(deps.chat),
    // S2.1 — AI holds read THE run registry (V2-1.15 §4 #13)
    ...createEditRoutes({ ...deps.edit, runs: deps.ai.registry }),
    ...createProjectUndoRoutes(
      deps.projectUndo ?? { control: () => null, designRel: deps.ai.designRel }
    ),
    ...createPresentRoutes(deps.present),
  ];
}
