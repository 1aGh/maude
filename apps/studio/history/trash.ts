// The shared Trash, as the studio serves it — S1.7 (S1-trash.md, S1-canvas-row-slots §4).
//
// The Trash is DERIVED from the one op log (S1 Q2): the store lists the records
// (`store.trash()`, S1.6), this module decides what a person sees.
//   - An artboard item whose artboard is back in its canvas's source (a ⌘Z of the
//     trash action, S1.13's "Restore only <artboard>") is dropped — the store does
//     not know it came back (S1-trash.md §1).
//   - L18 (V2-1.16): a canvas-only session sees only items whose canvas it was
//     granted; a session with no role and no grant sees nothing. Restore needs
//     `trash` on that canvas; clear-out needs `delete` (owner, project-level) and
//     is refused to every canvas-only session. Hidden ≠ refused: the routes check
//     all of it on the server, `canClear` is only the hint the view draws from.
//
// Pure: no fs, no server. The home (`ctx.syncControl.current()` — the hub runtime
// for a linked project, the local home otherwise) answers through `TrashRuntime`;
// the route (routes/trash.ts) injects the source reader and the session access.

import { type Access, type AccessClaim, legacyClaim, resolveAccess } from '../access/scope.ts';
import { artboardIdsOf } from '../attribute-artboards.ts';

/* ------------------------------------------------------------------ store */

/** `store.trash().canvases[]` (S1-trash.md §1). */
export interface StoreCanvasItem {
  id: string;
  entry: string;
  doc: string;
  path: string;
  rev: number;
  actionId: string;
  actor: string;
  at: number;
}

/** `store.trash().artboards[]` (S1-trash.md §1). */
export interface StoreArtboardItem {
  id: string;
  entry: string;
  doc: string | null;
  artboard: string;
  label: string | null;
  rev: number;
  actionId: string;
  actor: string;
  at: number;
}

/** What a home answers: the store's records + where each artboard item's canvas lives now. */
export interface TrashListing {
  canvases: StoreCanvasItem[];
  artboards: StoreArtboardItem[];
  /** entry → the live canvas carrying it (only entries an artboard item names). */
  live: Record<string, { doc: string; path: string }>;
  /** S1.7b — the actor this session is (`bootstrap.you.actor`), for `mine`. */
  you?: string | null;
}

export interface TrashOutcome {
  status: 'accepted' | 'rejected';
  code?: string;
  queued?: boolean;
  actionId?: string;
  /** trash.restore: the design-root-relative path the canvas came back at. */
  path?: string;
  /** trash.clear: the item ids cleared, and those left as they were. */
  cleared?: string[];
  skipped?: Array<{ id?: string; reason: string }>;
}

/**
 * The `ctx.syncControl.current()` surface the Trash reads. Every method is
 * optional, and a `null` answer means the same: this home has no shared Trash
 * (a hub older than S1.6, a legacy-mode project) — the view then falls back to
 * the per-Mac list ("Kept on this Mac").
 */
export interface TrashRuntime {
  acceptedTrash?(): Promise<TrashListing | null>;
  acceptedTrashRestore?(entry: string): Promise<TrashOutcome | null>;
  acceptedTrashClear?(items?: string[]): Promise<TrashOutcome | null>;
}

/* ------------------------------------------------------------------ items */

/** S1.7b — who trashed it, as the row shows it ("Jonas, 14:05"): never an e-mail. */
interface ItemWho {
  /** This session trashed it. */
  mine: boolean;
  /** A display name, or null when the actor names no person (a machine, the operator). */
  who: string | null;
}

export interface CanvasItem extends StoreCanvasItem, ItemWho {
  id: `canvas:${string}`;
  kind: 'canvas';
  group: 'today' | 'earlier';
}

export interface ArtboardItem extends StoreArtboardItem, ItemWho {
  id: `artboard:${string}/${string}`;
  kind: 'artboard';
  group: 'today' | 'earlier';
  /** The canvas the artboard belonged to: where it lives now, or where it was trashed from. */
  path: string;
  /** The canvas itself is in the Trash too — restore it first. */
  canvasTrashed?: true;
}

export type TrashItem = CanvasItem | ArtboardItem;

/** The kernel's own id shapes (S1-trash.md §1; kernel.mjs `ENTRY`, `ARTBOARD_ID`). */
export const CANVAS_ID = /^canvas:([A-Za-z0-9_-]{1,128})$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
export const ARTBOARD_ID = /^artboard:([^/]{1,128})\/([^/\u0000-\u001f\u007f-\u009f]{1,128})$/u;
export const MAX_CLEAR_ITEMS = 500;

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

/**
 * An actor → the name a row shows. The log's actor is an e-mail (a hub
 * session), a token label, or `local:<machine>` (the local home); the e-mail
 * never leaves the server as a name — its local part does ("jonas.novak@…" →
 * "Jonas Novak"). Machines and the operator name no person: null.
 */
export function displayNameOf(actor: string | null | undefined): string | null {
  if (!actor || /^local:/.test(actor) || actor === 'operator' || actor === 'anon') return null;
  const at = actor.indexOf('@');
  if (at < 0) return actor.slice(0, 80);
  const words = actor
    .slice(0, at)
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(' ').slice(0, 80) : null;
}

/**
 * The store's records → what the Trash shows, newest first, Today / Earlier.
 * `readSource(path)` reads a live canvas's source (design-root-relative path);
 * null when it cannot be read — the artboard then stays listed (it is not
 * known to be back).
 */
export function deriveTrash(
  listing: TrashListing,
  o: { readSource: (path: string) => string | null; now?: number }
): TrashItem[] {
  const now = o.now ?? Date.now();
  const group = (at: number): 'today' | 'earlier' => (sameDay(at, now) ? 'today' : 'earlier');
  const you = listing.you ?? null;
  const whoOf = (actor: string): ItemWho => ({
    mine: you !== null && actor === you,
    who: displayNameOf(actor),
  });
  const out: TrashItem[] = [];
  const trashedCanvas = new Map<string, StoreCanvasItem>();
  for (const c of listing.canvases) {
    if (!CANVAS_ID.test(c.id) || !c.path) continue;
    trashedCanvas.set(c.entry, c);
    out.push({
      ...c,
      ...whoOf(c.actor),
      id: c.id as CanvasItem['id'],
      kind: 'canvas',
      group: group(c.at),
    });
  }
  const idsOf = new Map<string, Set<string> | null>();
  for (const a of listing.artboards) {
    if (!ARTBOARD_ID.test(a.id)) continue;
    const live = listing.live[a.entry];
    const base = {
      ...a,
      ...whoOf(a.actor),
      id: a.id as ArtboardItem['id'],
      kind: 'artboard' as const,
      group: group(a.at),
    };
    if (live?.path) {
      let ids = idsOf.get(live.path);
      if (ids === undefined) {
        const src = o.readSource(live.path);
        ids = src === null ? null : new Set(artboardIdsOf(src, live.path));
        idsOf.set(live.path, ids);
      }
      if (ids?.has(a.artboard)) continue; // it came back
      out.push({ ...base, path: live.path });
      continue;
    }
    const canvas = trashedCanvas.get(a.entry);
    // Neither live nor in the Trash: its canvas was cleared out — it is gone with it.
    if (canvas) out.push({ ...base, path: canvas.path, canvasTrashed: true });
  }
  return out.sort((x, y) => y.at - x.at || y.rev - x.rev);
}

/* ----------------------------------------------------------------- access */

/** L18: the items this session may see. */
export function visibleTrash(items: readonly TrashItem[], access: Access): TrashItem[] {
  if (access.role !== null) return access.can('read', null) ? [...items] : [];
  if (!access.canvasOnly) return [];
  return items.filter((i) => access.seesCanvas(i.path));
}

/** May this session clear out the Trash? Owner, project-level — never canvas-only. */
export const canClearTrash = (access: Access): boolean =>
  !access.canvasOnly && access.can('delete', null);

/** `x-maude-access` (base64url JSON AccessClaim) → the claim; null when absent or malformed. */
export function decodeAccessHeader(value: string | null | undefined): AccessClaim | null {
  if (!value || value.length > 64 * 1024) return null;
  try {
    const claim = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return claim && typeof claim === 'object' && !Array.isArray(claim) ? claim : null;
  } catch {
    return null;
  }
}

/**
 * The access a Trash request is judged with.
 *   - In a cell (workspace mode) the proxy strips every inbound `x-maude-*` and
 *     vouches the session's claim in `x-maude-access` (V2-1.7 §5.4) — the ONLY
 *     source there, and fail closed: absent or malformed holds nothing.
 *   - On a desktop the person at the keyboard is the session: a local project is
 *     its owner's (S1 Q4); a linked one carries the role the hub vouched at
 *     sign-in (`hubs.json`), and the hub re-checks every op anyway.
 * Interim until S9.9's `currentAccess()` lands; it then replaces this body.
 */
export function trashAccess(o: {
  workspace: boolean;
  header: string | null | undefined;
  /** desktop only: 'owner' for a local project, the stored hub role for a linked one */
  localRole: string | null | undefined;
}): Access {
  if (o.workspace) return resolveAccess(decodeAccessHeader(o.header));
  return resolveAccess(legacyClaim(o.localRole ?? 'member'));
}

/* -------------------------------------------------------------------- seq */

// `trash:changed { seq }` has more than one source in one studio: the routes
// (an accepted restore / clear-out here) and the sync runtime (someone else's
// delete, restore or clear-out, S1.7b). One process-wide counter, so `seq`
// only ever grows whichever of them bumped it, and a GET answers the latest.
let trashSeq = 0;

/** The current `trash:changed` seq (what `GET /_api/trash` answers). */
export const currentTrashSeq = (): number => trashSeq;

/** Bump the seq and say so on the bus. */
export function bumpTrashSeq(emit?: (event: string, payload: unknown) => void): number {
  trashSeq += 1;
  emit?.('trash:changed', { seq: trashSeq });
  return trashSeq;
}

/* ---------------------------------------------------------------- answers */

/** A rejected home answer → the route's HTTP answer (S1-canvas-row-slots §4). */
export function refusalOf(code: string | undefined): { status: number; reason: string } {
  switch (code) {
    case 'cleared':
      return { status: 409, reason: 'cleared' };
    case 'path-conflict':
      return { status: 409, reason: 'taken' };
    case 'dependency-missing':
      return { status: 409, reason: 'not-in-trash' };
    case 'forbidden':
      return { status: 403, reason: 'forbidden' };
    case 'not-in-scope':
      return { status: 403, reason: 'not-in-scope' };
    // An older hub: `unsupported operation …` (S1-trash.md §3) — the ids were
    // validated here, so `invalid` can only mean the op is unknown.
    case 'invalid':
      return { status: 409, reason: 'needs-hub-update' };
    case 'store-locked':
    case 'retryable':
    case 'unreachable':
      return { status: 503, reason: code };
    default:
      return { status: 409, reason: code ?? 'refused' };
  }
}

export const NEEDS_HUB_UPDATE_LINE = 'The Trash needs the team server to be updated';
export const ARTBOARD_NOT_YET_LINE = 'Restoring one artboard comes with Version history';

/** `trash.clear { items }`: absent, or 1–500 distinct well-formed ids. */
export function parseClearItems(
  body: unknown
): { ok: true; items?: string[] } | { ok: false; reason: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, reason: 'body must be an object' };
  const raw = (body as { items?: unknown }).items;
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CLEAR_ITEMS)
    return { ok: false, reason: `items: 1–${MAX_CLEAR_ITEMS} ids` };
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || !(CANVAS_ID.test(id) || ARTBOARD_ID.test(id)))
      return { ok: false, reason: 'items: not a trash item id' };
    if (seen.has(id)) return { ok: false, reason: 'items: an id is named twice' };
    seen.add(id);
  }
  return { ok: true, items: [...seen] };
}
