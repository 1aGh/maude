// What a refusal MEANS — shared by every sync lane that talks to a hub.
//
// This module exists because the lesson had to be learned twice. The
// 2026-08-11 RCA (alligators, 182 assets, ~5 moved per boot) taught the asset
// push lane that a 429 is not a failure but an instruction: the hub says when
// to come back, so come back then, and keep enough of the body to tell "rate
// limit exceeded" from a Cloudflare error page. All of it lived as private
// constants inside `asset-push.ts`.
//
// So when the journal file plane (DDR-226) became the ONE lane for project
// files, it inherited none of it — `HTTP ${res.status}` and nothing else. A
// 429 read as an ordinary error, the pass fired its remaining requests into a
// closed door, and because the cursor only advances on a clean pass the very
// next tick re-requested the identical set. The retries were what kept the
// bucket empty. Issue #109: every asset of a linked project refused, forever,
// while the status bar said `synced` and a person saw broken images.
//
// One copy, imported by both lanes, so there is no third time.

/** Longest single pause a hub can ask for. Matches the hub's rate-limit
 *  window (60 s) — a `Retry-After` larger than that is either a typo or a hub
 *  we should not be blocking a boot sweep on. */
export const MAX_RETRY_DELAY_MS = 60_000;

/** Where an absent/unparsable `Retry-After` lands. Old hubs (pre-fix) send a
 *  bare 429 with no header, and their window is the same 60 s. */
export const DEFAULT_RETRY_DELAY_MS = 60_000;

/**
 * Shortest pause a hub can talk us into.
 *
 * The clamp above stops a hub asking for a pause so long it bricks the lane.
 * This is the other end of the same argument, and it is the one that matters:
 * the header is hub-controlled, `Retry-After: 0.001` parses as a perfectly
 * valid millisecond, and a hold of one millisecond is not a hold. A hub that
 * refuses everything and asks us straight back would put us into the issue-#109
 * storm again — a refusal loop at full poll rate — with the client believing it
 * was being obedient the whole time.
 */
export const MIN_RETRY_DELAY_MS = 1_000;

/** How much of an error body reaches a `reason`. Enough to tell "rate limit
 *  exceeded" from a Cloudflare error page — the distinction the 2026-08-11 RCA
 *  had to reconstruct from edge logs because the client kept only a status. */
export const ERROR_SNIPPET_CHARS = 80;

/** How much of an error body we will READ to produce those characters.
 *  Bounded on purpose: the body comes from a component DDR-054 calls
 *  untrusted, and `await res.text()` on a body that never ends is a heap fill
 *  dressed as diagnostics. */
const MAX_SNIPPET_READ_BYTES = 8 * 1024;

/**
 * `Retry-After: <seconds>` → ms, clamped.
 *
 * Only the delta-seconds form is parsed; the HTTP-date form is not something
 * our hub emits, and guessing at clock skew to support it would make the
 * pause less predictable, not more.
 */
export function retryAfterMs(header: string | null | undefined): number {
  const secs = Number(String(header ?? '').trim());
  if (!Number.isFinite(secs) || secs <= 0) return DEFAULT_RETRY_DELAY_MS;
  // Clamped at BOTH ends — the ceiling stops a hub bricking the lane, the
  // floor stops one talking us out of pausing at all.
  return Math.min(Math.max(secs * 1000, MIN_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
}

/** Read at most `MAX_SNIPPET_READ_BYTES` of a body, then hang up. */
async function readBounded(res: Response): Promise<string> {
  const body = res.body;
  if (!body?.getReader) {
    // No stream to cap (a fixture `Response`, an older polyfill). The text is
    // still bounded on the way out by `ERROR_SNIPPET_CHARS`.
    try {
      return (await res.text()).slice(0, MAX_SNIPPET_READ_BYTES);
    } catch {
      return '';
    }
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_SNIPPET_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } catch {
    /* a body we cannot read tells us nothing — the status still does */
  } finally {
    void reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Why a request was refused, in words — status PLUS a bounded snippet of the
 * body. The hub says `{"error":"rate limit exceeded"}`; an edge that never
 * reached the hub says HTML. Those are different bugs and the Sync panel
 * should not make a person read logs to tell them apart.
 *
 * The body is hub-supplied ⇒ untrusted (DDR-054): control characters stripped,
 * whitespace collapsed, hard length cap, and it only ever renders as text.
 */
export async function failureReason(res: Response): Promise<string> {
  const snippet = (await readBounded(res))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ERROR_SNIPPET_CHARS);
  return snippet ? `HTTP ${res.status} — ${snippet}` : `HTTP ${res.status}`;
}

/**
 * A door's own words for a FINAL refusal, as one sentence for a person (issue #175): the hub's
 * JSON `error` when it sent one (`{"error":"invalid path"}` → “invalid path”), else the bounded
 * body. Hub-supplied ⇒ untrusted (DDR-054): the same stripping and cap as `failureReason`, and it
 * only ever renders as text.
 */
export async function refusalWords(res: Response): Promise<string> {
  const raw = await readBounded(res);
  let said = raw;
  try {
    const body = JSON.parse(raw) as { error?: unknown } | null;
    if (typeof body?.error === 'string') said = body.error;
  } catch {
    /* not JSON — the body itself is what it said */
  }
  const clean = said
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[“”"]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ERROR_SNIPPET_CHARS);
  return clean
    ? `The project’s server didn’t take this file — it answered “${clean}”.`
    : 'The project’s server didn’t take this file.';
}

/** A refusal that names a WALL rather than a fault: the hub is willing, just
 *  not now. Every lane that can hit one reports it in this shape. */
export interface RateLimited {
  rateLimited: true;
  /** How long the hub asked us to wait, already clamped. */
  retryAfterMs: number;
}

/** Is this response the hub telling us to slow down? */
export function isRateLimited(res: Pick<Response, 'status'>): boolean {
  return res.status === 429;
}

/**
 * Is this response BACKPRESSURE — the peer is willing, just not right now?
 *
 * Wider than `isRateLimited`, and the two are deliberately both exported:
 * a 429 has one precise meaning that other call sites depend on, while this is
 * the question the transfer lanes actually want to ask.
 *
 * Two cases:
 *   - 429, always. It has one meaning even bare, and `retryAfterMs` supplies a
 *     sane default when the header is missing.
 *   - 503 or 502 that CARRIES a `Retry-After`. The header is the peer saying
 *     "come back at this time", which is precisely what distinguishes a busy
 *     peer from a broken one.
 *
 * THE HEADER IS THE DISCRIMINATOR, and it is doing real work rather than being
 * a formality. A cell that is starting answers `503 Retry-After: <n>` (see
 * `cell-do.mjs` `#resolveStorageCredentials`), and firing this pass's whole
 * request budget into that window is how a slow start becomes a failed one.
 * A cell that genuinely cannot obtain storage answers a BARE 503 — a broken
 * deployment, not a wall — and that one must stay an ordinary refusal so the
 * request ceiling bounds it and the failure surfaces per file.
 *
 * Treating every 5xx as backpressure would erase exactly that distinction and
 * make a broken hub look like a busy one, forever.
 */
export function isBackpressure(res: Pick<Response, 'status'> & { headers?: Headers }): boolean {
  if (res.status === 429) return true;
  if (res.status === 503 || res.status === 502) {
    return Boolean(res.headers?.get?.('retry-after'));
  }
  return false;
}
