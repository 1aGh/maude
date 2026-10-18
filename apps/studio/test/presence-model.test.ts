// S9.23 — presence: the pure rules (tones, fields, the words, the crowd, Follow, Bring, the glide).
//   canvas 10 co-presence · co-follow · co-bring · co-spotlight · co-twelve; S9-slices Q9; CONTRACT §6 C32/C33.
import { describe, expect, test } from 'bun:test';
import {
  IDLE_MS,
  newSummonId,
  presenceName,
  sanitizeArtboard,
  sanitizeFollowTarget,
  sanitizeIdleSince,
  sanitizeInComments,
  sanitizeSummon,
  sanitizeSurface,
} from '../presence/fields.ts';
import {
  collapseFaces,
  endsFollow,
  FACES_SHOWN,
  followersOf,
  followPeer,
  glidePlan,
  idleLabel,
  leaveFollow,
  menuSubline,
  NOT_FOLLOWING,
  type PresencePeer,
  peopleList,
  pickSummon,
  roleWord,
  syncFollow,
  toggleFollow,
  whereOf,
} from '../presence/model.ts';
import { PERSON_TONES, TONE_COLOR, toneFor, YOU_TONE } from '../presence/tones.ts';
import { colorForName, sanitizeForeignState } from '../use-collab.tsx';

const NOW = 1_800_000_000_000;
const LABELS: Record<string, string> = { a4: 'A4 · plakát', web: 'Web · STAŇ SE GATOREM' };
const labelOf = (id: string) => LABELS[id] ?? null;
const peer = (clientID: number, name: string, over: Partial<PresencePeer> = {}): PresencePeer => ({
  clientID,
  name,
  ...over,
});

describe('tones (C32): people never wear coral', () => {
  test('five tones, stable per name, "You" is yellow', () => {
    expect([...PERSON_TONES]).toEqual(['sky', 'green', 'yellow', 'lilac', 'grey']);
    expect(YOU_TONE).toBe('yellow');
    expect(toneFor('Tereza')).toBe(toneFor('Tereza'));
    expect(PERSON_TONES).toContain(toneFor('Jonas'));
  });
  test('no person colour sits in the coral / rose band (hue 10–50)', () => {
    for (const c of Object.values(TONE_COLOR)) {
      const hue = Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(c)?.[1]);
      expect(hue < 10 || hue > 50).toBe(true);
    }
    for (let i = 0; i < 400; i++) {
      const hue = Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(colorForName(`Person ${i}`))?.[1]);
      expect(hue < 10 || hue > 50).toBe(true);
    }
  });
});

describe('the presence fields are checked by value (Q9)', () => {
  test('artboard / idleSince / surface / inComments fall back to their quiet defaults', () => {
    expect(sanitizeArtboard('a4')).toBe('a4');
    expect(sanitizeArtboard('a b')).toBeNull();
    expect(sanitizeArtboard(7)).toBeNull();
    expect(sanitizeIdleSince(NOW)).toBe(NOW);
    expect(sanitizeIdleSince(-1)).toBeNull();
    expect(sanitizeIdleSince('x')).toBeNull();
    expect(sanitizeIdleSince(1.5)).toBeNull();
    expect(sanitizeSurface('browser')).toBe('browser');
    expect(sanitizeSurface('<img>')).toBe('app');
    expect(sanitizeInComments(true)).toBe(true);
    expect(sanitizeInComments('yes')).toBe(false);
    expect(sanitizeFollowTarget(3)).toBe(3);
    expect(sanitizeFollowTarget(-3)).toBeNull();
  });
  test('summon is {id, at} whole or nothing', () => {
    expect(sanitizeSummon({ id: 'abcdefgh1234', at: NOW })).toEqual({
      id: 'abcdefgh1234',
      at: NOW,
    });
    expect(sanitizeSummon({ id: 'abcdefgh1234', at: NOW, email: 'a@b.c' })).toBeNull();
    expect(sanitizeSummon({ id: 'ABC', at: NOW })).toBeNull();
    expect(sanitizeSummon({ id: 'abcdefgh1234', at: 'now' })).toBeNull();
    expect(sanitizeSummon([])).toBeNull();
    expect(sanitizeSummon(null)).toBeNull();
    expect(newSummonId(() => 0.5)).toMatch(/^[a-z0-9]{8,32}$/);
  });
  test('a foreign state is rebuilt from known fields: no e-mail rides, a v1 peer shows its quiet defaults', () => {
    const v2 = sanitizeForeignState(4, {
      name: 'Tereza',
      artboard: 'a4',
      surface: 'browser',
      inComments: true,
      idleSince: NOW,
      summon: { id: 'abcdefgh1234', at: NOW },
      followTarget: 9,
      email: 'tereza@example.com',
      role: 'owner',
    }) as unknown as Record<string, unknown>;
    expect(v2.artboard).toBe('a4');
    expect(v2.surface).toBe('browser');
    expect(v2.inComments).toBe(true);
    expect(v2.followTarget).toBe(9);
    expect(JSON.stringify(v2)).not.toContain('@');
    expect('email' in v2).toBe(false);
    const v1 = sanitizeForeignState(5, { name: 'Old Peer' }) as unknown as Record<string, unknown>;
    expect(v1).toMatchObject({
      artboard: null,
      idleSince: null,
      surface: 'app',
      inComments: false,
      summon: null,
      followTarget: null,
    });
  });
  test('a name that is an e-mail address is shown by its local part, on both sides', () => {
    expect(presenceName('michal.dovrtel@studyfi.com')).toBe('michal dovrtel');
    expect(presenceName('Tereza K')).toBe('Tereza K');
    const s = sanitizeForeignState(1, { name: 'tereza@example.com' });
    expect(s?.name).toBe('tereza');
  });
});

describe('the words (co-presence / co-twelve)', () => {
  test('role words are CONTRACT §6', () => {
    expect(roleWord('owner')).toBe('Can edit');
    expect(roleWord('member')).toBe('Can edit');
    expect(roleWord('viewer')).toBe('Can comment');
    expect(roleWord('observer')).toBe('Can view');
    expect(roleWord('nope')).toBeNull();
  });
  test('where: artboard · browser · Comments · idle', () => {
    const o = {
      labelOf,
      now: NOW,
      roleOf: (p: PresencePeer) => (p.name === 'Vojta' ? 'observer' : 'member'),
    };
    expect(whereOf(peer(1, 'Tereza', { artboard: 'a4' }), o)).toBe('A4 · plakát');
    expect(whereOf(peer(2, 'Vojta', { surface: 'browser' }), o)).toBe('in a browser · Can view');
    expect(whereOf(peer(3, 'Filip', { inComments: true }), o)).toBe('in Comments');
    expect(whereOf(peer(4, 'Eliška', { idleSince: NOW - 4 * 60_000 }), o)).toBe('idle · 4 min');
    expect(whereOf(peer(5, 'Ghost'), o)).toBe('on this canvas');
  });
  test('idle is 3 minutes, never shown below it, hours past 60', () => {
    expect(IDLE_MS).toBe(180_000);
    expect(idleLabel(NOW - 60_000, NOW)).toBe('idle · 3 min');
    expect(idleLabel(NOW - 25 * 60_000, NOW)).toBe('idle · 25 min');
    expect(idleLabel(NOW - 125 * 60_000, NOW)).toBe('idle · 2 h');
  });
  test('the face menu line: "On A4 · plakát · Can edit"', () => {
    const o = { labelOf, now: NOW, roleOf: () => 'owner' };
    expect(menuSubline(peer(1, 'Tereza', { artboard: 'a4' }), o)).toBe('On A4 · plakát · Can edit');
    expect(menuSubline(peer(1, 'Tereza'), { labelOf, now: NOW })).toBe('On this canvas');
  });
});

describe('twelve people on one canvas (co-twelve)', () => {
  const crowd = (): PresencePeer[] => [
    peer(1, 'Tereza', { artboard: 'a4' }),
    peer(2, 'Jonas', { artboard: 'web' }),
    peer(3, 'Petra'),
    peer(4, 'Lukáš'),
    peer(5, 'Klára'),
    peer(6, 'Ondřej'),
    peer(7, 'Vojta', { surface: 'browser' }),
    peer(8, 'Filip', { inComments: true }),
    peer(9, 'Eliška', { idleSince: NOW - 4 * 60_000 }),
    peer(10, 'Radek', { idleSince: NOW - 12 * 60_000 }),
    peer(11, 'Hana', { idleSince: NOW - 25 * 60_000 }),
  ];
  test('three faces and +8; idle people never take a face before an active one', () => {
    const shuffled = [...crowd().slice(8), ...crowd().slice(0, 8)];
    const { shown, more } = collapseFaces(shuffled);
    expect(FACES_SHOWN).toBe(3);
    expect(shown.length).toBe(3);
    expect(more).toBe(8);
    expect(shown.every((p) => p.idleSince == null)).toBe(true);
  });
  test('a small group has no "+N"', () => {
    expect(collapseFaces(crowd().slice(0, 3))).toMatchObject({ more: 0 });
  });
  test('the list: "12 on Combine-kampan · you + 11", idle last, where for each', () => {
    const l = peopleList(crowd(), { labelOf, now: NOW, canvasLabel: 'Combine-kampan' });
    expect(l.heading).toBe('12 on Combine-kampan');
    expect(l.sub).toBe('you + 11');
    expect(l.rows.length).toBe(11);
    expect(l.rows.slice(-3).map((r) => r.where)).toEqual([
      'idle · 4 min',
      'idle · 12 min',
      'idle · 25 min',
    ]);
    expect(l.rows.find((r) => r.name === 'Vojta')?.where).toBe('in a browser');
    expect(l.rows.every((r) => PERSON_TONES.includes(r.tone))).toBe(true);
    expect(peopleList([], { labelOf, now: NOW, canvasLabel: 'X' }).heading).toBe('Just you on X');
  });
});

describe('Follow (co-follow): ends on esc, a scroll or a click', () => {
  const peers = [peer(1, 'Tereza'), peer(2, 'Jonas')];
  test('follow, toggle off, release when the target leaves', () => {
    let s = followPeer(NOT_FOLLOWING, 1);
    expect(s.target).toBe(1);
    expect(toggleFollow(s, 1).target).toBeNull();
    expect(toggleFollow(s, 2).target).toBe(2);
    expect(syncFollow(s, peers, NOW)).toBe(s);
    s = syncFollow(s, [peer(2, 'Jonas')], NOW);
    expect(s.target).toBeNull();
  });
  test('what ends it: esc, wheel, a click outside the pill — not other keys, not the pill', () => {
    expect(endsFollow({ kind: 'key', key: 'Escape' })).toBe(true);
    expect(endsFollow({ kind: 'key', key: 'a' })).toBe(false);
    expect(endsFollow({ kind: 'wheel' })).toBe(true);
    expect(endsFollow({ kind: 'pointer' })).toBe(true);
    expect(endsFollow({ kind: 'pointer', insidePill: true })).toBe(false);
  });
});

describe('Bring everyone here (co-bring / co-spotlight)', () => {
  const ask = (clientID: number, id: string, at: number) =>
    peer(clientID, `P${clientID}`, { summon: { id, at } });
  test('the latest summon.at on a canvas wins; a far-future clock is ignored', () => {
    const w = pickSummon(
      [ask(1, 'aaaaaaaa11', NOW - 3000), ask(2, 'bbbbbbbb22', NOW - 1000), peer(3, 'C')],
      NOW
    );
    expect(w?.clientID).toBe(2);
    expect(pickSummon([ask(1, 'aaaaaaaa11', NOW + 3_600_000)], NOW)).toBeNull();
    expect(pickSummon([peer(1, 'A')], NOW)).toBeNull();
  });
  test('a fresh summon moves me, and Stop (the field cleared) releases me', () => {
    const asked = [ask(1, 'aaaaaaaa11', NOW - 500)];
    const moved = syncFollow(NOT_FOLLOWING, asked, NOW);
    expect(moved).toMatchObject({ target: 1, summonId: 'aaaaaaaa11' });
    expect(syncFollow(moved, asked, NOW + 60_000)).toBe(moved); // still led, however long
    expect(syncFollow(moved, [peer(1, 'P1')], NOW + 1000).target).toBeNull(); // Stop
  });
  test('esc is final for that ask: it is not re-applied, a newer ask moves me again', () => {
    const asked = [ask(1, 'aaaaaaaa11', NOW - 500)];
    const moved = syncFollow(NOT_FOLLOWING, asked, NOW);
    const left = leaveFollow(moved);
    expect(left.target).toBeNull();
    expect(syncFollow(left, asked, NOW + 100)).toBe(left);
    const again = syncFollow(left, [ask(1, 'cccccccc33', NOW + 5000)], NOW + 5100);
    expect(again.target).toBe(1);
  });
  test('an old summon does not pull someone who has only just arrived', () => {
    expect(syncFollow(NOT_FOLLOWING, [ask(1, 'aaaaaaaa11', NOW - 60_000)], NOW)).toBe(
      NOT_FOLLOWING
    );
  });
  test('the spotlight counts who follows me', () => {
    const f = [
      peer(1, 'A', { followTarget: 9 }),
      peer(2, 'B', { followTarget: 9 }),
      peer(3, 'C', { followTarget: 4 }),
    ];
    expect(followersOf(f, 9)).toBe(2);
  });
});

describe('the glide: spring 420 ms, 40 ms apart, nearest first; reduced motion = appear', () => {
  const peers = [
    peer(1, 'Far', { cursor: { x: 900, y: 0 } }),
    peer(2, 'Near', { cursor: { x: 120, y: 100 } }),
    peer(3, 'Mid', { cursor: { x: 400, y: 100 } }),
    peer(4, 'NoCursor'),
  ];
  const landing = { x: 100, y: 100 };
  test('nearest first, 40 ms stagger, 420 ms each, a wake', () => {
    const { steps, totalMs } = glidePlan(peers, landing, false);
    expect(steps.map((s) => s.clientID)).toEqual([4, 2, 3, 1]);
    expect(steps.map((s) => s.delay)).toEqual([0, 40, 80, 120]);
    expect(steps.every((s) => s.duration === 420 && s.wake)).toBe(true);
    expect(totalMs).toBe(120 + 420 + 160);
    expect(totalMs).toBeLessThan(800);
  });
  test('they land around me, not on top of each other', () => {
    const { steps } = glidePlan(peers, landing, false);
    const at = new Set(steps.map((s) => `${s.to.x.toFixed(1)},${s.to.y.toFixed(1)}`));
    expect(at.size).toBe(4);
    for (const s of steps)
      expect(Math.hypot(s.to.x - landing.x, s.to.y - landing.y)).toBeGreaterThan(10);
  });
  test('reduced motion: 1 ms, no stagger, no wake', () => {
    const { steps, totalMs } = glidePlan(peers, landing, true);
    expect(steps.every((s) => s.delay === 0 && s.duration === 1 && !s.wake)).toBe(true);
    expect(totalMs).toBe(1);
  });
});
