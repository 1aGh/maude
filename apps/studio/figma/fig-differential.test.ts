// TIER 2 — the differential. THE SHIP GATE for the `.fig` door (DDR-221 D7).
//
// The same document through both doors must normalize to the same tree. This is
// the only oracle that proves the decoder is RIGHT rather than merely QUIET, and
// it exists only because the REST door was built first — which is what
// retroactively justifies the phase ordering.
//
// It earned that billing immediately. Every unit test in fig-decode.test.ts was
// green while the decoder emitted Figma's INTERNAL node vocabulary
// (FRAME-with-resizeToFit, ROUNDED_RECTANGLE, SYMBOL) instead of the public REST
// one the translators are written against. Both sides looked perfectly valid in
// isolation; only the comparison could see it.
//
// Offline by construction: the oracle is a COMMITTED capture of
// `fetchDocument()` for the same two documents, so CI needs no token and no
// network. The recorded form catches DECODER regressions; only a live re-capture
// catches FIGMA changing. They are not the same test — see § Re-capturing.
//
// ── Re-capturing the oracle ──────────────────────────────────────────────────
// Needed when Figma changes its REST projection, or when a fixture document is
// edited. Requires a stored Figma PAT (`getProviderKey('figma')`):
//
//   cd apps/studio && bun -e '
//     const { fetchDocument } = await import("./figma/client.ts");
//     for (const [key, surface, out] of [
//       ["dGNzRC2kmrmGnOxaBa0RI7", "design", "design.rest-oracle.json"],
//       ["Em6NOwaOFTYV7NlQT4NK8l", "board",  "figjam.rest-oracle.json"],
//     ]) await Bun.write("../../.ai/fixtures/figma/2026-08-03/" + out,
//          JSON.stringify(await fetchDocument({ fileKey: key, surface }), null, 1));'
//
// Both documents live on the StudyFi plan (moved there 2026-08-12; the file keys
// survived the move). Re-export the `.fig`/`.jam` in the same pass or the two
// halves drift apart.

import { describe, expect, test } from 'bun:test';

import { decodeFigArchive } from './fig-decode.ts';
import { type FigmaNode, type NormalizedDocument, walkNodes } from './types.ts';

const FIXTURES = new URL('../../../.ai/fixtures/figma/2026-08-03/', import.meta.url).pathname;

/**
 * REST expands an INSTANCE's children and mints synthetic ids for them
 * (`I<instance>;<child>`). A `.fig` stores an instance by reference, so until
 * #155 §6 those nodes were the one known delta between the doors. The local door
 * now expands them under REST's own ids, so the two trees are compared node for
 * node and nothing is allowlisted.
 */
const INSTANCE_CHILD_ID = /^I[0-9]+:[0-9]+;/;

/** Sub-pixel float noise would be acceptable; we have never needed the slack. */
const GEOMETRY_EPSILON = 0.5;

interface Case {
  label: string;
  fileKey: string;
  archive: string;
  oracle: string;
}

const CASES: Case[] = [
  {
    label: 'design',
    fileKey: 'dGNzRC2kmrmGnOxaBa0RI7',
    archive: 'design.fig',
    oracle: 'design.rest-oracle.json',
  },
  {
    label: 'figjam',
    fileKey: 'Em6NOwaOFTYV7NlQT4NK8l',
    archive: 'figjam.jam',
    oracle: 'figjam.rest-oracle.json',
  },
];

function index(root: FigmaNode): Map<string, FigmaNode> {
  const byId = new Map<string, FigmaNode>();
  walkNodes(root, (n) => byId.set(n.id, n));
  return byId;
}

async function load(c: Case) {
  const rest = (await Bun.file(FIXTURES + c.oracle).json()) as NormalizedDocument;
  const bytes = new Uint8Array(await Bun.file(FIXTURES + c.archive).arrayBuffer());
  const { document: fig } = decodeFigArchive(bytes, { fileKey: c.fileKey });
  return { rest: index(rest.root), fig: index(fig.root), restDoc: rest, figDoc: fig };
}

describe.each(CASES)('tier 2 — $label through both doors', (c) => {
  test('the .fig door sees every REST node, instance children included', async () => {
    const { rest, fig } = await load(c);
    const missing = [...rest.keys()].filter((id) => !fig.has(id));
    // Instance children are expanded locally (#155 §6): nothing is missing.
    expect(missing).toEqual([]);
    // And nothing may exist locally that REST does not know about.
    expect([...fig.keys()].filter((id) => !rest.has(id))).toEqual([]);
  });

  test('node TYPE agrees — the public vocabulary, not Figma internals', async () => {
    const { rest, fig } = await load(c);
    const diffs = [...fig.entries()]
      .filter(([id, n]) => rest.get(id) && rest.get(id)?.type !== n.type)
      .map(([id, n]) => `${id}: REST=${rest.get(id)?.type} fig=${n.type}`);
    expect(diffs).toEqual([]);
  });

  test('node NAME agrees byte for byte, diacritics and hostile characters included', async () => {
    const { rest, fig } = await load(c);
    const diffs = [...fig.entries()]
      .filter(([id, n]) => rest.get(id) && rest.get(id)?.name !== n.name)
      .map(([id]) => id);
    expect(diffs).toEqual([]);
  });

  test('GEOMETRY agrees — the parent-chain composition against REST absolute boxes', async () => {
    const { rest, fig } = await load(c);
    const diffs: string[] = [];
    let worst = 0;
    for (const [id, n] of fig) {
      const r = rest.get(id);
      if (!r?.absoluteBoundingBox || !n.absoluteBoundingBox) continue;
      const a = r.absoluteBoundingBox;
      const b = n.absoluteBoundingBox;
      const delta = Math.max(
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs(a.width - b.width),
        Math.abs(a.height - b.height)
      );
      worst = Math.max(worst, delta);
      if (delta > GEOMETRY_EPSILON) diffs.push(`${id}: Δ${delta.toFixed(2)}px`);
    }
    expect(diffs).toEqual([]);
    // Recorded rather than merely bounded: the composition is EXACT today, and a
    // drift into "within tolerance" is worth noticing before it becomes drift
    // out of it. This is the assertion the A4 float trap would have failed.
    expect(worst).toBe(0);
  });

  test('TEXT content agrees', async () => {
    const { rest, fig } = await load(c);
    const diffs = [...fig.entries()]
      .filter(([id, n]) => {
        const r = rest.get(id);
        return r && (r.characters ?? '') !== (n.characters ?? '');
      })
      .map(([id]) => id);
    expect(diffs).toEqual([]);
  });

  test('the surface the prelude declared matches the surface REST was asked for', async () => {
    const { restDoc, figDoc } = await load(c);
    expect(figDoc.surface).toBe(restDoc.surface);
    expect(figDoc.origin).toBe('fig');
    expect(restDoc.origin).toBe('rest');
  });
});

describe('tier 2 — instances are expanded locally (#155 §6)', () => {
  test('the design file carries instance children, and the .fig door draws them under REST ids', async () => {
    const { rest, fig } = await load(CASES[0]);
    const instanceChildren = [...rest.keys()].filter((id) => INSTANCE_CHILD_ID.test(id));
    // If this ever becomes empty the fixture changed and the test covers nothing.
    expect(instanceChildren.length).toBeGreaterThan(0);
    expect(instanceChildren.every((id) => fig.has(id))).toBe(true);
  });

  test('connector endpoints resolve to the same host ids through both doors', async () => {
    const { rest, fig } = await load(CASES[1]);
    const pairs = (m: Map<string, FigmaNode>) =>
      [...m.values()]
        .filter((n) => n.type === 'CONNECTOR')
        .map((n) => `${n.id}:${n.connectorStart}->${n.connectorEnd}`)
        .sort();
    expect(pairs(fig)).toEqual(pairs(rest));
    expect(pairs(fig).length).toBe(6);
  });
});
