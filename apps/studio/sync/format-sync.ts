// The sync runtime's side of the project file format — V2-1.12 §5.4, §5.6,
// §5.7 P1 (V2-2.18).
//
//   • DECLARE: every studio → hub request carries `X-Maude-Format: <n>` and
//     every socket `maude-format=<n>`, so the hub can fence a writer of another
//     format (426 on its doors, a read-only connection on the doc lanes).
//   • LEARN: the hub's format arrives on `/health` and on the `maude.mode`
//     notice; it is mirrored raise-only into `_state/hub-format.json`
//     (`format.ts` noteHubFormat), and a change makes shells refetch
//     `/_config` so the gate and the banner engage.
//   • PAUSE: while this build does not edit the project, nothing goes up —
//     no fs → doc imports, no file-plane pushes, no proposals. Pulls continue.
//   • 426 IS NOT A CREDENTIAL FAILURE: a format refusal never renews a token.
//
// Pure helpers + the decisions; `sync/index.ts` wires them.

import {
  asFormat,
  type FormatCtx,
  type FormatGateOptions,
  formatGate,
  noteHubFormat,
  projectFormat,
  readHubFormatCache,
  STAGED_FORMAT_GATE_OPTS,
  SUPPORTED_FORMAT,
} from '../format.ts';

/**
 * The gate the studio enforces — the SAME options `http.ts` passes
 * (`FORMAT_GATE_OPTS`, staged: only a project newer than this build is
 * gated). Pinned against http.ts by test/format-sync.test.ts so the sync
 * runtime and the HTTP gate can never disagree about whether a project is
 * editable here.
 */
export const SYNC_FORMAT_GATE_OPTS: FormatGateOptions = STAGED_FORMAT_GATE_OPTS;

/** Does this build NOT edit the project right now? (Outbound is paused.) */
export function formatGated(ctx: FormatCtx): boolean {
  return formatGate(ctx, SYNC_FORMAT_GATE_OPTS) !== null;
}

/**
 * The format this studio WRITES in, for the hub's fence. While the project is
 * editable here that is the project's format (under the staged gate a v2 build
 * still writes a format-1 project as a format-1 writer); while it is gated it
 * is this build's own format, so a mismatch is exactly what the hub sees.
 */
export function declaredFormat(ctx: FormatCtx): number {
  return formatGated(ctx) ? SUPPORTED_FORMAT : projectFormat(ctx).value;
}

/** `ws(s)://host[/path]` + `maude-format=<n>` (keeps any existing query). */
export function withFormatParam(wsUrl: string, format: number | undefined): string {
  if (format === undefined) return wsUrl;
  try {
    const u = new URL(wsUrl);
    u.searchParams.set('maude-format', String(asFormat(format)));
    return u.toString();
  } catch {
    return wsUrl;
  }
}

/**
 * A fetch that declares the format on every request. The base fetch is
 * resolved at CALL time (`globalThis.fetch` when none is given), so a test
 * that swaps the global still sees every request.
 */
export function withFormatHeader(
  base: typeof fetch | undefined,
  format: () => number
): typeof fetch {
  const wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
    const fn = base ?? globalThis.fetch;
    const from =
      init?.headers ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(from);
    headers.set('x-maude-format', String(asFormat(format())));
    return fn(input, { ...init, headers });
  };
  return wrapped as typeof fetch;
}

/** A hub's answer is a FORMAT refusal (V2-1.12 §5.4) — not a credential one. */
export function isFormatRefusal(status: number, body?: unknown): boolean {
  if (status !== 426) return false;
  if (!body || typeof body !== 'object') return true;
  const b = body as { reason?: unknown; code?: unknown };
  return (
    b.reason === 'format' || b.code === 'format' || (b.reason === undefined && b.code === undefined)
  );
}

/** The project format a `/health` body or a `maude.mode` notice states, or null. */
export function formatFromHub(body: unknown): number | null {
  const v = (body as { formatVersion?: unknown } | null)?.formatVersion;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : null;
}

/**
 * Record what the hub said. Returns true when the mirrored value changed, so
 * the caller emits `config-updated` (shells refetch `/_config`, the gate and
 * banner engage within the reload — §5.14 "≤ 1 s after the notice").
 */
export function learnHubFormat(
  ctx: FormatCtx,
  seen: { formatVersion: number | null; epoch?: number }
): boolean {
  const hub = ctx.cfg.linkedHub?.url;
  if (!hub || seen.formatVersion === null) return false;
  // RAISE-ONLY, with one exception: the owner's unflip (`--reverse`) reaches
  // peers as a `maude.mode` notice carrying a NEWER epoch than the one this
  // mirror recorded — a later decision by the authority, not a stale hub.
  // `/health` carries no public epoch, so it can only ever raise.
  const cached = readHubFormatCache(ctx.paths.designRoot, hub);
  const newerDecision =
    typeof seen.epoch === 'number' && cached !== null && seen.epoch > cached.epoch;
  return noteHubFormat(
    ctx.paths.designRoot,
    {
      hub,
      formatVersion: seen.formatVersion,
      ...(typeof seen.epoch === 'number' ? { epoch: seen.epoch } : {}),
    },
    { allowLower: newerDecision }
  );
}

/**
 * §5.9 FIRST SIGHT of a flip: this Mac's mirror is absent or older than what
 * the hub now says. Evaluated BEFORE `learnHubFormat` writes the mirror. A
 * format-1 hub is never a flip (nothing to have missed).
 */
export function isFormatFirstSight(ctx: FormatCtx, hubFormat: number | null): boolean {
  const hub = ctx.cfg.linkedHub?.url;
  if (!hub || hubFormat === null || hubFormat <= 1) return false;
  const cached = readHubFormatCache(ctx.paths.designRoot, hub);
  return cached === null || cached.formatVersion < hubFormat;
}
