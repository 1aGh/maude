// S3.7a (S3-present-session §2, S3-slices §5 risk 2) — the awareness `present` field at the trust boundary.
//
//   · a forged, oversized, non-integer or extra-key `present` is dropped WHOLE (null), never trimmed
//   · `watching` is a sid or nothing
//   · across two awareness instances (the relay hop): the raw state carries the forged field, the
//     chokepoint (`readForeignPeers` → `sanitizeForeignState`) hands the follower nothing to act on
//   · the follower: first presenter kept, pinned to that client (a copied sid takes nothing over), a
//     lower seq ignored, ended when the pinned presenter stops, watchers counted (this follower included)
import { afterEach, describe, expect, test } from 'bun:test';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createFollower, newPresentSid, watchersLabel } from '../present/follow.ts';
import {
  type ForeignAwareness,
  type PresentAwareness,
  readForeignPeers,
  sanitizeForeignState,
  sanitizePresent,
  sanitizeWatching,
} from '../use-collab.tsx';

const OK: PresentAwareness = {
  v: 1,
  sid: 'k3x9q2m7p0w4z8a1',
  index: 5,
  total: 14,
  artboardId: 'post-1x1',
  seq: 7,
  media: null,
};

describe('sanitizePresent — whole or nothing', () => {
  test('a well-formed state passes, rebuilt from the known keys', () => {
    expect(sanitizePresent(OK)).toEqual(OK);
    const withMedia = { ...OK, media: { playing: true, t: 6.2, duration: 15, muted: false } };
    expect(sanitizePresent(withMedia)).toEqual(withMedia);
    // `media` absent reads as null (R1: absent = no clip)
    const { media: _m, ...noMedia } = OK;
    expect(sanitizePresent(noMedia)).toEqual(OK);
  });

  const bad: Array<[string, unknown]> = [
    ['not an object', 'present'],
    ['an array', [OK]],
    ['null', null],
    ['an extra key', { ...OK, href: 'https://evil.example' }],
    ['a prototype-carried key', Object.assign(Object.create({ evil: 1 }), OK)],
    ['v ≠ 1', { ...OK, v: 2 }],
    ['sid too short', { ...OK, sid: 'abc' }],
    ['sid too long', { ...OK, sid: 'a'.repeat(33) }],
    ['sid upper case', { ...OK, sid: 'K3X9Q2M7P0W4Z8A1' }],
    ['index non-integer', { ...OK, index: 1.5 }],
    ['index negative', { ...OK, index: -1 }],
    ['index ≥ total', { ...OK, index: 14 }],
    ['index NaN', { ...OK, index: Number.NaN }],
    ['index as a string', { ...OK, index: '5' }],
    ['total 0', { ...OK, total: 0, index: 0 }],
    ['total oversized', { ...OK, total: 2001 }],
    ['total Infinity', { ...OK, total: Number.POSITIVE_INFINITY }],
    ['artboardId oversized', { ...OK, artboardId: 'a'.repeat(65) }],
    ['artboardId outside the grammar', { ...OK, artboardId: 'a b' }],
    ['artboardId a selector', { ...OK, artboardId: '"]:has(*)' }],
    ['seq negative', { ...OK, seq: -1 }],
    ['seq past 2^31-1', { ...OK, seq: 2 ** 31 }],
    [
      'media with an extra key',
      { ...OK, media: { playing: true, t: 1, duration: 2, muted: false, x: 1 } },
    ],
    ['media t NaN', { ...OK, media: { playing: true, t: Number.NaN, duration: 2, muted: false } }],
    [
      'media t past a day',
      { ...OK, media: { playing: true, t: 86401, duration: 2, muted: false } },
    ],
    [
      'media playing not a boolean',
      { ...OK, media: { playing: 1, t: 1, duration: 2, muted: false } },
    ],
  ];
  for (const [why, raw] of bad) {
    test(`dropped whole: ${why}`, () => {
      expect(sanitizePresent(raw)).toBeNull();
    });
  }

  test('watching: a sid, or null', () => {
    expect(sanitizeWatching(OK.sid)).toBe(OK.sid);
    for (const raw of ['', 'abc', 'a'.repeat(33), 'K3X9Q2M7P0W4Z8A1', 5, null, undefined, {}]) {
      expect(sanitizeWatching(raw)).toBeNull();
    }
  });

  test('sanitizeForeignState: a bad present drops the field, not the peer', () => {
    const peer = sanitizeForeignState(4, { name: 'Tereza', present: { ...OK, index: 99 } });
    expect(peer?.name).toBe('Tereza');
    expect(peer?.present).toBeNull();
    expect(sanitizeForeignState(4, { name: 'Tereza', present: OK, watching: 'x' })).toMatchObject({
      present: OK,
      watching: null,
    });
  });
});

// ── across the relay ──────────────────────────────────────────────────────────────────────────────

const live: Array<{ doc: Y.Doc; aw: Awareness }> = [];
afterEach(() => {
  for (const { doc, aw } of live.splice(0)) {
    aw.destroy();
    doc.destroy();
  }
});

function peer(state: Record<string, unknown> | null): Awareness {
  const doc = new Y.Doc();
  const aw = new Awareness(doc);
  live.push({ doc, aw });
  aw.setLocalState(state);
  return aw;
}

/** One relay hop: everything `from` knows lands on `to`, as the hub / local room carries it. */
function relay(from: Awareness, to: Awareness): void {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [...from.getStates().keys()]), 'relay');
}

describe('across two awareness instances (the relay hop)', () => {
  test('a forged present crosses the wire, and the chokepoint drops it whole', () => {
    const planted = peer({
      name: 'Planted',
      present: { ...OK, artboardId: 'x'.repeat(5000), extra: { deep: true } },
    });
    const follower = peer({ name: 'Audience' });
    relay(planted, follower);
    // the relay carried it raw …
    const raw = follower.getStates().get(planted.clientID) as { present?: { artboardId?: string } };
    expect(raw.present?.artboardId?.length).toBe(5000);
    // … and the follower's read hands nothing on
    const peers = readForeignPeers(follower);
    expect(peers).toHaveLength(1);
    expect(peers[0].present).toBeNull();
    const f = createFollower(null);
    expect(f.update(peers)).toMatchObject({ target: null, sid: null, ended: false });
  });

  test('a well-formed present crosses and the follower lands on it', () => {
    const presenter = peer({ name: 'Tereza', present: OK });
    const follower = peer({ name: 'Audience' });
    relay(presenter, follower);
    const view = createFollower(null).update(readForeignPeers(follower));
    expect(view.target).toMatchObject({ sid: OK.sid, artboardId: 'post-1x1', index: 5, total: 14 });
    expect(view.presenterName).toBe('Tereza');
  });
});

// ── the follower ──────────────────────────────────────────────────────────────────────────────────

const fp = (
  clientID: number,
  present: Partial<PresentAwareness> | null,
  extra: Partial<ForeignAwareness> = {}
): ForeignAwareness => ({
  clientID,
  name: `p${clientID}`,
  color: '',
  cursor: null,
  selection: null,
  annotationSelection: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  present: present ? ({ ...OK, ...present } as PresentAwareness) : null,
  watching: null,
  ...extra,
});

describe('createFollower', () => {
  test('the first presenter is kept; a later one does not take over', () => {
    const f = createFollower(null);
    expect(f.update([fp(7, { sid: 'aaaaaaaa1' })]).sid).toBe('aaaaaaaa1');
    const v = f.update([fp(3, { sid: 'bbbbbbbb2' }), fp(7, { sid: 'aaaaaaaa1', index: 2 })]);
    expect(v.sid).toBe('aaaaaaaa1');
    expect(v.target?.index).toBe(2);
  });

  test('pinned to the presenter: another peer copying the sid moves nobody', () => {
    const f = createFollower(null);
    f.update([fp(7, { index: 1 })]);
    const v = f.update([fp(2, { index: 9, seq: 99 }), fp(7, { index: 3, seq: 8 })]);
    expect(v.target).toMatchObject({ clientID: 7, index: 3 });
  });

  test('the URL sid wins over the first presenter seen', () => {
    const f = createFollower('cccccccc3');
    const v = f.update([fp(1, { sid: 'aaaaaaaa1' }), fp(5, { sid: 'cccccccc3', index: 4 })]);
    expect(v.target).toMatchObject({ sid: 'cccccccc3', index: 4 });
    // a URL sid outside the grammar is ignored → first presenter
    expect(createFollower('NOPE').update([fp(1, { sid: 'aaaaaaaa1' })]).sid).toBe('aaaaaaaa1');
  });

  test('a lower seq for the same session is a late relay: ignored', () => {
    const f = createFollower(null);
    f.update([fp(7, { index: 6, seq: 10 })]);
    expect(f.update([fp(7, { index: 2, seq: 9 })]).target?.index).toBe(6);
    expect(f.update([fp(7, { index: 7, seq: 11 })]).target?.index).toBe(7);
  });

  test('ended: the pinned presenter stopped (or left); its name is kept for the bar', () => {
    const f = createFollower(null);
    f.update([fp(7, {})]);
    const v = f.update([fp(7, null)]);
    expect(v).toMatchObject({ ended: true, target: null, presenterName: 'p7' });
    expect(f.update([]).ended).toBe(true);
    // waiting is not ended
    expect(createFollower(null).update([]).ended).toBe(false);
  });

  test('watchers: peers watching this sid, plus this follower; "99+" above 99', () => {
    const f = createFollower(null);
    const v = f.update([
      fp(7, {}),
      fp(8, null, { watching: OK.sid }),
      fp(9, null, { watching: OK.sid }),
      fp(10, null, { watching: 'zzzzzzzz9' }),
    ]);
    expect(v.watchers).toBe(3);
    expect(watchersLabel(6)).toBe('6 watching');
    expect(watchersLabel(100)).toBe('99+ watching');
  });

  test('newPresentSid fits the grammar', () => {
    for (let i = 0; i < 20; i++) expect(newPresentSid()).toMatch(/^[a-z0-9]{8,32}$/);
  });
});
