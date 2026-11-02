// Project-format routes — V2-1.12 §5.6 / §5.9. A handler TABLE the lead
// registers in the V2-2.5 route table; http.ts is not edited by lanes.
//
// `POST /_api/project/migrate` is how the app's "Update project" runs
// `maude migrate v2` in-process. MAIN ORIGIN ONLY and privileged: never in
// `CANVAS_SAFE_API`, never in the `startCanvasServer` routes map (a canvas
// that could call it could rewrite every file of the project). It is the ONE
// write the format gate allows (`format.ts` FORMAT_GATE_EXTRA_WRITES) — it is
// the way out of the gate — and it is still refused for a role-read-only
// session (a viewer cannot update a project).

import { cloudUrl } from '../cloud/endpoints.ts';
import { scrub } from '../debug-bundle.ts';
import { type AutoConvertPolicy, autoConvertPolicy } from '../format.ts';
import {
  applyMigration,
  capReport,
  EXIT,
  type MigrateOptions,
  planMigration,
} from '../migrate/engine.ts';
import { resolveMaudeVersion } from '../whats-new.ts';
import { isWorkspaceMode } from '../workspace-mode.ts';
import type { RouteSpec } from './table.ts';

export interface ProjectFormatDeps {
  repoRoot: string;
  designRel: string;
  /** the linked hub's credential + role (hubs-config), null when unlinked */
  hub: () => MigrateOptions['hub'];
  /** gate-b-sec4 — the committed link this Mac parked at boot (`ctx.unconfirmedHub?.url`), else null */
  parkedHub?: () => string | null;
  /** the format view `/_config` also serves (format.ts formatConfigFields) */
  formatView: (req: Request) => unknown;
  /** after an apply: reload config + emit `config-updated` so shells refetch */
  onMigrated?: () => void;
  /**
   * p8-v1-drop — may the shell convert this project UNASKED (format.ts `autoConvertPolicy`)? Default:
   * this build's version, workspace mode and the linked hub against the configured cloud address. A
   * Maude Cloud project during the rc answers `{allowed:false}`: the shell converts nothing by itself,
   * and an apply needs `confirmCloud: true` (the warning dialog's own button).
   */
  autoConvert?: (linkedHub: string | null) => AutoConvertPolicy;
  /** seams for tests */
  engine?: Partial<Pick<MigrateOptions, 'hubClient' | 'dsEmitter' | 'now' | 'liveStudio'>>;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The engine's exit code → an HTTP status. 10 (already there) is a 200. */
export function statusForExit(code: number): number {
  if (code === EXIT.done || code === EXIT.atTarget) return 200;
  if (code === EXIT.refused) return 409;
  return 500;
}

export function defaultAutoConvert(linkedHub: string | null): AutoConvertPolicy {
  return autoConvertPolicy({
    version: resolveMaudeVersion(),
    workspaceMode: isWorkspaceMode(),
    hubUrl: linkedHub,
    cloudUrl: cloudUrl(),
  });
}

export function createProjectFormatRoutes(deps: ProjectFormatDeps): RouteSpec[] {
  const policyOf = deps.autoConvert ?? defaultAutoConvert;
  return [
    {
      method: 'GET',
      path: '/_api/project/format',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => json(200, deps.formatView(req)),
    },
    {
      method: 'POST',
      path: '/_api/project/migrate',
      origin: 'main',
      // The format gate lets this through (it is the way out); the ROLE gate
      // does not — `readOnly: 'refused'` keeps viewers out.
      readOnly: 'refused',
      async handle(req) {
        let body: {
          direction?: unknown;
          apply?: unknown;
          strip?: unknown;
          confirmCloud?: unknown;
        };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return json(400, { error: 'body must be JSON' });
        }
        const direction =
          body.direction === 'reverse'
            ? 'reverse'
            : body.direction === 'forward' || body.direction === undefined
              ? 'forward'
              : null;
        if (!direction) return json(400, { error: 'direction is forward or reverse' });
        if (body.strip === true && direction !== 'reverse')
          return json(400, { error: 'strip only goes with reverse' });
        // Writing is a person's act in the Maude window: only a browser sends Sec-Fetch-Site, and
        // the auto-approved loopback helper (`maude design curl-local`) refuses to forge it. A
        // dry run stays open to every local client (security review, Phase 1 gate — M3).
        if (body.apply === true && req.headers.get('sec-fetch-site') !== 'same-origin')
          return json(403, { error: 'apply runs from the Maude window (Update project)' });
        const opts: MigrateOptions = {
          repoRoot: deps.repoRoot,
          designRel: deps.designRel,
          direction,
          strip: body.strip === true,
          hub: deps.hub(),
          parkedHub: deps.parkedHub?.() ?? null,
          viaStudio: true,
          ...deps.engine,
        };
        try {
          const dry = await planMigration(opts);
          const autoConvert = policyOf(dry.project.linked?.hub ?? null);
          // A Maude Cloud project during the rc converts only when the owner said so, past the
          // warning (p8-v1-drop): the shell's automatic apply never sends `confirmCloud`.
          if (
            body.apply === true &&
            direction === 'forward' &&
            !autoConvert.allowed &&
            body.confirmCloud !== true
          )
            return json(409, { ...capReport(dry), autoConvert, error: 'confirm-cloud' });
          const report =
            body.apply === true && dry.exitCode === EXIT.done
              ? await applyMigration(opts, dry)
              : dry;
          if (!report.dryRun && report.exitCode === EXIT.done) deps.onMigrated?.();
          return json(statusForExit(report.exitCode), { ...capReport(report), autoConvert });
        } catch (err) {
          // The detail (paths, engine internals) goes to the server log, scrubbed — never the reply.
          console.error(
            `[migrate] ${scrub(String((err as Error)?.stack ?? err), { repoRoot: deps.repoRoot })}`
          );
          return json(500, { error: 'migration failed' });
        }
      },
    },
  ];
}
