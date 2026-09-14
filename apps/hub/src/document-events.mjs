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
        poke.schedule(0);
      } catch {
        // A malformed legacy document must not abort the storage/projection
        // hook. Reconciliation still discovers it through the scoped listing.
      }
    },
    changed() {
      poke.schedule(0);
    },
  };
}
