// Invalidate discovery after persisted membership/path changes. No content or
// path rides the shared control channel; each reader fetches its scoped list.
export function createDocumentEvents({ poke }) {
  const observed = new WeakMap();
  return {
    stored({ documentName, document }) {
      if (documentName === 'maude.files') return;
      try {
        const meta = document.getMap('syncMeta');
        const boundedPath = (value) => (typeof value === 'string' ? value.slice(0, 4096) : null);
        const signature = JSON.stringify([
          boundedPath(meta.get('path')),
          boundedPath(meta.get('movedTo')),
          document.getText('html').length > 0,
        ]);
        if (observed.get(document) === signature) return;
        observed.set(document, signature);
        // V2-1.16 L3: the event names its document, so a canvas-only
        // connection is told only about a canvas it sees.
        poke.schedule(0, { documentName });
      } catch {
        // A malformed legacy document must not abort the storage/projection
        // hook. Reconciliation still discovers it through the scoped listing.
      }
    },
    /** `info` = `{ documentName }` / `{ path }` when the caller knows it; without
     *  it no canvas-only connection is told (it cannot be scoped). */
    changed(info = null) {
      poke.schedule(0, info);
    },
  };
}
