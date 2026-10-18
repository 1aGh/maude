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
import { type CanvasSourceRouteDeps, createCanvasSourceRoutes } from './canvas-source.ts';
import { type AssetStateRouteDeps, createAssetStateRoutes } from './asset-state.ts';
import { type ChatRouteDeps, createChatRoutes } from './chat.ts';
import { type ChatAttachDeps, createChatAttachRoutes } from './chat-attach.ts';
import { type CommentRouteDeps, createCommentRoutes } from './comments.ts';
import { type CloudMoveDeps, createCloudMoveRoutes } from './cloud-move.ts';
import { createDsRoutes, type DsRouteDeps } from './ds.ts';
import { createEditRoutes, type EditRouteDeps } from './edit.ts';
import { createElementLinksRoutes, type ElementLinksRouteDeps } from './element-links.ts';
import { createHistoryRoutes, type HistoryRouteDeps } from './history.ts';
import { createExportRoutes, type ExportRouteDeps } from './export.ts';
import { createLinksRoutes, type LinksRouteDeps } from './links.ts';
import { createOutboxRoutes } from './outbox.ts';
import { createPinsRoutes, type PinsRouteDeps } from './pins.ts';
import { createPresentRoutes, type PresentRouteDeps } from './present.ts';
import { createProjectFormatRoutes, type ProjectFormatDeps } from './project-format.ts';
import { createProjectUndoRoutes, type ProjectUndoDeps } from './project-undo.ts';
import { createSettingsRoutes, type SettingsRouteDeps } from './settings.ts';
import { createShareRoutes, type ShareRouteDeps } from './share.ts';
import { createShellRoutes, type ShellRouteDeps } from './shell.ts';
import { createSyncRoutes, type SyncRouteDeps } from './sync.ts';
import { createSyncConflictRoutes, type SyncConflictRouteDeps } from './sync-conflicts.ts';
import type { RouteSpec } from './table.ts';
import { createVideoRoutes } from './video.ts';
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
// S8.19 — the asset-state service, built once by http.ts over the live sync runtime.
export { assetStateDepsFor } from './asset-state.ts';
// S8.1 — the v2 half of http.ts's legacy `/_api/export(-jobs)` routes shares the estimate's gate.
export { type ExportRouteDeps, gateSpecV2, planExportV2 } from './export.ts';
// S5.5b — the run registry's stage hooks + the bus announcement (http.ts reaches routes/ only here)
export { announceAction, runStageHooks } from './project-undo.ts';
// S9.19 — the outbox's `share.invite` door is the share routes' own hub call (routes/share.ts).
export { type ShareRouteDeps, shareInviteSender } from './share.ts';

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
  /** S3.10a — `GET /_api/links?file=` (main origin only; the shell's link-follow reads it) */
  elementLinks: ElementLinksRouteDeps;
  /** S3.5 — `PATCH /_api/present-meta`: Present order, skip and notes in the versioned meta */
  present: PresentRouteDeps;
  /** S11.6 — `GET /_api/canvas-source` + `GET /_api/canvas-errors` (main origin, `export`) */
  canvasSource: CanvasSourceRouteDeps;
  /** S8.1 — `POST /_api/export-estimate` (ExportSpec v2); optional so stub tables need not build it */
  export?: ExportRouteDeps;
  /** S1.7 — the shared Trash: `GET /_api/trash`, `POST /_api/trash/restore|clear` */
  trash?: TrashRouteDeps;
  /** S1.12b — Version history: `/_api/project/{history,restore,versions,changes,source,name,aside}` */
  history?: HistoryRouteDeps;
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
  /** S11.11 — `POST /_api/sync/resync` (moved from http.ts) + the trace `/_sync-status` reports */
  sync: SyncRouteDeps;
  /** S11.13 — `GET /_api/kg/summary` + `GET /_api/settings/about` (Settings › Advanced; counts and versions only) */
  settings?: SettingsRouteDeps;
  /** S6.0b — `POST|GET /_api/cloud/move`: a local folder becomes a cloud project (S6-S9 §5.5) */
  cloudMove: CloudMoveDeps;
  /** S8.19 — `GET /_api/asset-state` (main origin): disk + upload queue + hub presence */
  assetState?: AssetStateRouteDeps;
  /** S9.19 — `/_api/share/*`: the desktop's door to the linked hub's access API (main origin only) */
  share: ShareRouteDeps;
  /** S9.24 — the object-conflict card: `GET /_api/sync/conflicts`, `POST …/resolve` (one lane edit) */
  syncConflicts?: SyncConflictRouteDeps;
  /** S10.3 — a converted design system's reviews (`/_api/ds/*`, main origin only, Q15 gates) */
  ds?: DsRouteDeps;
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
    ...createElementLinksRoutes(deps.elementLinks),
    // S2.1 — AI holds read THE run registry (V2-1.15 §4 #13)
    ...createEditRoutes({ ...deps.edit, runs: deps.ai.registry }),
    ...(deps.chatAttach ? createChatAttachRoutes(deps.chatAttach) : []),
    ...createProjectUndoRoutes(
      convert ? { ...projectUndo, guard: convert.undoGuard } : projectUndo
    ),
    ...createPresentRoutes(deps.present),
    ...createCanvasSourceRoutes(deps.canvasSource),
    ...(deps.export ? createExportRoutes(deps.export) : []),
    // S7.4 — GET /_api/comp-media (routes/video.ts): the comp's words, speech and beats derived from
    // its cut. It needs only the design root and its name, which the present and ai deps already carry.
    ...createVideoRoutes({
      designRoot: deps.present.designRoot,
      designRel: deps.ai.designRel,
    }),
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
    ...createHistoryRoutes(deps.history ?? { control: () => null, designRel: deps.ai.designRel }),
    ...(deps.availability ? createAvailabilityRoutes(deps.availability) : []),
    ...createSyncRoutes(deps.sync),
    ...(deps.settings ? createSettingsRoutes(deps.settings) : []),
    ...createCloudMoveRoutes(deps.cloudMove),
    ...createAssetStateRoutes(deps.assetState ?? { service: () => null }),
    ...createShareRoutes(deps.share),
    ...(deps.syncConflicts ? createSyncConflictRoutes(deps.syncConflicts) : []),
    ...createDsRoutes(
      deps.ds ?? {
        // no engine wired: every DS route answers 503 `ds-unavailable`
        engine: () => null,
        access: () => trashAccessNone,
        person: async () => ({ name: '' }),
      }
    ),
  ];
}
