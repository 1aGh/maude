// 2.0.5 — "moved to the trash" bar on a LIVE canvas. Older copies of a canvas sit in the Trash at the
// same path as the canvas now live there (a canvas re-made at the old place); the shared Trash listing
// must say which of its canvas items have a live document at their path (`liveAtPath`), so the open
// canvas is never shown as deleted. Same rule as the write stop (routes/trash.ts createTrashWriteStop).

import { describe, expect, test } from 'bun:test';

import { type TrashListing, type TrashRuntime, trashAccess } from '../history/trash.ts';
import { createTrashRoutes } from '../routes/trash.ts';

const T = Date.now();
const item = (entry: string, path: string, actor: string, at: number) => ({
  id: `canvas:${entry}`,
  entry,
  doc: `d-${entry}`,
  path,
  rev: 1,
  actionId: `a-${entry}`,
  actor,
  at,
});

type LiveDoc = { path: string | null; retired: boolean };

function routes(listing: TrashListing, live: LiveDoc[] | null) {
  const runtime: TrashRuntime & { acceptedLinkDocs?: () => Promise<unknown> } = {
    acceptedTrash: async () => structuredClone(listing),
  };
  if (live !== null)
    runtime.acceptedLinkDocs = async () => live.map((d, i) => ({ entry: `l${i}`, ...d }));
  return createTrashRoutes({
    control: () => runtime,
    access: () => trashAccess({ workspace: false, header: null, localRole: 'owner' }),
    readSource: () => null,
  });
}

async function list(specs: ReturnType<typeof routes>) {
  const s = specs.find((x) => x.method === 'GET' && x.path === '/_api/trash');
  const res = await s?.handle(new Request('http://localhost/_api/trash'), {});
  return (await res?.json()) as { items: { id: string; path: string; liveAtPath?: boolean }[] };
}

const LISTING: TrashListing = {
  canvases: [
    item('n_old', 'ui/list-design-mobile.tsx', 'cell-loopback-sync', T - 1000),
    item('n_gone', 'ui/gone.tsx', 'anna-do', T - 2000),
  ],
  artboards: [],
  live: {},
};

describe('GET /_api/trash marks items whose path a live canvas holds', () => {
  test('older copy at the path of a live canvas → liveAtPath; a truly trashed canvas is not', async () => {
    const j = await list(routes(LISTING, [{ path: 'ui/list-design-mobile.tsx', retired: false }]));
    const by = Object.fromEntries(j.items.map((i) => [i.path, i.liveAtPath === true]));
    expect(by['ui/list-design-mobile.tsx']).toBe(true);
    expect(by['ui/gone.tsx']).toBe(false);
  });

  test('a retired document does not hold the path', async () => {
    const j = await list(routes(LISTING, [{ path: 'ui/list-design-mobile.tsx', retired: true }]));
    expect(j.items.every((i) => i.liveAtPath !== true)).toBe(true);
  });

  test('a home that cannot list live documents marks nothing (the old behaviour)', async () => {
    const j = await list(routes(LISTING, null));
    expect(j.items.every((i) => i.liveAtPath !== true)).toBe(true);
  });
});
