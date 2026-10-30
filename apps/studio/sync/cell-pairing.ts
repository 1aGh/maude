// Desktop ↔ cloud live pairing, variant C2 — the ONE exception to "a cell does
// not sync" (DDR-209 / Cloud Phase 27 D2).
//
// THE PROBLEM THIS OPENS A DOOR FOR. A cell holds two disjoint Y.Doc worlds: the
// hub's Hocuspocus documents (which the DESKTOP syncs to, SQLite-backed) and the
// studio child's own collab rooms (which BROWSERS join, in-memory). Nothing
// crosses. Two people on the same project — one in the app, one in a tab — never
// see each other's cursors and never see each other's edits, which is the
// headline of the cloud product.
//
// WHY THE DOOR IS SHAPED LIKE THIS. DDR-209 forbids the studio child from
// syncing out, for two named reasons, and BOTH are preserved literally here
// rather than argued away:
//
//   1. "dial OUT from the cell to a third-party hub carrying the project's
//      canvases" — so the URL must be LOOPBACK. Not "usually loopback", not
//      "loopback in production": the resolver refuses anything else, and the
//      tenant's own `.design/config.json linkedHub.url` is never read for it.
//      A cell talking to 127.0.0.1 is a process talking to itself.
//   2. "start a SECOND autocommit over the working tree the hub is already
//      committing" — so autocommit must be explicitly DISABLED, by a flag the
//      caller has to set on purpose. Default-absent means refuse.
//
// A third condition is ours, not DDR-209's, and it narrows further: shared-doc
// must be ON. Without it the loopback provider would open a SECOND Y.Doc per
// canvas beside the room's — the two-doc world this pairing exists to collapse —
// and its agent would become a second doc→file writer for no benefit at all.
//
// WHAT IS TAKEN FROM THE TENANT'S CONFIG, AND WHY IT MUST BE. The URL and the
// credential come from the environment (the hub minted them for its own child).
// The WORKSPACE ID does not: it comes from `linkedHub.workspaceId`, the tenant's
// own file, because it decides the DOCUMENT NAME on the wire (DDR-192 §5). The
// desktop resolves it from that same field. If the cell derived a different one,
// the browser and the desktop would sync to two differently-named documents and
// converge on nothing — this whole feature, silently doing exactly what it did
// before. Honouring the tenant's `url` is a dial-out; honouring their
// `workspaceId` is the only way the two ends can meet.

import { isLoopbackHost } from './loopback.ts';

/** Everything the runtime needs to open the loopback provider. */
export interface CellPairing {
  /** Always a loopback http(s) URL — asserted, never assumed. */
  url: string;
  /** The hub-minted, cell-derived credential. Never a user's own token. */
  token: string;
}

/** Why pairing is off, when the operator asked for it and it did not engage. */
export type CellPairingRefusal =
  | 'not-workspace-mode'
  | 'not-requested'
  | 'no-url'
  | 'not-loopback'
  | 'no-token'
  | 'autocommit-enabled';

export interface CellPairingVerdict {
  pairing: CellPairing | null;
  /** Present whenever `pairing` is null. */
  refusal?: CellPairingRefusal;
  /** One sentence for the log — populated only when the operator ASKED for
   *  pairing and we refused, so a silent misconfiguration is impossible. */
  detail?: string;
}

/** Env truthiness for the opt-in interlocks below (explicit `1`-style value). */
function on(value: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test(value ?? '');
}

/**
 * The single-shared-doc model (DDR-064) is the only one since p8-v1-drop: `MAUDE_SHARED_DOC=0`, the
 * opt-out back onto the two-doc + disk-reconcile path, is gone. The env value is ignored.
 */
export function sharedDocEnabled(_env: Record<string, string | undefined> = process.env): true {
  return true;
}

/**
 * Strip control characters and cap length before a value reaches a log line.
 *
 * Every refusal `detail` this module builds interpolates `MAUDE_LOOPBACK_SYNC_URL`
 * verbatim, and today that env var is hub-set only — no tenant-reachable input
 * writes it. But this feature's entire threat model rests on "the URL is
 * provably loopback," so the log line proving that should not be the one place
 * that still trusts the string unsanitized. Mirrors the codebase's own
 * precedent (`sanitizeForLog` in `apps/hub/src/server.mjs`) rather than
 * inventing a second scrub shape.
 */
export function sanitizeForLog(value: string): string {
  let out = '';
  const s = value.slice(0, 256);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? '·' : s[i];
  }
  return out;
}

/**
 * Resolve the cell pairing from the environment, or explain the refusal.
 *
 * Every condition is a hard gate. There is no "warn and continue" branch on
 * purpose: the failure mode of a partial pairing (a provider that dials out, or
 * a second committer) is worse than no pairing at all, and no pairing is exactly
 * what shipped before this feature.
 */
export function resolveCellPairing(
  env: Record<string, string | undefined> = process.env
): CellPairingVerdict {
  if (env.MAUDE_WORKSPACE_MODE !== '1') {
    return { pairing: null, refusal: 'not-workspace-mode' };
  }
  if (!on(env.MAUDE_CELL_PAIRING)) {
    return { pairing: null, refusal: 'not-requested' };
  }

  // From here on the operator ASKED for pairing, so every refusal gets a
  // sentence — a cell that quietly declines is the bug this feature is fixing.
  const url = (env.MAUDE_LOOPBACK_SYNC_URL ?? '').trim();
  if (!url) {
    return {
      pairing: null,
      refusal: 'no-url',
      detail: 'MAUDE_CELL_PAIRING is set but MAUDE_LOOPBACK_SYNC_URL is empty.',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      pairing: null,
      refusal: 'not-loopback',
      detail: `MAUDE_LOOPBACK_SYNC_URL is not a URL: ${sanitizeForLog(url)}`,
    };
  }
  if (!isLoopbackHost(parsed.hostname)) {
    return {
      pairing: null,
      refusal: 'not-loopback',
      detail:
        `refusing MAUDE_LOOPBACK_SYNC_URL ${sanitizeForLog(url)} — a cell syncs to ITSELF or to nothing. ` +
        'Only 127.0.0.1 / localhost / ::1 are accepted (DDR-209: no dial-out).',
    };
  }

  const token = (env.MAUDE_LOOPBACK_SYNC_TOKEN ?? '').trim();
  if (!token) {
    return {
      pairing: null,
      refusal: 'no-token',
      detail: 'MAUDE_CELL_PAIRING is set but MAUDE_LOOPBACK_SYNC_TOKEN is empty.',
    };
  }

  if (!on(env.MAUDE_SYNC_NO_AUTOCOMMIT)) {
    return {
      pairing: null,
      refusal: 'autocommit-enabled',
      detail:
        'refusing to pair without MAUDE_SYNC_NO_AUTOCOMMIT=1 — the hub is the sole committer ' +
        'in a cell, and a second autocommit over the same working tree is the exact ' +
        'duplication DDR-209 exists to prevent.',
    };
  }

  return { pairing: { url, token } };
}
