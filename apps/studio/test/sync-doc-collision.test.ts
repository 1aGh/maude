// sec-a2 C5 — the sync admission groups canvases by their FINAL wire document,
// not by the raw slug. A file written outside the create/rename doors (the AI's
// Write, a git pull, Syncthing) never meets the S1.23b guard, so two canvases
// whose names differ only by an em dash vs a hyphen reached ONE namespaced
// document and overwrote each other on every peer.

import { describe, expect, test } from 'bun:test';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import { createDocNameResolver } from '../sync/doc-name.ts';
import {
  admitCanvases,
  type CanvasDescriptor,
  type DocCollision,
  docCollisionNotice,
} from '../sync/index.ts';
import { syncKeyOf } from '../sync-name-key.ts';

const ROOT = '/p/.design';
const canvas = (rel: string): CanvasDescriptor => ({
  slug: canvasSlugFromRel(rel, ''),
  html: `${ROOT}/${rel}`,
  comments: `/c/${rel}.json`,
  annotations: `/a/${rel}.json`,
  meta: `${ROOT}/${rel.replace(/\.tsx$/, '.meta.json')}`,
  css: `${ROOT}/${rel.replace(/\.tsx$/, '.css')}`,
});

const namespaced = createDocNameResolver({
  repoRoot: '/nonexistent',
  explicitWorkspaceId: 'acme',
  branch: 'main',
});
const flat = createDocNameResolver({ repoRoot: '/nonexistent', flag: '0' });

describe('C5 — admission keys on the wire document', () => {
  test('an em dash and a hyphen collide in a namespaced project: neither syncs', () => {
    const dash = canvas('ui/a—b.tsx');
    const hyphen = canvas('ui/a-b.tsx');
    // The raw slugs differ — the old raw-slug grouping let both through.
    expect(dash.slug).not.toBe(hyphen.slug);
    expect(namespaced(dash.slug)).toBe(namespaced(hyphen.slug));

    const seen: DocCollision[] = [];
    const admitted = admitCanvases([dash, hyphen, canvas('ui/ok.tsx')], true, {
      docNameOf: namespaced,
      onCollisions: (c) => seen.push(...c),
    });
    expect(admitted.map((c) => c.slug)).toEqual(['ui-ok']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.docName).toBe(namespaced('ui-a-b'));
    expect(seen[0]?.files).toEqual([dash.html, hyphen.html]);
  });

  test('names differing only by case collide (both shapes)', () => {
    for (const docNameOf of [namespaced, flat]) {
      const seen: DocCollision[] = [];
      const admitted = admitCanvases([canvas('ui/Poster.tsx'), canvas('ui/poster.tsx')], false, {
        docNameOf,
        onCollisions: (c) => seen.push(...c),
      });
      expect(admitted).toEqual([]);
      expect(seen).toHaveLength(1);
    }
  });

  test('a flat project keeps distinct wire names apart — only real collisions refuse', () => {
    const admitted = admitCanvases([canvas('ui/a—b.tsx'), canvas('ui/a-b.tsx')], false, {
      docNameOf: flat,
    });
    expect(admitted).toHaveLength(2);
  });

  test('the grouping key agrees with the S1.23b guard key in a namespaced project', () => {
    for (const rel of ['ui/a—b.tsx', 'ui/A b.tsx', 'ui/x..y.tsx']) {
      expect(namespaced(canvas(rel).slug).split('/').pop()).toBe(syncKeyOf(rel));
    }
  });

  test('a slug with nothing left after sanitising does not throw the admission', () => {
    const odd = canvas('ui/★.tsx');
    odd.slug = '★';
    const admitted = admitCanvases([odd, canvas('ui/ok.tsx')], false, { docNameOf: namespaced });
    expect(admitted).toHaveLength(2);
  });

  test('the notice names both files and says they are safe', () => {
    const n = docCollisionNotice(
      { docName: 'ws/acme/main/ui-a-b', files: [`${ROOT}/ui/a—b.tsx`, `${ROOT}/ui/a-b.tsx`] },
      ROOT
    );
    expect(n.severity).toBe('warn');
    expect(n.id).toBe('doc-collision-ws/acme/main/ui-a-b');
    expect(n.text).toBe(
      '“ui/a—b” and “ui/a-b” would share one sync document, so neither is syncing. Both files are safe on this machine. Rename one.'
    );
  });
});
