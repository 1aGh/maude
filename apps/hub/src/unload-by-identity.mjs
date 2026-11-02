// Hocuspocus 4.3 unloads a document BY NAME, not by object — the hub's guard.
//
// `Hocuspocus.unloadDocument(document)` asks `documents.has(document.name)` and then
// `documents.delete(document.name)`: it never checks that the map still holds THIS
// object. A direct connection (every accepted revision opens one per document —
// `applyAccepted` → `withDoc`) unloads twice: once in `disconnect()` and once more from
// the `setTimeout(0)` that follows the immediate store. If a websocket peer loads the
// document in the gap between the two, the second call, made with the OLD object, finds
// the peer's NEW object under the same name, deletes it from the map and leaves the
// peer's connection on an orphan. The next accepted revision then opens a fresh
// instance, so that peer is "connected", synced up to the moment it joined, and never
// hears another update (S6.13b's "Untitled canvas 2" stuck on its first body; seen on a
// loaded machine about one run in two, nowhere else).
//
// The repair is the missing identity check: an unload for an object the map no longer
// holds is a stale call and does nothing. Drop this when a Hocuspocus release does it
// itself — `test/unload-by-identity.test.mjs` pins the upstream behaviour and says so.

/**
 * @param {{ documents: Map<string, object>, unloadDocument: (document: any) => Promise<any> }} hocuspocus
 * @returns the same instance, patched (idempotent).
 */
export function unloadByIdentity(hocuspocus) {
  if (!hocuspocus || hocuspocus.__unloadByIdentity) return hocuspocus;
  const unload = hocuspocus.unloadDocument.bind(hocuspocus);
  hocuspocus.unloadDocument = (document) =>
    hocuspocus.documents.get(document?.name) === document ? unload(document) : Promise.resolve();
  hocuspocus.__unloadByIdentity = true;
  return hocuspocus;
}
