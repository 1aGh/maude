// home-shared-model — S6.4: "Shared with you" rows from the cloud listings (V2-1.1 §5.7) and its
// "3 new this week" count (rows granted in the last 7 days that were not opened on this Mac).
// Also the account face (a person's circle, never a project's square) for Projects by account.

import { describe, expect, test } from 'bun:test';

import { accountFace, newThisWeek, sharedAside, sharedRows } from '../client/home/home-model.js';

// local noon, so "1 h ago" is the same calendar day in every time zone
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();
const H = 3_600_000;
const D = 24 * H;

const listing = (profile: string, shared: unknown[], signedIn = true) => ({
  ok: true,
  profile,
  signedIn,
  account: { email: `${profile}@x.cz` },
  projects: [],
  shared,
});
const share = (over: Record<string, unknown>) => ({
  projectId: 'nabor',
  projectName: 'Nábor 2027',
  ownerName: 'Tereza',
  canvas: { path: 'ui/web/Mapa.tsx', name: 'Mapa-areálu' },
  role: 'viewer',
  grantedAt: NOW - H,
  grantedBy: 'Tereza',
  ...over,
});

describe('sharedRows', () => {
  test('flattens every signed-in profile, newest grant first, in the people words', () => {
    const rows = sharedRows(
      [
        listing('work', [
          share({ grantedAt: NOW - 3 * D, role: 'observer' }),
          share({
            projectId: 'liga',
            projectName: 'Liga ČAAF 2027',
            ownerName: 'Jonas',
            role: 'member',
            grantedAt: NOW - H,
          }),
        ]),
        listing('gone', [share({ projectId: 'x' })], false),
      ],
      NOW
    );
    expect(rows.map((r: { projectId: string }) => r.projectId)).toEqual(['liga', 'nabor']);
    expect(rows[0].roleWord).toBe('Can edit');
    expect(rows[1].roleWord).toBe('Can view');
    expect(rows[0].meta).toBe("Liga ČAAF 2027 · Jonas's · 1 h ago");
    expect(rows[0].profile).toBe('work');
  });

  test('a project-level share is named by its project; a canvas share by its canvas', () => {
    const [a, b] = sharedRows(
      [
        listing('work', [
          share({ canvas: null, grantedAt: NOW - 2 * H }),
          share({ grantedAt: NOW - 5 * H }),
        ]),
      ],
      NOW
    );
    expect(a.title).toBe('Nábor 2027');
    expect(b.title).toBe('Mapa-areálu');
  });

  test('no owner name: the line has no possessive', () => {
    const [r] = sharedRows([listing('work', [share({ ownerName: null })])], NOW);
    expect(r.meta).toBe('Nábor 2027 · 1 h ago');
  });

  test('nothing signed in, nothing shared: no rows', () => {
    expect(sharedRows([], NOW)).toEqual([]);
    expect(sharedRows([listing('a', [])], NOW)).toEqual([]);
  });
});

describe('newThisWeek', () => {
  const rows = () =>
    sharedRows(
      [
        listing('work', [
          share({ projectId: 'a', grantedAt: NOW - H }),
          share({ projectId: 'b', grantedAt: NOW - 6 * D }),
          share({ projectId: 'c', grantedAt: NOW - 8 * D }),
        ]),
      ],
      NOW
    );

  test('counts grants from the last 7 days', () => {
    expect(newThisWeek(rows(), new Set(), NOW)).toBe(2);
  });

  test('a row opened on this Mac is not new', () => {
    const r = rows();
    expect(newThisWeek(r, new Set([r[0].key]), NOW)).toBe(1);
  });

  test('the shelf aside says so, or nothing when none are new', () => {
    expect(sharedAside(2)).toBe("canvases from other people's projects · 2 new this week");
    expect(sharedAside(0)).toBe("canvases from other people's projects");
  });
});

describe('accountFace', () => {
  test('is the first letter of the account, and a tone that stays put for that account', () => {
    const a = accountFace({ id: 'work', label: 'Work', email: 'me@work-studio.cz' });
    expect(a.initial).toBe('W');
    expect(a.tone).toBe(
      accountFace({ id: 'work', label: 'Work', email: 'me@work-studio.cz' }).tone
    );
  });
  test('falls back to the e-mail, then to a dot', () => {
    expect(accountFace({ id: 'p', label: '', email: 'tereza@x.cz' }).initial).toBe('T');
    expect(accountFace({ id: 'p', label: '', email: null }).initial).toBe('·');
  });
});
