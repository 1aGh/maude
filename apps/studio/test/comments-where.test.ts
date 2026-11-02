// S9.22 — where a comment sits, in words (comments/where.ts) and who a thread can @mention
// (comments/people.ts). Canvases 10/co-comment-video ("at 0:12"), 10/co-comment-print ("14 mm from the
// left · 2 mm above the trim"), 10/co-comment-thread ("@Te … Can edit").

import { describe, expect, test } from 'bun:test';
import { committerRows, mentionRows, roleWord } from '../comments/people.ts';
import {
  formatPrintPosition,
  formatVideoTime,
  mmAtArtboardPx,
  trimOfPrint,
  videoChip,
  videoPinVisible,
  whereOf,
} from '../comments/where.ts';

describe('video time', () => {
  test('whole seconds as m:ss, an hour as h:mm:ss', () => {
    expect(formatVideoTime(12)).toBe('0:12');
    expect(formatVideoTime(12.9)).toBe('0:12');
    expect(formatVideoTime(754)).toBe('12:34');
    expect(formatVideoTime(3725)).toBe('1:02:05');
    expect(formatVideoTime(-3)).toBe('0:00');
    expect(videoChip(12)).toBe('at 0:12');
  });

  test('a pin shows near its moment only; an unknown playhead keeps it', () => {
    expect(videoPinVisible(12, 12)).toBe(true);
    expect(videoPinVisible(12, 12.4)).toBe(true);
    expect(videoPinVisible(12, 13)).toBe(false);
    expect(videoPinVisible(12, 0)).toBe(false);
    expect(videoPinVisible(12, null)).toBe(true);
    expect(videoPinVisible(12, undefined)).toBe(true);
    expect(videoPinVisible(12, Number.NaN)).toBe(true);
  });
});

describe('print position', () => {
  const A4 = { wMm: 210, hMm: 297 };

  test('names the nearer side of each axis, the way the canvas says it', () => {
    expect(formatPrintPosition({ x: 14, y: 295 }, A4)).toBe(
      '14 mm from the left · 2 mm above the trim'
    );
    expect(formatPrintPosition({ x: 200, y: 10 }, A4)).toBe(
      '10 mm from the right · 10 mm from the top'
    );
  });

  test('without a trim it measures from the left and the top', () => {
    expect(formatPrintPosition({ x: 14, y: 2 })).toBe('14 mm from the left · 2 mm from the top');
  });

  test('a point in the bleed says so instead of a misleading number', () => {
    expect(formatPrintPosition({ x: -2, y: 40 }, A4)).toBe('In the bleed');
    expect(formatPrintPosition({ x: 100, y: 300 }, A4)).toBe('In the bleed');
  });

  test('trim size and pixel → mm come from the artboard print prop (A4 portrait, 3 mm bleed)', () => {
    expect(trimOfPrint({ paper: 'a4' })).toEqual({ wMm: 210, hMm: 297 });
    expect(trimOfPrint({ paper: 'a4', orientation: 'landscape' })).toEqual({ wMm: 297, hMm: 210 });
    expect(trimOfPrint({ paper: 'nope' })).toBeNull();
    expect(trimOfPrint(null)).toBeNull();
    // 96 dpi: 3 mm bleed = 11 px (rounded); the trim corner is one bleed in.
    expect(mmAtArtboardPx({ paper: 'a4' }, { x: 11, y: 11 })).toEqual({ x: 0, y: 0 });
    const p = mmAtArtboardPx({ paper: 'a4' }, { x: 11 + 96, y: 11 + 192 });
    expect(p).toEqual({ x: 25.4, y: 50.8 });
    expect(mmAtArtboardPx({ paper: 'nope' }, { x: 1, y: 1 })).toBeNull();
  });

  test('whereOf: a moment wins over a point, an artboard alone has no chip', () => {
    expect(whereOf({ artboard: 'r', t: 12 })).toEqual({
      artboard: 'r',
      chip: 'at 0:12',
      kind: 'video',
    });
    expect(whereOf({ artboard: 'a', mm: { x: 14, y: 2 } }).kind).toBe('print');
    expect(whereOf({ artboard: 'a' })).toEqual({ artboard: 'a', chip: null, kind: 'artboard' });
    expect(whereOf({})).toEqual({ artboard: null, chip: null, kind: 'canvas' });
  });
});

describe('mention people', () => {
  const answer = [
    { id: 'u1', name: 'Tereza Novak', role: 'member', email: 'tereza@alligators.cz' },
    { id: 'u2', name: 'Jonas Beran', role: 'viewer' },
    { id: 'u3', name: 'Michal Dovrtel', role: 'owner' },
    { id: 'u4', name: 'Petra', role: 'observer' },
    {
      id: 'inv_1',
      name: 'pending@example.com',
      role: 'member',
      state: 'invited',
      email: 'pending@example.com',
    },
    { id: 'req_1', name: 'Asker', role: 'viewer', state: 'requested' },
    { id: 'u5', name: '   ' },
    null,
  ];

  test('names and role words only: no e-mail, no pending invitation or request, not yourself', () => {
    const rows = mentionRows(answer, 'Michal Dovrtel');
    expect(rows).toEqual([
      { id: 'u1', name: 'Tereza Novak', role: 'Can edit' },
      { id: 'u2', name: 'Jonas Beran', role: 'Can comment' },
      { id: 'u4', name: 'Petra', role: 'Can view' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('@');
  });

  test('role words are the product words, never viewer/member', () => {
    expect(roleWord('owner')).toBe('Owner');
    expect(roleWord('member')).toBe('Can edit');
    expect(roleWord('viewer')).toBe('Can comment');
    expect(roleWord('observer')).toBe('Can view');
    expect(roleWord('admin')).toBeUndefined();
    expect(roleWord('toString')).toBeUndefined();
  });

  test('a non-array and a duplicate id are harmless', () => {
    expect(mentionRows({ people: [] })).toEqual([]);
    expect(
      mentionRows([
        { id: 'a', name: 'Ada' },
        { id: 'a', name: 'Ada again' },
      ])
    ).toEqual([{ id: 'a', name: 'Ada' }]);
  });

  test('git committers (a local project) come through as names with no role and no address', () => {
    const rows = committerRows(
      [{ name: 'Lin Park', email: 'lin@x.io', commits: 4 }, { name: 'Me' }],
      'Me'
    );
    expect(rows).toEqual([{ id: 'Lin Park', name: 'Lin Park' }]);
  });
});
