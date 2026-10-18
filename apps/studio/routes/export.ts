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

import { ACP_REFUSAL, notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { estimateSpec } from '../exporters/estimate.ts';
import { isFormat } from '../exporters/index.ts';
import type { ExportHistoryEntry } from '../exporters/jobs.ts';
import {
  resolveSpecV2,
  type SkipReason,
  type SpecCanvas,
  type SpecUnit,
} from '../exporters/scope.ts';
import type { GroupPlan } from '../exporters/spec-run.ts';
import { type ExportSpecV2, PROJECT_CLASS_SCOPES, validateSpecV2 } from '../exporters/spec-v2.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 64 * 1024;
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
  /** THIS request's session (access/request.ts `currentAccess`) */
  access(req?: Request): Access;
  /** this session's finished exports (throughput history) */
  history(): readonly ExportHistoryEntry[];
  /** where `lane: 'auto'` renders (workspace-mode.ts `resolveRenderLane`) */
  renderLane(): 'local' | 'remote' | 'none';
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

/** What the v2 export doors cannot run yet: refused with the field, never silently dropped. */
function notYet(spec: ExportSpecV2, units: SpecUnit[]): Response | null {
  const no = (field: string, message: string) =>
    json(400, { error: 'not-available', field, message });
  if (spec.at) return no('at', 'Exporting a past version is not available yet.');
  if (spec.wait) return no('wait', 'Waiting for the AI is not available yet.');
  if (spec.options?.colorProfile === 'display-p3')
    return no('options.colorProfile', 'Display P3 is not available yet.');
  const missing = units.find((u) => !isFormat(u.format));
  if (missing) return no('format', `${missing.format.toUpperCase()} export is not available yet.`);
  return null;
}

/**
 * The v2 half of `/_api/export` + `/_api/export-jobs`: a refusal, or the group plan the job
 * queue runs (`EnqueueArgs.group`). `first` names the first unit's format + scope, which the
 * queue's lane and timeout read.
 */
export function planExportV2(
  raw: unknown,
  deps: ExportRouteDeps,
  req?: Request,
  now: Date = new Date()
): { ok: false; response: Response } | { ok: true; group: GroupPlan; first: SpecUnit } {
  const g = gateSpecV2(raw, deps, req);
  if (!g.ok) return g;
  const refused = notYet(g.spec, g.units);
  if (refused) return { ok: false, response: refused };
  const first = g.units[0];
  if (!first)
    return { ok: false, response: json(422, { error: 'nothing-to-export', skipped: g.skipped }) };
  return {
    ok: true,
    first,
    group: { spec: g.spec, units: g.units, project: deps.projectName(), date: now },
  };
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
          })
        );
      },
    },
  ];
}
