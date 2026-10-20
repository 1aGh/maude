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
import { type AssetDetailsRouteDeps, createAssetDetailsRoutes } from './asset-details.ts';
import { type AssetStateRouteDeps, createAssetStateRoutes } from './asset-state.ts';
import { type AssetTrashRouteDeps, createAssetTrashRoutes } from './asset-trash.ts';
import { type AvailabilityRouteDeps, createAvailabilityRoutes } from './availability.ts';
import { type CanvasSourceRouteDeps, createCanvasSourceRoutes } from './canvas-source.ts';
import { type ChatRouteDeps, createChatRoutes } from './chat.ts';
import { type ChatAttachDeps, createChatAttachRoutes } from './chat-attach.ts';
import { type CloudMoveDeps, createCloudMoveRoutes } from './cloud-move.ts';
import { type CloudPlanDeps, createCloudPlanRoutes } from './cloud-plan.ts';
import { type CommentRouteDeps, createCommentRoutes } from './comments.ts';
import { type ConnectionsRouteDeps, createConnectionsRoutes } from './connections.ts';
import { createDiagnosticsRoutes, type DiagnosticsRouteDeps } from './diagnostics.ts';
import { createDsRoutes, type DsRouteDeps } from './ds.ts';
import { createDsCheckRoutes } from './ds-check.ts';
import { createEditRoutes, type EditRouteDeps } from './edit.ts';
import { createElementLinksRoutes, type ElementLinksRouteDeps } from './element-links.ts';
import { createExportRoutes, type ExportRouteDeps } from './export.ts';
import { createFigmaRoutes, type FigmaRouteDeps } from './figma.ts';
import { createGenerateRoutes, type GenerateRouteDeps } from './generate.ts';
import { createHandoffRoutes, type HandoffRouteDeps } from './handoff.ts';
import { createHelpGuidesRoutes, type HelpGuidesDeps } from './help-guides.ts';
import { createHistoryRoutes, type HistoryRouteDeps } from './history.ts';
import { createKindRoutes } from './kinds.ts';
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
import { createTrashRoutes, type TrashRouteDeps } from './trash.ts';
import { createVideoRoutes } from './video.ts';
import { createVoteRoutes, type VoteRouteDeps } from './votes.ts';

const trashAccessNone = resolveAccess(null);

// S1.7 — the access a Trash request is judged with (interim until S9.9's currentAccess()).
export { trashAccess } from '../history/trash.ts';
// S5.4 / S2.18 — the held-by-ai backstop http.ts's legacy `/_api/edit-*` routes ask before a
// write. Re-exported here because http.ts reaches routes/ only through index + table.
export { heldByAiRefusal } from './agent.ts';
// S8.19 — the asset-state service, built once by http.ts over the live sync runtime.
export { assetStateDepsFor } from './asset-state.ts';
// S11.4 — the index payload's canvas paths, the availability route's `local` (the panel's own scan).
export { canvasPathsOfIndex } from './availability.ts';
// S2.9b — the `annotations` rider of the legacy `/_api/canvas-meta` PATCH (one action, one ⌘Z)
export { riderPatch } from './canvas-meta-rider.ts';
// S8.1 — the v2 half of http.ts's legacy `/_api/export(-jobs)` routes shares the estimate's gate.
export { cloudExportResponse, type ExportRouteDeps, gateSpecV2, planExportV2 } from './export.ts';
// S8.16 — the Generate-with-N-takes deps over the live registry, key store and generation queue.
export { generateDepsFor } from './generate.ts';
// S8.10 — the queued handoff's release reads the same target + review the route does.
export { type HandoffRouteDeps, resolveQueuedHandoff } from './handoff.ts';
// S5.5b — the run registry's stage hooks + the bus announcement (http.ts reaches routes/ only here)
export { announceAction, runStageHooks } from './project-undo.ts';
// S9.19 — the outbox's `share.invite` door is the share routes' own hub call (routes/share.ts).
export { type ShareRouteDeps, shareAskToEditSender, shareInviteSender } from './share.ts';
// S9.21b — the trashed-while-open write stop, behind http.ts's access gate.
export { createTrashWriteStop, withTrashStop } from './trash.ts';
// S4.14 — where a project's votes live (local / hub / off), resolved per request by http.ts.
export { createVoteHomeResolver as voteHomeResolver } from './votes.ts';

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
  /** S11.17 — errors and recovery: the crash line's last-work time, the full-disk hold + its Retry */
  diagnostics?: DiagnosticsRouteDeps;
  /** S11.13 — `GET /_api/kg/summary` + `GET /_api/settings/about` (Settings › Advanced; counts and versions only) */
  settings?: SettingsRouteDeps;
  /** S6.0b — `POST|GET /_api/cloud/move`: a local folder becomes a cloud project (S6-S9 §5.5) */
  cloudMove: CloudMoveDeps;
  /** S9.20b — `GET /_api/cloud/plan`: the account's plan words' facts (main origin, device token) */
  cloudPlan?: CloudPlanDeps;
  /** S11.14 — `GET /_api/connections/hub` (main origin): the linked team server's Advanced details */
  connections?: ConnectionsRouteDeps;
  /** S8.19 — `GET /_api/asset-state` (main origin): disk + upload queue + hub presence */
  assetState?: AssetStateRouteDeps;
  /** S8.13 — `POST /_api/assets/trash` (main origin, Can edit on the project): assets + sidecars to `_trash/` */
  assetTrash?: AssetTrashRouteDeps;
  /** S8.17 — `POST /_api/figma/frames` + `…/import-frames` (main origin, Can edit on the project): frames as pictures */
  figma?: FigmaRouteDeps;
  /** S8.21 — `GET /_api/asset-details` and `GET /_api/asset-generated` (main origin, reads): details per kind, the Generated runs */
  assetDetails?: AssetDetailsRouteDeps;
  /** S8.16 — `/_api/generate-takes*` (main origin, Can edit on the canvas): N takes, the consent quote, ← → */
  generate?: GenerateRouteDeps;
  /** S8.10 — `/_api/handoff*` (main origin, Can edit): Handoff to production as one scoped AI run */
  handoff?: HandoffRouteDeps;
  /** S9.19 — `/_api/share/*`: the desktop's door to the linked hub's access API (main origin only) */
  share: ShareRouteDeps;
  /** S9.24 — the object-conflict card: `GET /_api/sync/conflicts`, `POST …/resolve` (one lane edit) */
  syncConflicts?: SyncConflictRouteDeps;
  /** S10.3 — a converted design system's reviews (`/_api/ds/*`, main origin only, Q15 gates) */
  ds?: DsRouteDeps;
  /** S4.14 — `/_api/votes*`: formal votes (local board ballots, or a proxy to a `votes-v1` hub) */
  votes?: VoteRouteDeps;
  /** S6.15 — `POST /_api/help/add-guides`: Help › Help and guides adds the two guide canvases (Q10) */
  helpGuides?: HelpGuidesDeps;
}

/** Every table route, in mount order. http.ts wraps each in `guardTableRoute`. */
export function allSpecs(deps: RouteDeps): RouteSpec[] {
  // ONE run registry (S5.3, ai/runs.ts): the hook routes' view writes it, the shell status counts
  // it (V2-3.4), and `/_api/ai/runs*` reads it — never a second map.
  deps.agent.runs ??= createAgentRuns(deps.agent.bracket, undefined, deps.ai.registry);
  const convert = deps.annotations ? createAnnotationRoutes(deps.annotations) : null;
  const projectUndo = deps.projectUndo ?? { control: () => null, designRel: deps.ai.designRel };
  const dsDeps: DsRouteDeps = deps.ds ?? {
    // no engine wired: every DS route answers 503 `ds-unavailable`
    engine: () => null,
    access: () => trashAccessNone,
    person: async () => ({ name: '' }),
  };
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
    // S7.20 — GET /_api/kinds/presets (routes/kinds.ts): the F size picker's catalogue (minRole edit, main origin).
    ...createKindRoutes({
      designRoot: deps.edit.designRoot,
      designRel: deps.edit.designRel,
      access: deps.edit.access,
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
    ...createDiagnosticsRoutes(deps.diagnostics ?? { control: () => null }),
    ...(deps.settings ? createSettingsRoutes(deps.settings) : []),
    ...createCloudMoveRoutes(deps.cloudMove),
    ...(deps.cloudPlan ? createCloudPlanRoutes(deps.cloudPlan) : []),
    ...(deps.helpGuides ? createHelpGuidesRoutes(deps.helpGuides) : []),
    ...(deps.connections ? createConnectionsRoutes(deps.connections) : []),
    ...createAssetStateRoutes(deps.assetState ?? { service: () => null }),
    ...(deps.assetTrash ? createAssetTrashRoutes(deps.assetTrash) : []),
    ...(deps.figma ? createFigmaRoutes(deps.figma) : []),
    ...(deps.assetDetails ? createAssetDetailsRoutes(deps.assetDetails) : []),
    ...(deps.generate ? createGenerateRoutes(deps.generate) : []),
    ...(deps.handoff ? createHandoffRoutes(deps.handoff) : []),
    ...createShareRoutes(deps.share),
    ...(deps.syncConflicts ? createSyncConflictRoutes(deps.syncConflicts) : []),
    ...createDsRoutes(dsDeps),
    // S10.19 — Design system › Advanced and Check the system (routes/ds-check.ts)
    ...createDsCheckRoutes(dsDeps),
    // S4.14 — no home wired: votes are off (every write 409 `votes-off`), nothing is read or written
    ...createVoteRoutes(
      deps.votes ?? {
        designRel: deps.ai.designRel,
        home: () => ({ kind: 'off' }),
        person: async () => '',
        readBoard: async () => ({ ok: false, error: 'no board' }),
        applyOps: async () => ({ ok: false }),
      }
    ),
  ];
}
