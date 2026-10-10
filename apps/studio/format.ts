// Project format version — the studio side of V2-1.12 (Gate 0 A17), §5.2/§5.6.
//
// One integer per project. `.design/config.json` `formatVersion` (absent = 1)
// for local, git and Syncthing projects; for a hub-linked project the hub's
// store is the authority and this Mac mirrors it raise-only in
// `_state/hub-format.json`. A build EDITS a project only when the project's
// format equals the format it supports; any other format opens view only.
//
//   projectFormat = max(config.formatVersion ?? 1, linked ? (hubLive ?? hubCached ?? 1) : 1)
//
// This module is pure policy + the one cache file. The lead wires it:
//   http.ts  projectReadOnly(req) ||= formatGate(ctx) !== null; the refusal;
//            /_config + formatVersion / formatGate / readOnlyReason
//   context.ts DevServerConfig.formatVersion?: number
//   sync/index.ts  noteHubFormat() from /health + the `maude.mode` notice (H1–H5)
// (see the V2-2.14 hand-back for the exact patch).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The format THIS build edits. The v2 branch is 2. The 1.x compatibility
 * release (V2-2.18) cuts this module with 1 — the one-line difference between
 * the two builds' gates.
 */
export const SUPPORTED_FORMAT = 2;

/** The highest format any build knows of (the hub's 422 `max`). */
export const MAX_KNOWN_FORMAT = 2;

/**
 * In a cloud cell the studio is the hub's own child: the hub writes the mirror
 * itself under this key (V2-1.12 §5.2 — "studio child reads its paired hub"),
 * whether or not the child also runs a paired sync link.
 */
export const CELL_SELF_HUB = 'cell:self';

/** Which hub's mirror applies to this studio: its own cell hub, the linked hub, or none. */
export function formatHubUrl(
  ctx: FormatCtx,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.MAUDE_WORKSPACE_MODE === '1') return CELL_SELF_HUB;
  return ctx.cfg.linkedHub?.url ?? null;
}

/** Design-root-relative cache of the linked hub's format (runtime, DDR-115). */
export const HUB_FORMAT_REL = path.join('_state', 'hub-format.json');

export interface FormatCtx {
  cfg: { formatVersion?: unknown; linkedHub?: { url: string } | null };
  paths: { designRoot: string };
}

export interface FormatGate {
  projectFormat: number;
  supported: number;
  source: 'config' | 'hub';
}

/** A config value → a format: a positive integer, else 1 (absent = 1). */
export function asFormat(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

export interface HubFormatCache {
  hub: string;
  formatVersion: number;
  epoch: number;
  seenAt: string;
}

const normHub = (u: string) => u.replace(/\/+$/, '');

/** The cached hub format for THIS link, or null (absent, unreadable, or a
 *  cache left by another hub — a relink starts from nothing). */
export function readHubFormatCache(designRoot: string, hubUrl: string): HubFormatCache | null {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(designRoot, HUB_FORMAT_REL), 'utf8')
    ) as Partial<HubFormatCache>;
    if (typeof raw?.hub !== 'string' || normHub(raw.hub) !== normHub(hubUrl)) return null;
    return {
      hub: raw.hub,
      formatVersion: asFormat(raw.formatVersion),
      epoch: typeof raw.epoch === 'number' ? raw.epoch : 0,
      seenAt: typeof raw.seenAt === 'string' ? raw.seenAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Record what the hub said (from `/health` or the `maude.mode` notice).
 * RAISE-ONLY per hub (§5.2): a hub can raise the mirrored value, never lower
 * it — only the owner's `maude migrate v2 --reverse` lowers both, and it does
 * that by unflipping the hub (epoch + 1) and calling this with `allowLower`.
 * Returns true when the cached value changed (the caller emits
 * `config-updated` so shells refetch `/_config`).
 */
export function noteHubFormat(
  designRoot: string,
  seen: { hub: string; formatVersion: number; epoch?: number },
  opts: { now?: () => Date; allowLower?: boolean } = {}
): boolean {
  const cur = readHubFormatCache(designRoot, seen.hub);
  const next = asFormat(seen.formatVersion);
  if (cur && !opts.allowLower && next <= cur.formatVersion) return false;
  if (cur && cur.formatVersion === next) return false;
  const file = path.join(designRoot, HUB_FORMAT_REL);
  mkdirSync(path.dirname(file), { recursive: true });
  const rec: HubFormatCache = {
    hub: normHub(seen.hub),
    formatVersion: next,
    epoch: seen.epoch ?? cur?.epoch ?? 0,
    seenAt: (opts.now?.() ?? new Date()).toISOString(),
  };
  writeFileSync(`${file}.tmp`, `${JSON.stringify(rec)}\n`);
  renameSync(`${file}.tmp`, file);
  return true;
}

/** The project's format, and which authority set it. */
export function projectFormat(
  ctx: FormatCtx,
  live: { hubFormat?: number | null } = {}
): { value: number; source: 'config' | 'hub' } {
  const fromConfig = asFormat(ctx.cfg.formatVersion);
  const hub = formatHubUrl(ctx);
  if (!hub) return { value: fromConfig, source: 'config' };
  const hubValue =
    typeof live.hubFormat === 'number'
      ? asFormat(live.hubFormat)
      : (readHubFormatCache(ctx.paths.designRoot, hub)?.formatVersion ?? 1);
  return hubValue > fromConfig
    ? { value: hubValue, source: 'hub' }
    : { value: fromConfig, source: 'config' };
}

/** Null when this build may edit the project; else why not. */
export interface FormatGateOptions {
  supported?: number;
  hubFormat?: number | null;
  /**
   * Gate only projects NEWER than this build (the 1.x direction), and leave
   * older ones editable. The contract's full behaviour (§4.1: v2 opens a
   * format-1 project view only until it is updated) is `false`; `true` is the
   * staged wiring for the branch until the "Update project" dialog and
   * format-2 test sandboxes exist — measured: the full gate turns every
   * existing project and test sandbox view-only (V2-2.14 hand-back).
   */
  newerOnly?: boolean;
}

export function formatGate(ctx: FormatCtx, opts: FormatGateOptions = {}): FormatGate | null {
  const supported = opts.supported ?? SUPPORTED_FORMAT;
  const p = projectFormat(ctx, { hubFormat: opts.hubFormat });
  if (p.value === supported) return null;
  if (opts.newerOnly && p.value < supported) return null;
  return { projectFormat: p.value, supported, source: p.source };
}

/** CONTRACT §4 voice; "Update Maude to edit" is the signed A17 wording (§5.8). */
export const FORMAT_COPY = {
  /** A newer project in an older build — the 1.x refusal text. */
  newerRefusal: 'This project now uses Maude 2. Update Maude to edit it.',
  newerBanner: "This project now uses Maude 2. It's open here to look at — nothing in it is lost.",
  newerBannerAction: 'Update Maude to edit',
  newerBannerNoBuild:
    "This project now uses Maude 2, which isn't out yet. It stays open here to look at.",
  newerCloudTab: "This project now uses Maude 2. It's open here to look at.",
  newerCanvas: 'This canvas uses Maude 2. Update Maude to see it.',
  /** An older project in v2 — view only until it is updated. */
  olderStatus: 'View only — this project still uses Maude 1.',
  olderStatusAction: 'Update project',
  olderNonOwner: "View only — the owner hasn't updated this project for Maude 2 yet.",
  olderHubTooOld:
    'View only — the team server needs an update before this project can move to Maude 2.',
  olderOwnerOffline:
    'View only — updating the project needs the team server, and this Mac is offline.',
  dialogTitle: (projectName: string) => `Update "${projectName}" for Maude 2?`,
  dialogBody:
    "People still on Maude 1 can look at it but can't change it until they update. Nothing in the project is lost.",
  dialogAction: 'Update project',
  toastUpdated: 'Updated for Maude 2. People on Maude 1 can look but not edit.',
} as const;

/** The line a refusal carries, by direction. */
export function gateMessage(gate: FormatGate): string {
  return gate.projectFormat > gate.supported ? FORMAT_COPY.newerRefusal : FORMAT_COPY.olderStatus;
}

/** §5.6 — the studio's 403 for a write while gated (NOT 426: that is the
 *  hub's door; a studio refusal must read like the read-only one, plus why). */
export function formatRefusalResponse(gate: FormatGate): Response {
  return Response.json(
    {
      error: 'read-only',
      reason: 'read-only',
      detail: 'format',
      formatVersion: gate.projectFormat,
      message: gateMessage(gate),
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * The format-gate allowlist (§5.6): what a read-only session may write
 * (per-user runtime, export/download, reports, link/sign-in/sign-out) MINUS
 * comments (§9 Q3 — v2 anchors may grow and 1.x re-clamps them: look only),
 * PLUS the one route that leaves the gate: `POST /_api/project/migrate`.
 */
export const FORMAT_GATE_REFUSED_WRITES: ReadonlySet<string> = new Set(['/_comments']);
export const FORMAT_GATE_REFUSED_PATTERNS: readonly RegExp[] = [
  /^\/_api\/comments\/[A-Za-z0-9_-]+\/reply$/,
];
export const FORMAT_GATE_EXTRA_WRITES: ReadonlySet<string> = new Set(['/_api/project/migrate']);

export function formatGateAllowsWrite(
  pathname: string,
  readOnlyAllowed: { exact: ReadonlySet<string>; patterns: readonly RegExp[] }
): boolean {
  if (FORMAT_GATE_EXTRA_WRITES.has(pathname)) return true;
  if (FORMAT_GATE_REFUSED_WRITES.has(pathname)) return false;
  if (FORMAT_GATE_REFUSED_PATTERNS.some((re) => re.test(pathname))) return false;
  return (
    readOnlyAllowed.exact.has(pathname) || readOnlyAllowed.patterns.some((re) => re.test(pathname))
  );
}

/**
 * The gate options the studio runs with today — STAGED (V2-2.14): only a
 * project NEWER than this build is gated. `http.ts` `FORMAT_GATE_OPTS` and the
 * sync runtime must agree (test/format-sync.test.ts pins it).
 */
export const STAGED_FORMAT_GATE_OPTS: FormatGateOptions = { newerOnly: true };

/**
 * A canvas build that failed because the canvas imports a `@maude/canvas-lib`
 * export this build does not have — the shape of "this canvas uses a Maude 2
 * feature" (V2-1.12 §5.3: v2 canvas-lib exports; 1.x maps it to a line).
 */
export function isMissingCanvasLibExport(message: string): boolean {
  return /No matching export in "[^"]*canvas-lib[^"]*" for import/.test(message);
}

/**
 * §5.8 — the line a gated project's canvas build error leads with when the
 * canvas needs a newer canvas-lib; null otherwise (the raw error stands alone).
 */
export function canvasFormatLine(message: string, gate: FormatGate | null): string | null {
  if (!gate || gate.projectFormat <= gate.supported) return null;
  return isMissingCanvasLibExport(message) ? FORMAT_COPY.newerCanvas : null;
}

/** The `/_config` additions (§5.6). `roleReadOnly` = the existing role gate. */
export function formatConfigFields(
  ctx: FormatCtx,
  roleReadOnly: boolean,
  opts: FormatGateOptions = {}
): {
  formatVersion: number;
  formatGate: FormatGate | null;
  readOnly: boolean;
  readOnlyReason: 'role' | 'format' | null;
} {
  const gate = formatGate(ctx, opts);
  return {
    formatVersion: projectFormat(ctx, { hubFormat: opts.hubFormat }).value,
    formatGate: gate,
    readOnly: roleReadOnly || gate !== null,
    // The role is the stronger statement (it survives an update), so it names
    // the reason when both hold.
    readOnlyReason: roleReadOnly ? 'role' : gate ? 'format' : null,
  };
}
