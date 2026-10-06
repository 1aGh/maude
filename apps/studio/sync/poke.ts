// The poke frame's vocabulary, receiver side — Sync v2 Increment 2
// (DDR-226 §4).
//
// A DELIBERATE TWIN of `apps/hub/src/files-ctl.mjs`'s `parsePoke`, for the same
// reason `file-membership.ts` has a `.mjs` mirror: the hub image installs from
// its own frozen lockfile and cannot import out of `apps/studio`, so the two
// ends of a wire format live in two files. DDR-198's rule applies — a twin is
// allowed only with a drift test that imports BOTH and asserts they agree. That
// test is `apps/studio/test/sync-poke-parity.test.ts`; if you change the shape
// here, change it there, and the test is what makes forgetting a red build.
//
// WHY THE FRAME IS THIS SMALL. Everything on this channel arrives from the hub,
// which is untrusted to peers (DDR-054). A frame that carried a path would be a
// path the hub chose; a frame that carried a hash would be a hash the hub chose.
// So it carries neither. `head` is a HINT that something moved — the receiver
// then asks through an authenticated, scope-filtered route and believes the
// answer, not the doorbell.

/** Max frame size. A doorbell has no reason to be long. */
const MAX_POKE_BYTES = 512;

export interface Poke {
  /** The hub's journal head at emit time. A hint, never an authority. */
  head: number;
  /** Only document membership changed; do not scan or transfer the file plane. */
  documents?: true;
}

/**
 * Parse a control frame. Returns null for anything that is not exactly
 * `{ t: 'files', head: <non-negative integer> }`.
 *
 * Extra properties are DROPPED rather than refused: a future hub adding a field
 * must not silence the channel for an older peer (the additive-field rule the
 * documents listing already follows). What is never accepted is a missing or
 * malformed `head`, because that is the one value the receiver acts on.
 */
export function parsePoke(payload: unknown): Poke | null {
  if (typeof payload !== 'string' || payload.length > MAX_POKE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const frame = parsed as { t?: unknown; head?: unknown; documents?: unknown };
  if (frame.t !== 'files') return null;
  const head = frame.head;
  if (typeof head !== 'number' || !Number.isInteger(head) || head < 0) return null;
  return frame.documents === true ? { head, documents: true } : { head };
}

/**
 * The hub's keep-alive frame (`files-ctl.mjs` `CTL_KEEPALIVE_FRAME`). It exists
 * only so an idle socket is not silent; the receiver ignores it — it is neither
 * a poke nor a malformed frame. Exact match: anything longer or different is
 * still judged by `parsePoke`.
 */
export const CTL_KEEPALIVE_FRAME = '{"t":"ka"}';

export function isKeepalive(payload: unknown): boolean {
  return payload === CTL_KEEPALIVE_FRAME;
}
