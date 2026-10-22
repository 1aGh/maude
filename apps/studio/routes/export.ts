// Export — S8.1 (contract client/v2/contracts/S8-export-spec.md §5.3–§5.6).
//
// `POST /_api/export-estimate {spec: ExportSpecV2}` → numbers only (§5.5): counts per scope,
// files, bytes, seconds, the lane `auto` resolves to, per kind, and what is skipped and why.
// It writes nothing, but it is the EXPORT class (access/request.ts `EXPORT_WRITES`): Can view
// is refused it like every export, and it carries the same CSRF + rebinding gates
// (`guardTableRoute`).
//
// `planExportV2` is the v2 half of the EXISTING `/_api/export` + `/_api/export-jobs` routes
// (http.ts calls it when a body is `{v:2, spec}`; the v1 `{format, scope, options}` body is
// untouched). Both doors share one ACL (V2-1.16 L7, §5.3):
//   - a session without `export` anywhere → 403 (the role refusal);
//   - Folder and Whole project are PROJECT-class: a canvas-only session → 403 `not-in-scope`
//     with exactly the body a missing file gets — it never learns what the folder holds;
//   - Selection / This canvas: the canvas must be one the session sees (else the same
//     `not-in-scope`, so ungranted ≡ missing) and holds `export` on;
//   - the expansion runs over the canvases the session sees, never the raw tree.
// Captures still render on the capture origin (canvasShellUrl → the main origin's 307).
//
// `POST /_api/export-jobs/retry {id, items?}` (S8.4, §5.6) runs only the failed (or waiting) items
// of one group job again. It is the export class, and session-scoped: a job that is not yours
// answers exactly like an id that never existed (the download route's 404, V2-1.16 U1).

import { ACP_REFUSAL, notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { estimateSpec } from '../exporters/estimate.ts';
import { isFormat } from '../exporters/index.ts';
import type { ExportHistoryEntry, RetryResult } from '../exporters/jobs.ts';
import {
  type PreflightTarget,
  preflightPrint,
  type RectsManifest,
} from '../exporters/print-preflight.ts';
import { type CloudExports, chooseRenderLane } from '../exporters/remote.ts';
import {
  resolveSpecV2,
  type SkipReason,
  type SpecCanvas,
  type SpecUnit,
} from '../exporters/scope.ts';
import type { GroupPlan } from '../exporters/spec-run.ts';
import { type ExportSpecV2, PROJECT_CLASS_SCOPES, validateSpecV2 } from '../exporters/spec-v2.ts';
import {
  defaultVideoFacts,
  enforceVideoCap,
  type VideoFactsReader,
} from '../exporters/video-cap.ts';
import { sessionFromRequest } from '../session-scope.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 64 * 1024;
const MAX_RETRY_ITEMS = 256;
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface ExportRouteDeps {
  /** the design root relative to the repo root (`.design`) */
  designRel: string;
  /** {project} — the project's display name */
  projectName(): string;
  /** every canvas in the project index (designRoot-relative rows) */
  canvases(): readonly SpecCanvas[];
  /** the active canvas, designRoot-relative (the Selection / This canvas default) */
  activeCanvas(): string | null;
  /**
   * S8.6 — what a video artboard's canvas says (length, stored `maxFrames`): the C22 cap is decided from
   * THIS, never from the client. Absent = read it under `preflight.designRoot`; neither = lengths unknown
   * (the engine's own 3 600 still holds, because the cap is stamped on every video unit regardless).
   */
  videoFacts?: VideoFactsReader;
  /** THIS request's session (access/request.ts `currentAccess`) */
  access(req?: Request): Access;
  /** this session's finished exports (throughput history) */
  history(): readonly ExportHistoryEntry[];
  /** where `lane: 'auto'` renders (workspace-mode.ts `resolveRenderLane`) */
  renderLane(): 'local' | 'remote' | 'none';
  /** S8.5 — is a cloud render door on offer on this Mac (exporters/remote.ts `CloudExports`)? */
  cloudRender?(): boolean;
  /** S8.5 — a canvas's longest comp in seconds, for "Suggest each time" (null = unknown) */
  videoSeconds?(canvasRel: string): number | null;
  /**
   * S8.7 — `POST /_api/export-preflight`: the absolute design root (fonts are read under it) and the
   * canvas geometry source (a headless render of the canvas; null/absent = unmeasured, never an error)
   */
  preflight?: {
    designRoot: string;
    rects?(canvasRel: string): Promise<RectsManifest | null>;
  };
  /** S8.4 — run a group job's failed items again; `session` = who asks (the job queue's owner check) */
  retry(
    id: string,
    items: readonly string[] | undefined,
    session: string,
    allow: (canvas: string | null) => boolean
  ): Promise<RetryResult>;
}

/** The role refusal — the same shape the local gate answers a read-only write with. */
const capabilityRefusal = () => json(403, ACP_REFUSAL);

export type SpecGate =
  | {
      ok: true;
      spec: ExportSpecV2;
      units: SpecUnit[];
      skipped: Array<{ name: string; reason: SkipReason }>;
      canvases: string[];
      visible: SpecCanvas[];
      access: Access;
    }
  | { ok: false; response: Response };

/** Validate a spec and apply the ACL; the shared front half of every v2 door. */
export function gateSpecV2(raw: unknown, deps: ExportRouteDeps, req?: Request): SpecGate {
  // the role first: a session that exports nowhere learns nothing, not even a 400
  const access = deps.access(req);
  const projectExport = access.can('export', null);
  if (!projectExport && access.grants.length === 0)
    return { ok: false, response: capabilityRefusal() };
  const checked = validateSpecV2(raw);
  if (!checked.ok) return { ok: false, response: json(400, checked.error) };
  const spec = checked.spec;
  // Folder / Whole project: project-class. A canvas-only session gets the missing-file body.
  if (PROJECT_CLASS_SCOPES.has(spec.scope) && !projectExport)
    return {
      ok: false,
      response: access.canvasOnly ? notInScopeResponse() : capabilityRefusal(),
    };
  const visible = deps
    .canvases()
    .filter((c) => access.role !== null || access.seesCanvas(c.rel)) as SpecCanvas[];
  const res = resolveSpecV2(spec, {
    designRel: deps.designRel,
    canvases: visible,
    activeCanvas: deps.activeCanvas(),
  });
  if (!res.ok) {
    if (res.reason === 'not-in-scope') return { ok: false, response: notInScopeResponse() };
    return {
      ok: false,
      response: json(400, { error: 'bad-spec', field: res.field, message: res.message }),
    };
  }
  if (!projectExport && res.canvases.some((rel) => !access.can('export', rel)))
    return { ok: false, response: capabilityRefusal() };
  return {
    ok: true,
    spec,
    units: res.units,
    skipped: res.skipped,
    canvases: res.canvases,
    visible,
    access,
  };
}

/**
 * S8.1b — the formats a past version and Display P3 export as: the PNG/JPG capture (exporters/png.ts)
 * takes both. Every other capture would ignore them and hand over today's canvas / an sRGB file.
 */
const AT_FORMATS = new Set<string>(['png', 'jpg']);
const P3_FORMATS = new Set<string>(['png', 'jpg']);

/** What the v2 export doors cannot run (here, or yet): refused with the field, never silently dropped. */
function notYet(
  spec: ExportSpecV2,
  units: SpecUnit[],
  lane: 'local' | 'remote' | 'none'
): Response | null {
  const no = (field: string, message: string) =>
    json(400, { error: 'not-available', field, message });
  // S8.1b — a past version renders on this Mac's capture origin from its own history store; the
  // render service and the member's browser render today's canvas, so a workspace refuses it.
  if (spec.at && lane !== 'local')
    return no('at', 'Exporting a past version works in the desktop app.');
  if (spec.at && units.some((u) => !AT_FORMATS.has(u.format)))
    return no('at', 'A past version exports as PNG or JPG for now.');
  // Q6 — Display P3 is the this-Mac Chromium lane only (forced there whatever `lane` asked for); the
  // render service and the browser capture would write sRGB.
  const p3 = units.filter((u) => u.v2.colorProfile === 'display-p3');
  if (p3.length && lane !== 'local')
    return no('options.colorProfile', 'Display P3 exports in the desktop app. Here, pick sRGB.');
  if (p3.some((u) => !P3_FORMATS.has(u.format)))
    return no('options.colorProfile', 'Display P3 is for PNG and JPG.');
  const missing = units.find((u) => !isFormat(u.format));
  if (missing) return no('format', `${missing.format.toUpperCase()} export is not available yet.`);
  return null;
}

/** S8.6 — the reader the cap and the estimate use: the injected one, else the design root's own files. */
function videoReader(deps: ExportRouteDeps): VideoFactsReader | null {
  return deps.videoFacts ?? (deps.preflight ? defaultVideoFacts(deps.preflight.designRoot) : null);
}

/**
 * The v2 half of `/_api/export` + `/_api/export-jobs`: a refusal, or the group plan the job
 * queue runs (`EnqueueArgs.group`). `first` names the first unit's format + scope, which the
 * queue's lane and timeout read.
 */
/**
 * S8.5 — the cloud half of `POST /_api/export-jobs` on a desktop: a video the person sent to the
 * cloud becomes an outbox `export.cloud` record whose id IS the job id (V2-1.14 §5.6). Answers 202
 * `{jobId, queued, words}`, or null when this export renders on this Mac (every image and PDF, any
 * spec without `lane: 'cloud'`, no cloud door, P3, a past version, a workspace cell).
 */
export function cloudExportResponse(
  group: GroupPlan,
  deps: {
    cloud: Pick<CloudExports, 'available' | 'start'> | null;
    renderLane: 'local' | 'remote' | 'none';
    label: string;
    actor: string;
    device: string;
    project: { id: string | null; hub: string | null };
  }
): Response | null {
  if (deps.renderLane !== 'local' || !deps.cloud) return null;
  if (chooseRenderLane(group.spec, { cloud: deps.cloud.available() }) !== 'cloud') return null;
  const r = deps.cloud.start({
    spec: group.spec,
    label: deps.label,
    actor: deps.actor,
    device: deps.device,
    project: deps.project,
  });
  if (!r.ok)
    return json(503, { error: r.words ?? 'The export could not be queued.', reason: r.code });
  return json(202, { jobId: r.jobId, queued: true, runsOn: 'cloud', words: r.words });
}

export function planExportV2(
  raw: unknown,
  deps: ExportRouteDeps,
  req?: Request,
  now: Date = new Date()
): { ok: false; response: Response } | { ok: true; group: GroupPlan; first: SpecUnit } {
  const g = gateSpecV2(raw, deps, req);
  if (!g.ok) return g;
  const refused = notYet(g.spec, g.units, deps.renderLane());
  if (refused) return { ok: false, response: refused };
  // S8.6 (C22) — a video past its cap is refused here, and every video unit carries the cap it was held to
  const capped = enforceVideoCap(g.units, videoReader(deps));
  if (!capped.ok) {
    const { ok: _ok, ...body } = capped;
    return { ok: false, response: json(422, body) };
  }
  // S8.1b — the version every capture renders: the sha only (validated by spec-v2.ts), never a source
  const at = g.spec.at?.sha;
  const units = at
    ? capped.units.map((u) => ({ ...u, options: { ...u.options, atSha: at } }))
    : capped.units;
  const first = units[0];
  if (!first)
    return { ok: false, response: json(422, { error: 'nothing-to-export', skipped: g.skipped }) };
  return {
    ok: true,
    first,
    group: { spec: g.spec, units, project: deps.projectName(), date: now },
  };
}

/** The retry body: `{id, items?}`, nothing else. */
function parseRetryBody(text: string): { id: string; items?: string[] } | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== 'id' && k !== 'items')) return null;
  if (typeof b.id !== 'string' || !b.id || b.id.length > 64) return null;
  if (b.items === undefined) return { id: b.id };
  if (
    !Array.isArray(b.items) ||
    b.items.length > MAX_RETRY_ITEMS ||
    b.items.some((x) => typeof x !== 'string' || !x || x.length > 128)
  )
    return null;
  return { id: b.id, items: b.items as string[] };
}

export function createExportRoutes(deps: ExportRouteDeps): RouteSpec[] {
  return [
    {
      method: 'POST',
      path: '/_api/export-estimate',
      origin: 'main',
      // it writes nothing; the EXPORT class (access/request.ts) still refuses Can view
      readOnly: 'allowed',
      handle: async (req) => {
        const a = deps.access(req);
        if (!a.can('export', null) && a.grants.length === 0) return capabilityRefusal();
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { error: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { error: 'too-large' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { error: 'bad-json' });
        }
        const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
        if (!b || Object.keys(b).some((k) => k !== 'spec'))
          return json(400, { error: 'bad-spec', field: 'body', message: 'body must be {spec}' });
        const g = gateSpecV2(b.spec, deps, req);
        if (!g.ok) return g.response;
        // the counts are about the spec's canvas, else the open one (its folder for Folder)
        const target = g.spec.canvas ?? deps.activeCanvas();
        return json(
          200,
          estimateSpec(g.spec, g, {
            canvases: g.visible,
            canvas: target && g.visible.some((c) => c.rel === target) ? target : null,
            canvasOnly: g.access.canvasOnly,
            history: deps.history(),
            renderLane: deps.renderLane(),
            ...(videoReader(deps) ? { video: videoReader(deps) as VideoFactsReader } : {}),
            cloud: deps.cloudRender?.() ?? false,
            ...(deps.videoSeconds
              ? { videoSeconds: (rel: string) => deps.videoSeconds?.(rel) ?? null }
              : {}),
          })
        );
      },
    },
    {
      // S8.7 — what the sheet checks before a Print PDF: paper, the back, safe margin, fonts. Numbers and
      // names only; the EXPORT class (Can view refused), the same CSRF + rebinding gates, writes nothing.
      method: 'POST',
      path: '/_api/export-preflight',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const a = deps.access(req);
        if (!a.can('export', null) && a.grants.length === 0) return capabilityRefusal();
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { error: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { error: 'too-large' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { error: 'bad-json' });
        }
        const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
        // `measure: false` (P8-C4): paper, back and fonts NOW, without the headless safe-margin render (seconds);
        // the sheet asks again without it for the margin. Absent = measure, as before.
        if (
          !b ||
          Object.keys(b).some((k) => k !== 'spec' && k !== 'measure') ||
          (b.measure !== undefined && typeof b.measure !== 'boolean')
        )
          return json(400, {
            error: 'bad-spec',
            field: 'body',
            message: 'body must be {spec, measure?: boolean}',
          });
        const g = gateSpecV2(b.spec, deps, req);
        if (!g.ok) return g.response;
        if (!deps.preflight)
          return json(200, await preflightPrint({ designRoot: '', targets: [] }));
        const byRel = new Map(g.visible.map((c) => [c.rel, c]));
        const seen = new Set<string>();
        const targets: PreflightTarget[] = [];
        for (const u of g.units) {
          const c = u.canvas ? byRel.get(u.canvas) : null;
          if (!c) continue;
          for (const board of u.artboards) {
            const key = `${c.rel}\u0000${board.id}`;
            if (board.kind !== 'print' || seen.has(key)) continue;
            seen.add(key);
            targets.push({ canvas: c.rel, board, all: c.artboards });
          }
        }
        return json(
          200,
          await preflightPrint({
            designRoot: deps.preflight.designRoot,
            targets,
            ...(deps.preflight.rects && b.measure !== false ? { rects: deps.preflight.rects } : {}),
          })
        );
      },
    },
    {
      method: 'POST',
      path: '/_api/export-jobs/retry',
      origin: 'main',
      // the export class (access/request.ts EXPORT_WRITES): Can comment and up, never Can view
      readOnly: 'allowed',
      handle: async (req) => {
        const a = deps.access(req);
        if (!a.can('export', null) && a.grants.length === 0) return capabilityRefusal();
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { error: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { error: 'too-large' });
        const body = parseRetryBody(text);
        if (!body)
          return json(400, { error: 'bad-retry', message: 'body must be {id, items?: string[]}' });
        // access can change after the job was made: every canvas a retried item reaches is gated again
        const r = await deps.retry(body.id, body.items, sessionFromRequest(req), (canvas) =>
          a.can('export', canvas)
        );
        if (r.ok) return json(202, { jobId: body.id, items: r.items }) as Response;
        // not yours ≡ never existed: the same answer the download route gives
        if (r.reason === 'missing') return new Response('Not found', { status: 404 });
        if (r.reason === 'not-allowed')
          return a.canvasOnly ? notInScopeResponse() : capabilityRefusal();
        return json(409, { error: r.reason });
      },
    },
  ];
}
