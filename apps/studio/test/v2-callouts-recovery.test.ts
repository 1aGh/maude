// S11.17 (C37) — the two recovery callouts, word for word (CONTRACT §6 "Errors & recovery"):
//   after a crash  "Maude quit unexpectedly. Your work up to 14:05 is here." + Report a bug…
//   a full disk    Not saved + "This Mac is out of space — changes wait here until there's room." + Show in Finder
// and their place in the stack (errors first), plus the status word the Share cluster shows meanwhile.

import { describe, expect, test } from 'bun:test';

import {
  CRASH_LINE,
  calloutStack,
  crashedCallout,
  diskFullCallout,
  workTime,
} from '../client/v2/shell/callouts-model.js';
import { DISK_FULL_DETAIL, saveStatus } from '../client/v2/shell/save-status.js';

/** Local-time instant (the line speaks the person's clock). */
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 20, 16, 30);

describe('workTime', () => {
  test('today: the clock time; another day: the day too; nothing known: null', () => {
    expect(workTime(at(2026, 10, 20, 14, 5), NOW)).toBe('14:05');
    expect(workTime(at(2026, 10, 20, 9, 0), NOW)).toBe('09:00');
    expect(workTime(at(2026, 10, 18, 23, 41), NOW)).toBe('Oct 18, 23:41');
    expect(workTime(null, NOW)).toBeNull();
    expect(workTime(Number.NaN, NOW)).toBeNull();
  });
});

describe('the crash callout', () => {
  const notice = { kind: 'app://crashed', startedAt: at(2026, 10, 20, 8, 0) };

  test('golden: the one line + Report a bug…', () => {
    expect(crashedCallout(notice, at(2026, 10, 20, 14, 5), NOW)).toEqual({
      key: `crashed:${notice.startedAt}`,
      kind: 'crashed',
      tone: 'warn',
      icon: 'problem',
      title: 'Maude quit unexpectedly. Your work up to 14:05 is here.',
      action: { id: 'report-bug', label: 'Report a bug…' },
    });
  });

  test('no time known: the line without one', () => {
    expect(crashedCallout(notice, null, NOW)?.title).toBe(
      'Maude quit unexpectedly. Your work is here.'
    );
    expect(CRASH_LINE(null)).toBe('Maude quit unexpectedly. Your work is here.');
  });

  test('no notice (a clean quit, a browser tab): nothing', () => {
    expect(crashedCallout(null, NOW, NOW)).toBeNull();
    expect(crashedCallout({ kind: 'other' }, NOW, NOW)).toBeNull();
  });
});

describe('the full-disk callout', () => {
  test('golden: Not saved + the sentence + Show in Finder (the desktop app)', () => {
    expect(diskFullCallout({ full: true, held: 2, since: 99 }, { native: true })).toEqual({
      key: 'disk-full:99',
      kind: 'disk-full',
      tone: 'error',
      icon: 'problem',
      title: 'Not saved',
      detail: "This Mac is out of space — changes wait here until there's room.",
      action: { id: 'show-in-finder', label: 'Show in Finder' },
    });
    expect(diskFullCallout({ full: true, held: 1, since: 99 })?.detail).toBe(DISK_FULL_DETAIL);
  });

  test('a browser tab has no Finder: the callout carries no action', () => {
    expect(diskFullCallout({ full: true, held: 1, since: 99 }, { native: false })?.action).toBe(
      undefined
    );
  });

  test('room again (or never full): nothing', () => {
    expect(diskFullCallout({ full: false, held: 0, since: null })).toBeNull();
    expect(diskFullCallout(null)).toBeNull();
  });
});

describe('in the stack', () => {
  test('the full disk (error) before the crash line (warn) before the news', () => {
    const items = calloutStack({
      updateReady: { version: '2.0.0' },
      crashed: { notice: { kind: 'app://crashed', startedAt: 1 }, lastWorkAt: null, now: NOW },
      disk: { full: true, held: 1, since: 5 },
      native: true,
    });
    expect(items.map((c) => c.kind)).toEqual(['disk-full', 'crashed', 'update']);
  });

  test('a closed crash line stays closed; a new full-disk spell comes back', () => {
    const dismissed = new Set(['crashed:1', 'disk-full:5']);
    const crashed = { notice: { kind: 'app://crashed', startedAt: 1 }, lastWorkAt: null, now: NOW };
    expect(calloutStack({ crashed, disk: { full: true, held: 1, since: 5 }, dismissed })).toEqual(
      []
    );
    expect(
      calloutStack({ crashed, disk: { full: true, held: 1, since: 6 }, dismissed }).map(
        (c) => c.key
      )
    ).toEqual(['disk-full:6']);
  });
});

describe('the status word meanwhile', () => {
  test('a full disk: Not saved, the sentence, Retry + Show in Finder — even on a linked project', () => {
    const s = saveStatus({ linked: true, phase: 'synced', writeFailed: { kind: 'disk-full' } });
    expect([s.kind, s.word, s.detail, s.actions.map((a) => a.id)]).toEqual([
      'not-saved',
      'Not saved',
      DISK_FULL_DETAIL,
      ['retry', 'show-in-finder'],
    ]);
    // room again: back to Saved
    expect(saveStatus({ linked: true, phase: 'synced', writeFailed: null }).word).toBe('Saved');
  });
});
