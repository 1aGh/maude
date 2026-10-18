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

import { resolveAccess } from '../access/scope.ts';
import { createAgentRuns } from '../agent-runs.ts';
import { type AgentRouteDeps, agentRouteSpecs } from './agent.ts';
import { type AiRouteDeps, createAiRoutes } from './ai.ts';
import { type AnnotationRouteDeps, createAnnotationRoutes } from './annotations.ts';
import { type AvailabilityRouteDeps, createAvailabilityRoutes } from './availability.ts';
import { type ChatRouteDeps, createChatRoutes } from './chat.ts';
import { type ChatAttachDeps, createChatAttachRoutes } from './chat-attach.ts';
import { type CommentRouteDeps, createCommentRoutes } from './comments.ts';
import { createEditRoutes, type EditRouteDeps } from './edit.ts';
import { createLinksRoutes, type LinksRouteDeps } from './links.ts';
import { createOutboxRoutes } from './outbox.ts';
import { createPinsRoutes, type PinsRouteDeps } from './pins.ts';
import { createPresentRoutes, type PresentRouteDeps } from './present.ts';
import { createProjectFormatRoutes, type ProjectFormatDeps } from './project-format.ts';
import { createProjectUndoRoutes, type ProjectUndoDeps } from './project-undo.ts';
import { createShellRoutes, type ShellRouteDeps } from './shell.ts';
import { createSyncConflictRoutes, type SyncConflictRouteDeps } from './sync-conflicts.ts';
import type { RouteSpec } from './table.ts';
import { createTrashRoutes, type TrashRouteDeps } from './trash.ts';

const trashAccessNone = resolveAccess(null);

// S1.7 — the access a Trash request is judged with (interim until S9.9's currentAccess()).
export { trashAccess } from '../history/trash.ts';
// S5.4 / S2.18 — the held-by-ai backstop http.ts's legacy `/_api/edit-*` routes ask before a
// write. Re-exported here because http.ts reaches routes/ only through index + table.
export { heldByAiRefusal } from './agent.ts';
// S11.4 — the index payload's canvas paths, the availability route's `local` (the panel's own scan).
export { canvasPathsOfIndex } from './availability.ts';
// S2.9b — the `annotations` rider of the legacy `/_api/canvas-meta` PATCH (one action, one ⌘Z)
export { riderPatch } from './canvas-meta-rider.ts';
// S5.5b — the run registry's stage hooks + the bus announcement (http.ts reaches routes/ only here)
export { announceAction, runStageHooks } from './project-undo.ts';

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
  /** S1.7 — the shared Trash: `GET /_api/trash`, `POST /_api/trash/restore|clear` */
  trash?: TrashRouteDeps;
  /** S1.18 — `GET /_api/link/resolve` (stable canvas links: entry → path) */
  links?: LinksRouteDeps;
  /** S5.10 — attachments (→ Assets / this Mac's `_chat/attachments/`) + folder consent */
  chatAttach?: ChatAttachDeps;
  /** S9.7b — `POST /_api/comments/op`: one comment op (comments/ops.ts) as the session */
  comments?: CommentRouteDeps;
  /** S4.7 — sticky ↔ comment (one action, two lanes) + its undo guard on `projectUndo` */
  annotations?: AnnotationRouteDeps;
  /** S11.4 — `GET /_api/sync/availability`: listed ∖ on disk, a read over the runtime's state */
  availability?: AvailabilityRouteDeps;
  /** S9.24 — the object-conflict card: `GET /_api/sync/conflicts`, `POST …/resolve` (one lane edit) */
  syncConflicts?: SyncConflictRouteDeps;
}

/** Every table route, in mount order. http.ts wraps each in `guardTableRoute`. */
export function allSpecs(deps: RouteDeps): RouteSpec[] {
  // ONE run registry (S5.3, ai/runs.ts): the hook routes' view writes it, the shell status counts
  // it (V2-3.4), and `/_api/ai/runs*` reads it — never a second map.
  deps.agent.runs ??= createAgentRuns(deps.agent.bracket, undefined, deps.ai.registry);
  const convert = deps.annotations ? createAnnotationRoutes(deps.annotations) : null;
  const projectUndo = deps.projectUndo ?? { control: () => null, designRel: deps.ai.designRel };
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
    ...(deps.chatAttach ? createChatAttachRoutes(deps.chatAttach) : []),
    ...createProjectUndoRoutes(
      convert ? { ...projectUndo, guard: convert.undoGuard } : projectUndo
    ),
    ...createPresentRoutes(deps.present),
    ...createTrashRoutes(
      deps.trash ?? {
        control: () => null,
        // no home wired: nobody may write, and there is nothing to list
        access: () => trashAccessNone,
        readSource: () => null,
      }
    ),
    ...createLinksRoutes(deps.links ?? { control: () => null, designRel: deps.ai.designRel }),
    ...createCommentRoutes(
      deps.comments ?? {
        designRel: deps.ai.designRel,
        actor: async () => ({ name: '' }),
        fileOf: async () => null,
        apply: async () => ({
          ok: false,
          status: 404,
          code: 'not-found',
          error: 'No such comment.',
        }),
      }
    ),
    ...(convert?.specs ?? []),
    ...(deps.availability ? createAvailabilityRoutes(deps.availability) : []),
    ...(deps.syncConflicts ? createSyncConflictRoutes(deps.syncConflicts) : []),
  ];
}
