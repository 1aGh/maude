// #167 T5.3 — the held row in Sync details, the client half.
//
//   overflow — the hub's owner read carries `heldOverflow` when its hold list may be short (the hold
//              cap or a cut walk): files it could not name are held back too. The row says so, even
//              when it lists nothing.

import { describe, expect, test } from 'bun:test';

import { codeHeldDetail, filePlaneHeld } from '../sync/index.ts';
import { fetchJournal } from '../sync/journal-client.ts';

const HUB = 'https://hub.test';

function hubWith(extra: Record<string, unknown>) {
  return (async (url: string) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/journal') {
      return new Response(
        JSON.stringify({ epoch: 'epoch-1', head: 0, entries: [], truncated: false, ...extra }),
        { status: 200 }
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('overflow — the held list may be short', () => {
  test('the journal read carries heldOverflow on the held list; only a strict true counts', async () => {
    const page = await fetchJournal({
      hubUrl: HUB,
      token: 't',
      fetchImpl: hubWith({
        held: [{ path: 'brand/x.tsx', reason: 'canvas-before-folders' }],
        heldCount: 1,
        heldOverflow: true,
      }),
    });
    expect(page?.held).toEqual({
      count: 1,
      paths: [{ path: 'brand/x.tsx', reason: 'canvas-before-folders' }],
      overflow: true,
    });
    for (const odd of ['true', 1, {}, false]) {
      const p = await fetchJournal({
        hubUrl: HUB,
        token: 't',
        fetchImpl: hubWith({ held: [], heldCount: 0, heldOverflow: odd }),
      });
      expect(p?.held).toEqual({ count: 0, paths: [] });
    }
  });

  test('an overflowed hold list is a row even when it names no file, and the row says why', () => {
    const held = filePlaneHeld({ codeHeld: { count: 0, paths: [], overflow: true } } as never);
    expect(held).toEqual([
      {
        kind: 'code-held',
        count: 0,
        paths: [],
        overflow: true,
        detail: codeHeldDetail(0, { overflow: true }),
      },
    ]);
    const words = codeHeldDetail(0, { overflow: true });
    expect(words).toContain('couldn’t keep track of every one');
    expect(words).toContain('Nothing was removed.');
    expect(words).toContain('canvas folders');
    expect(words).not.toMatch(/\bwe\b|\bI\b|!/);
  });

  test('with files listed, the sentence adds that more may be held than are listed', () => {
    const one = codeHeldDetail(2, { overflow: true });
    expect(one.startsWith(codeHeldDetail(2))).toBe(true);
    expect(one).toContain('more may be held than are listed');
    // No overflow: the old sentence, unchanged.
    expect(codeHeldDetail(2, { overflow: false })).toBe(codeHeldDetail(2));
    // No overflow and nothing listed: still no row.
    expect(filePlaneHeld({ codeHeld: { count: 0, paths: [] } } as never)).toEqual([]);
  });
});
