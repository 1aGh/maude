// S9.21b — the hub's access notices, heard on a canvas doc socket and relayed to the shell
// (V2-1.7 §5.6; hub side apps/hub/src/routes-v2/notices.mjs).
//
//   { type: 'maude.access', epoch, change: 'raised' | 'narrowed' | 'ended', reason?, by?, role? }
//   { type: 'maude.access-request', id, from: { name }, canvas?, at }
//
// Every canvas doc socket of this project receives its own copy, so the same notice arrives once
// per open doc: `createAccessRelay` passes each one on ONCE (by epoch for an access change, by id
// for a request). What is passed on is rebuilt key by key from a fixed vocabulary — a reason the
// relay does not know is dropped, a name loses control / bidi characters and is capped, a canvas is
// a designRoot-relative path or nothing — so no free text a hub (or a planted peer) sends rides
// through. The relay goes to the shell's inspector socket only (ws.ts `broadcast`), never to the
// canvas iframe's socket.

export const ACCESS_CHANGES = ['raised', 'narrowed', 'ended'] as const;
export const ACCESS_REASONS = ['removed', 'link-off', 'expired'] as const;
export const MAX_NOTICE_NAME = 80;
/** The wire roles a narrowing may name (hub notices.mjs NOTICE_ROLES). */
export const NOTICE_ROLES = ['owner', 'member', 'viewer', 'observer'] as const;
/** How many seen keys are remembered (a long session hears a few per day). */
const SEEN_CAP = 256;

export type AccessFrame =
  | {
      type: 'maude.access';
      epoch: number;
      change: (typeof ACCESS_CHANGES)[number];
      reason?: (typeof ACCESS_REASONS)[number];
      /** P8 G1a — a narrowing only: who did it (a clean name) and the wire role now. */
      by?: { name: string };
      role?: (typeof NOTICE_ROLES)[number];
    }
  | {
      type: 'maude.access-request';
      id: string;
      from: { name: string };
      canvas?: string;
      at: number;
    };

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** C0 / C1 controls, zero-width, line / paragraph separators, bidi embeddings + isolates, BOM. */
const CONTROL_SRC =
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]';
const CONTROL_RE = new RegExp(CONTROL_SRC, 'g');
const CONTROL_ONE = new RegExp(CONTROL_SRC);

/** A requester's name as an owner reads it: one short line of text, nothing else. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTICE_NAME);
}

/** A designRoot-relative canvas path, or null (the same rule the hub keys a grant by). */
function cleanCanvas(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return null;
  if (v.startsWith('/') || v.includes('\\') || CONTROL_ONE.test(v)) return null;
  if (!/\.(tsx|jsx|html)$/i.test(v)) return null;
  return v.split('/').every((s) => s !== '' && s !== '.' && s !== '..') ? v : null;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** A stateless payload → the frame the shell may hear, or null (not an access notice, or junk). */
export function parseAccessNotice(payload: string): AccessFrame | null {
  let msg: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(payload);
    msg = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
  if (!msg) return null;
  if (msg.type === 'maude.access') {
    const epoch = finite(msg.epoch);
    const change = ACCESS_CHANGES.find((c) => c === msg?.change);
    if (epoch === null || !change) return null;
    const reason = ACCESS_REASONS.find((r) => r === msg?.reason);
    const narrowed = change === 'narrowed';
    const byRaw = msg.by && typeof msg.by === 'object' ? (msg.by as { name?: unknown }).name : null;
    const by = narrowed ? cleanName(byRaw) : '';
    const role = narrowed ? NOTICE_ROLES.find((r) => r === msg?.role) : undefined;
    return {
      type: 'maude.access',
      epoch,
      change,
      ...(reason ? { reason } : {}),
      ...(by ? { by: { name: by } } : {}),
      ...(role ? { role } : {}),
    };
  }
  if (msg.type === 'maude.access-request') {
    if (typeof msg.id !== 'string' || !ID_RE.test(msg.id)) return null;
    const from = msg.from && typeof msg.from === 'object' ? (msg.from as { name?: unknown }) : {};
    const canvas = cleanCanvas(msg.canvas);
    return {
      type: 'maude.access-request',
      id: msg.id,
      from: { name: cleanName(from.name) },
      ...(canvas ? { canvas } : {}),
      at: finite(msg.at) ?? 0,
    };
  }
  return null;
}

/** The dedupe key of a frame: one notice, however many doc sockets carried it. */
export function noticeKey(f: AccessFrame): string {
  return f.type === 'maude.access' ? `a:${f.epoch}:${f.change}` : `r:${f.id}`;
}

/**
 * Hear a payload from any doc socket; `onFrame` runs once per distinct notice. `raised` is told to
 * `onRaised` first (the caller re-exchanges the credential), then the shell hears it.
 */
export function createAccessRelay(deps: {
  onFrame: (frame: AccessFrame) => void;
  onRaised?: () => Promise<unknown> | unknown;
}) {
  const seen: string[] = [];
  const has = new Set<string>();
  return function hear(payload: string): AccessFrame | null {
    const frame = parseAccessNotice(payload);
    if (!frame) return null;
    const key = noticeKey(frame);
    if (has.has(key)) return null;
    has.add(key);
    seen.push(key);
    if (seen.length > SEEN_CAP) has.delete(seen.shift() as string);
    if (frame.type === 'maude.access' && frame.change === 'raised' && deps.onRaised) {
      // The shell re-reads its access once the credential is fresh; a renewal that fails still
      // tells the shell (it re-reads what it can), never swallows the notice.
      Promise.resolve()
        .then(() => deps.onRaised?.())
        .catch(() => null)
        .finally(() => deps.onFrame(frame));
      return frame;
    }
    deps.onFrame(frame);
    return frame;
  };
}
