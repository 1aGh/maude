// The file-plane control channel — Sync v2 Increment 2 (DDR-226 §4).
//
// THE BUG THIS EXISTS TO KILL. A hub-process write lands in the checkout via
// tmp+rename. In a container, recursive `fs.watch` does not fire for that — the
// repo records it as verified live ("after a 200 edit-css on a cell, a
// connected canvas-hmr socket received nothing"). So the studio child never
// learns, no `fs:any` is synthesized, no `canvas-hmr {mode:'asset'}` heal is
// broadcast, and an open cloud tab keeps its broken-image glyph until somebody
// reloads by hand. Bytes delivered, nothing visible. That is what "sync
// nefunguje" meant for three days.
//
// The fix is NOT to chase the watcher. It is to stop inferring: every write
// site announces its own write, and the announcement rides a socket that is
// already open.
//
// WHY A DOTTED DOCUMENT NAME. Hocuspocus ships a stateless message channel
// (`broadcastStateless` / `onStateless`) that this codebase used nowhere, and it
// is per-document — so the poke needs a document to ride on. `maude.files` is
// reserved for it, and the DOT is load-bearing: every older client derives its
// document names from canvas SLUGS, whose charset is `[A-Za-z0-9_-]`. A dotted
// name therefore cannot collide with any real canvas and cannot be mistaken for
// one by a peer that predates this channel — no phantom LEGACY documents.
// It is also branch-INDEPENDENT (one channel per project, not per branch).
//
// WHAT RIDES IT. `{ t: 'files', head }` and nothing else. The poke is
// PAYLOAD-FREE in the sense that matters: it carries no path, no hash, no
// bytes. It says "the journal moved, ask me". A receiver then pulls through the
// authenticated routes it already validates. A lost poke costs latency and
// never correctness — the reconciler poll is still there underneath.

/** The reserved control document. Dotted so no slug can ever equal it. */
export const FILES_CTL_DOC = 'maude.files';

/** Coalescing window. A 500-file burst becomes ONE frame per peer. */
export const POKE_COALESCE_MS = 250;

export function isFilesCtlDoc(name) {
  return name === FILES_CTL_DOC;
}

/**
 * Wrap a Hocuspocus persistence extension so the control document is NEVER
 * stored and never loaded.
 *
 * It carries no Y content by design — it exists only as something a stateless
 * message can be addressed to — so persisting it would put a permanent empty
 * row in every tenant's document store, which then shows up in listings, in
 * `verifyRestored`'s document count, and in the operator's canvas count. The
 * document has to be invisible to everything except the channel.
 */
/**
 * `beforeHandleAwareness` for the control document: drop presence entirely.
 *
 * `connectionConfig.readOnly` gates Y content (SyncStep2 / Update) and NOT
 * awareness, which is applied to the document and fanned out to every
 * connection regardless. Since every valid token of every scope is admitted to
 * this document by design, that combination made it an authenticated
 * cross-scope broadcast bus and a fan-out amplifier — peers scoped to disjoint
 * canvases could exchange arbitrary payloads on it, undoing the scope
 * isolation the ordinary check buys everywhere else.
 *
 * Emptying the state map is what the caller's re-encode sees, so nothing is
 * stored and nothing is broadcast. Presence has no meaning on a channel whose
 * entire vocabulary is one integer. Every other document is left alone.
 *
 * @returns {boolean} whether this call dropped anything (for tests + logging)
 */
export function dropCtlAwareness({ document, states }) {
  if (!isFilesCtlDoc(document?.name ?? '')) return false;
  const had = typeof states?.size === 'number' ? states.size > 0 : false;
  states?.clear?.();
  return had;
}

export function withoutCtlPersistence(extension) {
  const origStore = extension.onStoreDocument?.bind(extension);
  const origLoad = extension.onLoadDocument?.bind(extension);
  extension.onStoreDocument = async (data) => {
    if (isFilesCtlDoc(data?.documentName)) return;
    return origStore?.(data);
  };
  extension.onLoadDocument = async (data) => {
    if (isFilesCtlDoc(data?.documentName)) return;
    return origLoad?.(data);
  };
  return extension;
}

/**
 * Where the live documents actually live.
 *
 * `@hocuspocus/server` exposes TWO objects with confusingly similar roles:
 * `Server` (the HTTP/WS host, which `new Server()` returns) and `Hocuspocus`
 * (the document engine, reachable at `server.hocuspocus` and returned by
 * `listen()`). Only the second has `documents`. Accepting either is not
 * politeness — it is the difference between a poke that reaches peers and one
 * that silently evaporates, and the failure is invisible because "no document"
 * is a legitimate everyday state.
 */
export function documentMap(instance) {
  const direct = instance?.documents;
  if (direct && typeof direct.get === 'function') return direct;
  const nested = instance?.hocuspocus?.documents;
  if (nested && typeof nested.get === 'function') return nested;
  return null;
}

/**
 * The poke emitter.
 *
 * Coalesces to the LATEST head: a fresh link that appends 500 rows sends one
 * frame, not five hundred. Never throws — a broadcast failure is a latency
 * event, and the reconciler covers it.
 *
 * @param {object} args
 * @param {{ documents: Map<string, { broadcastStateless: (p: string) => void }> }} args.instance
 */
export function createFilesPoke({
  instance,
  documentsOnly = false,
  coalesceMs = POKE_COALESCE_MS,
  log = console,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  let timer = null;
  let pendingHead = 0;
  let sent = 0;
  let stopped = false;
  let warnedNoMap = false;

  const emit = () => {
    timer = null;
    const head = pendingHead;
    pendingHead = 0;
    const documents = documentMap(instance);
    if (!documents) {
      // NOT the same thing as "nobody is listening", and it must never be
      // treated as such. No document map means this was wired to the wrong
      // object — which is exactly what happened the first time: `new Server()`
      // returns a Server whose map lives at `.hocuspocus.documents`, so
      // `instance.documents` was `undefined` and every poke silently vanished.
      // The unit tests passed throughout, because their fake instance had the
      // shape the code expected rather than the shape the library has.
      if (!warnedNoMap) {
        warnedNoMap = true;
        log.error?.(
          '[files-ctl] no document map on the instance handed to createFilesPoke — the poke is wired to the wrong object and NO peer will ever be told a file landed. Pass the Hocuspocus instance (server.hocuspocus), not the Server.'
        );
      }
      return;
    }
    const doc = documents.get(FILES_CTL_DOC);
    // Nobody is listening. That IS the ordinary state of a project with no
    // peer attached — and the next attach reads the journal from its cursor
    // anyway, so nothing is missed.
    if (!doc) return;
    try {
      doc.broadcastStateless(
        JSON.stringify({ t: 'files', head, ...(documentsOnly ? { documents: true } : {}) })
      );
      sent += 1;
    } catch (err) {
      log.error?.(`[files-ctl] poke broadcast failed: ${err.message}`);
    }
  };

  return {
    /** The journal moved to `head`. Schedule (or fold into) the next frame. */
    schedule(head) {
      if (stopped) return;
      if (Number.isFinite(head) && head > pendingHead) pendingHead = head;
      if (timer !== null) return;
      timer = setTimeoutImpl(emit, coalesceMs);
      timer.unref?.();
    },
    /** Send immediately (tests; shutdown). */
    flushNow() {
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
      emit();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
    },
    /** How many frames actually went out — the honesty counter's hub half. */
    sent: () => sent,
    pending: () => timer !== null,
  };
}

/**
 * Parse a poke frame from the wire.
 *
 * The payload comes off a socket, so it is UNTRUSTED input like everything
 * else: a shape that is not exactly `{t:'files', head:<non-negative int>}` is
 * dropped rather than guessed at. The head is a HINT — a receiver re-reads the
 * journal through the authenticated route and believes that, not this.
 *
 * @returns {{ head: number } | null}
 */
export function parsePoke(payload) {
  if (typeof payload !== 'string' || payload.length > 512) return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || parsed.t !== 'files') return null;
  const head = parsed.head;
  if (!Number.isInteger(head) || head < 0) return null;
  return parsed.documents === true ? { head, documents: true } : { head };
}
