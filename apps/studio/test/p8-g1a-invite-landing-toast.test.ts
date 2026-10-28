// P8 G1a item 3b — S6.11's invite-landing toast, corrected in CONTRACT §3 (lead, 2026-10-28, option A): the app
// knows nobody's gender, so "<who> invited you here — their comment is on <canvas>." Home's invite flow marks
// its landing `via: 'invite'` (Rust OpenTarget keeps it only beside a thread and only from Home); the project
// tab says the inviter by the thread's STORED author, never a name the payload carried. A mention landing (no
// `via`) keeps S1.18's "Opened from <who>'s link — <canvas>.".
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { landingTarget } from '../client/home/invite-flow.js';
import {
  applyShellNavigate,
  invitedHereWords,
  LANDING_SHOT_MS,
  navigatePlan,
} from '../client/shell-events.js';

const A = '.design/ui/poster.tsx';
const deps = (log: unknown[][], author: string | null) => ({
  paths: [A],
  designRel: '.design',
  activePath: null,
  openLinkedFile: (rel: string) => log.push(['open', rel]),
  openTab: () => {},
  frameFor: () => null,
  setPresent: () => {},
  schedule: (fn: () => void) => fn(),
  runAction: (id: string) => log.push(['run', id]),
  toast: (t: string) => log.push(['toast', t]),
  threadAuthor: () => author,
});
const toasts = (log: unknown[][]) => log.filter((l) => l[0] === 'toast').map((l) => l[1]);

describe('the invite-landing toast (S6.11, CONTRACT §3)', () => {
  test('the words, exactly', () => {
    expect(invitedHereWords('Tereza', 'ui/poster.tsx')).toBe(
      'Tereza invited you here — their comment is on poster.'
    );
    expect(invitedHereWords('  Olga Owner ', '.design/ui/Smoke.tsx')).toBe(
      'Olga Owner invited you here — their comment is on Smoke.'
    );
    expect(invitedHereWords(null, 'ui/poster.tsx')).toBeNull();
    expect(invitedHereWords('', 'ui/poster.tsx')).toBeNull();
  });

  test('Home marks an invite landing with a thread; a canvas alone is not one', () => {
    expect(landingTarget({ project: 'p', canvas: 'ui/poster.tsx', thread: 'th_01' })).toEqual({
      canvas: 'ui/poster.tsx',
      thread: 'th_01',
      via: 'invite',
    });
    expect(landingTarget({ project: 'p', canvas: 'ui/poster.tsx' })).toEqual({
      canvas: 'ui/poster.tsx',
    });
  });

  test('a landing via invite says who invited you, by the stored author', () => {
    const log: unknown[][] = [];
    applyShellNavigate(
      { canvas: 'ui/poster.tsx', thread: 'th_01', via: 'invite', from: 'tereza ', name: 'Mallory' },
      deps(log, 'Tereza')
    );
    expect(toasts(log)).toEqual(['Tereza invited you here — their comment is on poster.']);
    expect(JSON.stringify(log)).not.toContain('Mallory');
    expect(LANDING_SHOT_MS).toBeGreaterThan(0);
  });

  // V2-8.9 round B A3 — the owner pointed the invite at SOMEONE ELSE's thread: the toast must not name the
  // thread's author as the inviter (nor show the cloud's name as the author); it is the plain thread landing.
  test('an invite pointed at another person’s thread keeps S1.18, never "<author> invited you"', () => {
    for (const from of ['Olga Owner', undefined]) {
      const log: unknown[][] = [];
      applyShellNavigate(
        { canvas: 'ui/poster.tsx', thread: 'th_01', via: 'invite', ...(from ? { from } : {}) },
        deps(log, 'Tereza')
      );
      expect(toasts(log)).toEqual(["Opened from Tereza's link — poster."]);
      expect(JSON.stringify(log)).not.toContain('Olga');
    }
  });

  test('Home sends the cloud’s inviter name beside the thread only', () => {
    expect(
      landingTarget({ project: 'p', canvas: 'ui/poster.tsx', thread: 'th_01' }, 'Tereza')
    ).toEqual({ canvas: 'ui/poster.tsx', thread: 'th_01', via: 'invite', from: 'Tereza' });
    expect(landingTarget({ project: 'p', canvas: 'ui/poster.tsx' }, 'Tereza')).toEqual({
      canvas: 'ui/poster.tsx',
    });
  });

  test('a mention landing, an unknown via or no stored author keeps S1.18', () => {
    for (const [payload, author, want] of [
      [
        { canvas: 'ui/poster.tsx', thread: 'th_01' },
        'Tereza',
        "Opened from Tereza's link — poster.",
      ],
      [
        { canvas: 'ui/poster.tsx', thread: 'th_01', via: 'mention' },
        'Tereza',
        "Opened from Tereza's link — poster.",
      ],
      [
        { canvas: 'ui/poster.tsx', thread: 'th_01', via: 'invite' },
        null,
        'Opened from a link — poster.',
      ],
    ] as const) {
      const log: unknown[][] = [];
      applyShellNavigate(payload, deps(log, author));
      expect(toasts(log)).toEqual([want]);
    }
    // `via` rides only beside a thread
    expect(
      navigatePlan({ canvas: 'ui/poster.tsx', via: 'invite' }, { paths: [A], designRel: '.design' })
    ).toEqual({ rel: 'ui/poster.tsx', file: A, artboard: null });
  });

  test('Rust keeps via only from Home and only beside a thread (source pin)', () => {
    const rs = readFileSync(
      join(import.meta.dir, '../../desktop/src-tauri/src/windows.rs'),
      'utf8'
    );
    expect(rs).toContain('pub via: Option<String>');
    expect(rs).toContain('via: t.via.clone().filter(|v| v == "invite" && t.thread.is_some())');
    expect(rs).toContain('t.from.as_deref().and_then(clean_from)');
    expect(rs).toContain('target.from = None;');
    expect(rs).toMatch(/validate_target\)\.transpose\(\)\?\.map\(\|t\| via_for\(&caller, t\)\)/);
  });
});
