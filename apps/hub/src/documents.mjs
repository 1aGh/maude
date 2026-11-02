// "What does this project actually contain?" — the answer a peer cannot get.
//
// A syncing peer opens one Yjs provider per canvas it finds ON ITS OWN DISK.
// Yjs has no enumeration: a document nobody asks for is a document nobody
// learns about. So a desktop that connects to a project holding 75 canvases,
// carrying 72 of them locally, syncs 72, reports "72/72 synced", and is telling
// the truth about the wrong universe — the three it does not have are invisible
// to it, forever, by construction.
//
// That was reported as "I pressed Open in Maude and nothing happened", and it
// took a hub-side document list to even see. This route is that list.
//
// SCOPE-BOUND, LIKE THE SYNC ITSELF. The bearer is the SAME peer token the
// caller syncs with (never the admin secret — a peer must not need operator
// credentials to ask what it is syncing), and every name is filtered through
// the same `matchesScope` gate that `onAuthenticate` applies per document.
// A token that may not open a document may not learn that it exists: this
// route can never widen what its holder already sees over the wire.
//
// NAMES ONLY. No document CONTENT crosses here — sizes and names, which is what
// a peer needs to notice a gap and what an operator surface already exposes.
// Reconciling the gap is the caller's decision, deliberately not this route's:
// materialising a hub-named document as a NEW local file changes what a hub can
// put on your disk (DDR-054), and that is a decision to be taken explicitly
// rather than smuggled in behind a listing.
//
// THE LISTING ALSO CARRIES ABSENCE. `documents` alone could only ever say what
// exists, and a peer reading "exists" as authority to create a file (which
// `remote-docs.ts` does, deliberately) means a deleted canvas comes straight
// back. So the same response carries `tombstones` — names this project has
// deleted — scope-filtered exactly like `documents`, because "which canvases
// were deleted" leaks the same names "which canvases exist" does. See
// `tombstones.mjs` for why absence has to be stated rather than inferred.
//
// The field is ADDITIVE: a peer older than this change ignores it and behaves
// as it does today.

import { docDoor, peerAccess } from './access-docs.mjs';
import { isFilesCtlDoc } from './files-ctl.mjs';

/** `GET /api/documents` — the documents this token may open, with sizes. */
export const DOCUMENTS_PATH = '/api/documents';

/** `DELETE /api/documents/<name>` — state that a document is gone. */
export const DOCUMENT_PATH_PREFIX = '/api/documents/';

/** The document-name charset, as `server.mjs` and `tombstones.mjs` enforce it. */
const DOCUMENT_NAME_REGEX = /^[A-Za-z0-9._/-]{1,256}$/;

/**
 * A `..` PATH SEGMENT, which the charset above happily allows — `.` and `/` are
 * both legal in a document name, so `../../etc/passwd` is charset-clean.
 *
 * That is harmless where a name is only ever a SQLite key (the listing, the WS
 * door). It is not harmless here: a tombstone is an instruction a PEER acts on
 * by removing a local file, so this route's output reaches a filesystem in a way
 * the listing's never did. The peer applies containment of its own — a document
 * name may never place a file outside the design root (`remote-docs.ts`) — and
 * this is the second lock on the same door, at the boundary that mints the
 * instruction. No real canvas is named `..`, so nothing legitimate is refused.
 */
function hasTraversalSegment(name) {
  return name.split('/').includes('..');
}

/**
 * Handle the documents listing.
 *
 * Returns `true` when it answered (so the caller stops routing), `false` when
 * the path/method is not ours.
 *
 * @param {object} args
 * @param {string} args.path            request path, query already stripped
 * @param {string} args.method
 * @param {string|null} args.bearer     presented token, or null
 * @param {(token: string) => ({ scope?: string }|null)} args.verify
 * @param {(scope: string|undefined, name: string) => boolean} args.matchesScope
 * @param {() => { name: string, bytes: number }[]} args.listDocuments
 * @param {() => { name: string, deletedAt: number }[]} [args.listTombstones]
 * @param {(status: number, payload: unknown) => void} args.respondJson
 */
export function handleDocumentsRoute({
  path,
  method,
  bearer,
  verify,
  matchesScope,
  listDocuments,
  listTombstones,
  respondJson,
}) {
  if (path !== DOCUMENTS_PATH) return false;
  if (method !== 'GET') {
    respondJson(405, { error: 'method not allowed' });
    return true;
  }

  // Same refusal shape as the WS door: a missing credential and a bad one are
  // the same answer, so this cannot be used to probe which tokens exist.
  const match = bearer ? verify(bearer) : null;
  if (!match) {
    respondJson(401, { error: 'a project token is required to list documents' });
    return true;
  }

  // V2-1.16 L2 (S9.5): exactly the documents the WS door would OPEN for this
  // claim — a canvas-only session lists its granted canvases' documents only
  // (U1), Can view none (a document is the canvas's source, A19).
  const peer = peerAccess(match);
  const opens = (name) => matchesScope(match.scope, name) && docDoor(peer, name).ok;
  const documents = listDocuments()
    // THE CONTROL CHANNEL IS NOT A CANVAS. `maude.files` is the file-plane poke
    // channel (files-ctl.mjs) — no Y content, never persisted, and files-ctl's
    // own header says it must not show up in an operator's canvas count. It did:
    // the admin console listed it under Synced canvases and counted it (6 rows
    // for 5 canvases), and a peer's boot line read "pulling 2 canvases down from
    // the project (maude.files, ui-home)".
    //
    // A peer never materialised it — `slugFromDocName` (remote-docs.ts) rejects
    // dots, which is what the dotted name was for — so this is an accounting and
    // reporting fix, not a containment one. Names only: filtering it out here
    // costs a peer nothing it can use.
    .filter((d) => !isFilesCtlDoc(d.name))
    .filter((d) => opens(d.name))
    .map((d) => ({ name: d.name, bytes: d.bytes }));
  const tombstones = (listTombstones ? listTombstones() : [])
    .filter((t) => opens(t.name))
    .map((t) => ({ name: t.name, deletedAt: t.deletedAt }));

  respondJson(200, { documents, count: documents.length, tombstones });
  return true;
}

/**
 * Handle the single-document routes:
 *
 *   `DELETE /api/documents/<name>` — this canvas is gone. Tombstone it.
 *   `POST   /api/documents/<name>` — this canvas exists again. Clear its tombstone.
 *
 * Returns `true` when it answered (so the caller stops routing), `false` when
 * the path/method is not ours.
 *
 * WHY THE REVIVE HALF EXISTS. A tombstone outlives the delete by design, so
 * without it "delete a canvas, then make a new one with the same name" would be
 * eaten by its own gravestone for the whole retention window — every peer would
 * dutifully trash the new canvas. Creating a name is the one unambiguous signal
 * that the deletion no longer describes reality, and only a peer has it: the hub
 * cannot tell a fresh create from a stale peer reconnecting with an old copy,
 * which is exactly why this is stated rather than inferred from a connection.
 *
 * SAME CREDENTIAL, SAME SCOPE AS OPENING THE DOCUMENT. A peer that may open a
 * document may delete it; a peer that may not open it may not learn whether it
 * exists, so an out-of-scope name gets the same answer as an unknown one. This
 * route can never widen what its holder already reaches over the wire.
 *
 * A READ-ONLY TOKEN MAY NOT DELETE. `viewer` exists so that a credential can be
 * handed out without handing out the project; deleting is the most destructive
 * write there is, so it takes the write capability the sync lane already gates
 * on.
 *
 * IDEMPOTENT. Deleting something already deleted is `200`, not `404`: the peer's
 * retry after a dropped response must not be an error, and "it is not there" is
 * the outcome the caller asked for either way.
 *
 * @param {object} args
 * @param {string} args.path            request path, query already stripped
 * @param {string} args.method
 * @param {string|null} args.bearer     presented token, or null
 * @param {(token: string) => ({ scope?: string, readOnly?: boolean }|null)} args.verify
 * @param {(scope: string|undefined, name: string) => boolean} args.matchesScope
 * @param {(name: string) => void} args.deleteDocument
 * @param {(name: string) => void} args.reviveDocument
 * @param {(status: number, payload: unknown) => void} args.respondJson
 */
export function handleDocumentItemRoute({
  path,
  method,
  bearer,
  verify,
  matchesScope,
  deleteDocument,
  reviveDocument,
  respondJson,
}) {
  if (!path.startsWith(DOCUMENT_PATH_PREFIX)) return false;
  if (method !== 'DELETE' && method !== 'POST') {
    respondJson(405, { error: 'method not allowed' });
    return true;
  }
  const deleting = method === 'DELETE';

  const match = bearer ? verify(bearer) : null;
  if (!match) {
    respondJson(401, { error: 'a project token is required to change a document' });
    return true;
  }
  if (match.readOnly) {
    respondJson(403, { error: 'this token is read-only' });
    return true;
  }

  // The name arrives percent-encoded (a document name may contain `/`). A
  // malformed encoding is a bad request, not a crash.
  let name;
  try {
    name = decodeURIComponent(path.slice(DOCUMENT_PATH_PREFIX.length));
  } catch {
    respondJson(400, { error: 'malformed document name' });
    return true;
  }
  if (!name || !DOCUMENT_NAME_REGEX.test(name) || hasTraversalSegment(name)) {
    respondJson(400, { error: 'invalid document name' });
    return true;
  }
  // Out of scope answers exactly like in-scope — see the note above. The work
  // is skipped; only the shape of the answer is shared.
  if (matchesScope(match.scope, name)) {
    if (deleting) deleteDocument(name);
    else reviveDocument(name);
  }

  respondJson(200, deleting ? { deleted: name } : { revived: name });
  return true;
}
