// A canvas deleted while the project was in legacy mode leaves a tombstone in
// the hub's document store. When the project — now in accepted revisions —
// later creates a canvas under the SAME name, the manifest lists it live, but
// the stale tombstone made every desktop skip it: it showed on the web and
// never on the desktop (design.studyfi.com, `ui-s20-release-check`, 2026-09-30:
// hub 145 documents, desktop 144, "pulling 1 canvas" logged on every start and
// nothing pulled). In accepted mode the manifest is the truth: a tombstone for
// a name it lists live is stale; one for a name it retired still stands.

import { describe, expect, test } from 'bun:test';

import { acceptedListing } from '../sync/remote-docs.ts';

const listing = {
  documents: [
    { name: 'ui-reborn', bytes: 651 },
    { name: 'ui-kept', bytes: 100 },
  ],
  tombstones: [
    { name: 'ui-reborn', deletedAt: 1789533425365 }, // legacy delete, name re-created since
    { name: 'ui-gone', deletedAt: 1789533425365 }, // deleted, and retired in the manifest
  ],
};

describe('acceptedListing', () => {
  test('a stale legacy tombstone does not bury a canvas the manifest lists live', () => {
    const out = acceptedListing(listing, [
      { doc: 'ui-reborn', retired: false },
      { doc: 'ui-kept', retired: false },
      { doc: 'ui-gone', retired: true },
    ]);
    expect(out.documents.map((d) => d.name).sort()).toEqual(['ui-kept', 'ui-reborn']);
    expect(out.tombstones.map((t) => t.name)).toEqual(['ui-gone']);
  });

  test('a workspace-namespaced doc name is matched by its slug', () => {
    const out = acceptedListing(
      { documents: [], tombstones: [{ name: 'ws/abc/main/ui-reborn', deletedAt: 1 }] },
      [{ doc: 'ws/abc/main/ui-reborn', retired: false }]
    );
    expect(out.tombstones).toEqual([]);
  });

  test('without a listing the manifest alone answers', () => {
    const out = acceptedListing(null, [{ doc: 'ui-a', retired: false }]);
    expect(out).toEqual({ documents: [{ name: 'ui-a', bytes: 1 }], tombstones: [] });
  });
});
