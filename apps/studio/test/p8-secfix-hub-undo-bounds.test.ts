// p8-secfix-studio item 2 (V2-8.9 final delta I2 + D5): a hostile hub must not
// stall ⌘Z. The collision check reads the action's effects and their blobs from
// the hub; it now runs under ONE overall deadline, examines a capped number of
// annotations effects, and refuses to merge bodies over the board size limit.
// Every limit answers "no conflict" — fail open, the hub kernel keeps its rule.

import { describe, expect, test } from 'bun:test';

import '../annotations/ops-merge.ts';
import { MAX_BOARD_BYTES } from '../annotations/constants.ts';
import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  HUB_UNDO_CHECK_DEADLINE_MS,
  HUB_UNDO_MAX_EFFECTS,
  hubTextUndoConflict,
} from '../sync/hub-text-undo.ts';

const h = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
const sticky = (id: string, text: string): AnnotationElement =>
  ({ id, type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;
const board = (...els: AnnotationElement[]) => serializeBoard(els);

const before = board(sticky('k', 'Hello world'));
const after = board(sticky('k', 'Hello brave world'));
const now = board(sticky('k', 'Hello bold world')); // collides with the step
const fx = { doc: 'k', lane: 'annotations', beforeHash: h(before), afterHash: h(after) };

describe('hubTextUndoConflict — bounded against a hostile hub', () => {
  test('the bounds are the ones the hand-back names', () => {
    expect(HUB_UNDO_CHECK_DEADLINE_MS).toBe(2000);
    expect(HUB_UNDO_MAX_EFFECTS).toBe(64);
  });

  test('a hub whose blob never answers: ⌘Z is judged within the deadline, no conflict', async () => {
    const t0 = performance.now();
    const r = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({ effects: [fx] }),
        blob: () => new Promise<string | null>(() => {}), // hangs for good
        head: async () => now,
      }
    );
    const took = performance.now() - t0;
    expect(r).toBe(false);
    expect(took).toBeLessThan(HUB_UNDO_CHECK_DEADLINE_MS + 750);
  });

  test('a hub whose history read never answers is bounded the same way', async () => {
    const t0 = performance.now();
    const r = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: () => new Promise(() => {}),
        blob: async () => null,
        head: async () => now,
      }
    );
    expect(r).toBe(false);
    expect(performance.now() - t0).toBeLessThan(HUB_UNDO_CHECK_DEADLINE_MS + 750);
  });

  test('an action with 10 000 effects: at most the cap is examined, then no conflict', async () => {
    let blobs = 0;
    let heads = 0;
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      doc: `d${i}`,
      lane: 'annotations',
      beforeHash: h(`b${i}`),
      afterHash: h(`a${i}`),
    }));
    // the colliding effect sits past the cap — unseen, so the limit answers "no conflict"
    many.push({ ...fx });
    const r = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({ effects: many }),
        blob: async (hash) => {
          blobs++;
          return hash === fx.beforeHash ? before : hash === fx.afterHash ? after : before;
        },
        head: async (doc) => {
          heads++;
          return doc === 'k' ? now : before;
        },
      }
    );
    expect(r).toBe(false);
    expect(blobs).toBeLessThanOrEqual(2 * HUB_UNDO_MAX_EFFECTS);
    expect(heads).toBeLessThanOrEqual(HUB_UNDO_MAX_EFFECTS);
  });

  test('a collision inside the cap is still refused', async () => {
    const r = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({ effects: [fx] }),
        blob: async (hash) => (hash === fx.beforeHash ? before : after),
        head: async () => now,
      }
    );
    expect(r).toBe(true);
  });

  test('a body over the board size limit is not merged → no conflict', async () => {
    // stickies of legal size in a 2-byte letter: under the parser's CHARACTER limit
    // (parseBoard checks `length`), over the board limit in BYTES — so only the
    // check's own byte cap keeps it out of the merge.
    const pad = Array.from({ length: Math.ceil(MAX_BOARD_BYTES / 38_000) + 4 }, (_, i) =>
      sticky(`p${i}`, 'ř'.repeat(19_000))
    );
    const hugeNow = board(sticky('k', 'Hello bold world'), ...pad);
    expect(hugeNow.length).toBeLessThan(MAX_BOARD_BYTES);
    expect(Buffer.byteLength(hugeNow, 'utf8')).toBeGreaterThan(MAX_BOARD_BYTES);
    const r = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({ effects: [fx] }),
        blob: async (hash) => (hash === fx.beforeHash ? before : after),
        head: async () => hugeNow,
      }
    );
    expect(r).toBe(false);
    const hugeAfter = board(sticky('k', 'Hello brave world'), ...pad);
    const fx2 = { ...fx, afterHash: h(hugeAfter) };
    const r2 = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({ effects: [fx2] }),
        blob: async (hash) => (hash === fx2.beforeHash ? before : hugeAfter),
        head: async () => now,
      }
    );
    expect(r2).toBe(false);
  });
});
