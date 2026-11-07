// #164 B3 — "the version before" a run is the row below the OLDEST row of that run, not the row
// just below its newest (contract 164-hash-diff-attribution.md §8). A person's save between two of
// the run's actions, or a run that wrote several versions, made the positional default wrong.

import { afterEach, describe, expect, test } from 'bun:test';

import { fakeStudio, json } from './_fake-studio.ts';

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});

const row = (revision: number, extra: Record<string, unknown>) => ({
  revision,
  actionId: `a${revision}`,
  actor: 'u_michal',
  actorName: 'Michal',
  mine: true,
  kind: 'edit',
  label: 'Edit',
  committedAt: `2026-11-0${Math.min(revision, 9)}T10:00:00.000Z`,
  undoes: null,
  canvases: ['ui/home.tsx'],
  ...extra,
});

// newest first. Run X (chat c1) wrote r9 and r7; a person saved r8 in between; r6 is the state before X.
const rows = [
  row(10, { kind: 'ai', label: 'Claude Code', runId: 'runY' }),
  row(9, { kind: 'ai', label: 'Tighten the hero', runId: 'runX', chatId: 'c1' }),
  row(8, { actor: 'u_tereza', actorName: 'Tereza', mine: false, label: 'Edit annotations' }),
  row(7, { kind: 'ai', label: 'Tighten the hero', runId: 'runX', chatId: 'c1' }),
  row(6, { actor: 'u_tereza', actorName: 'Tereza', mine: false }),
];

const serve = (history = rows) => {
  studio = fakeStudio((s) => {
    if (s.path === '/_api/project/history') return json({ ok: true, history });
    if (s.path === '/_api/project/changes')
      return json({ ok: true, changes: [], detail: [], blame: {} });
    return undefined;
  });
  return studio;
};
const fromOf = (s: NonNullable<typeof studio>) =>
  s.seen.find((x) => x.path === '/_api/project/changes')?.query.from;

describe('history diff — the version before a run', () => {
  test('--run <id> compares from the row below the run’s oldest row, not the row below its newest', async () => {
    const s = serve();
    const r = await s.run('history', ['diff', 'ui/home.tsx', '--run', 'runX']);
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' });
    expect(fromOf(s)).toBe('r6');
  });

  test('--run @mine is this chat’s newest run (MAUDE_CHAT_ID)', async () => {
    const s = serve();
    const r = await s.run('history', ['diff', 'ui/home.tsx', '--run', '@mine'], {
      MAUDE_CHAT_ID: 'c1',
    });
    expect(r.code).toBe(0);
    expect(fromOf(s)).toBe('r6');
  });

  test('without --run the default follows the newest AI row’s run group', async () => {
    const s = serve([rows[1], rows[2], rows[3], rows[4]]);
    const r = await s.run('history', ['diff', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(fromOf(s)).toBe('r6');
  });

  test('a single-row run still compares from the row below it', async () => {
    const s = serve();
    const r = await s.run('history', ['diff', 'ui/home.tsx', '--run', 'runY']);
    expect(r.code).toBe(0);
    expect(fromOf(s)).toBe('r9');
  });

  test('a run that is the oldest row has no earlier version', async () => {
    const s = serve([rows[1], rows[2], rows[3]]);
    const r = await s.run('history', ['diff', 'ui/home.tsx', '--run', 'runX']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('no earlier version');
    expect(s.seen.some((x) => x.path === '/_api/project/changes')).toBe(false);
  });

  test('an unknown run, @mine outside a chat, and --run with --from are refused', async () => {
    const s = serve();
    const none = await s.run('history', ['diff', 'ui/home.tsx', '--run', 'nope']);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('no version by run nope');
    const mine = await s.run('history', ['diff', 'ui/home.tsx', '--run', '@mine'], {
      MAUDE_CHAT_ID: '',
    });
    expect(mine.code).toBe(2);
    expect(mine.stderr).toContain('MAUDE_CHAT_ID');
    const both = await s.run('history', ['diff', 'ui/home.tsx', '--run', 'runX', '--from', 'r2']);
    expect(both.code).toBe(2);
    const bad = await s.run('history', ['diff', 'ui/home.tsx', '--run', 'a b']);
    expect(bad.code).toBe(2);
  });
});

describe('history diff — only this Mac’s own runs are a default target (#164 F3)', () => {
  const teammate = row(11, {
    kind: 'ai',
    label: 'Claude Code',
    runId: 'runT',
    chatId: 'cT',
    actor: 'u_tereza',
    actorName: 'Tereza',
    mine: false,
  });

  test('the default never targets a teammate’s newer AI run', async () => {
    const s = serve([teammate, ...rows]);
    const r = await s.run('history', ['diff', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    // runY (r10, mine) is the newest of this Mac's runs: its from-version is r9
    expect(fromOf(s)).toBe('r9');
  });

  test('--run @mine skips a teammate’s run even in the same chat id', async () => {
    const s = serve([{ ...teammate, chatId: 'c1' }, ...rows]);
    const r = await s.run('history', ['diff', 'ui/home.tsx', '--run', '@mine'], {
      MAUDE_CHAT_ID: 'c1',
    });
    expect(r.code).toBe(0);
    expect(fromOf(s)).toBe('r6');
  });
});

describe('history list — which agent made an AI version', () => {
  test('names Maude chat or Claude Code from the row, and --json exposes runId', async () => {
    const s = serve();
    const r = await s.run('history', ['list', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/r10 .*· AI \(Claude Code\)/);
    expect(r.stdout).toMatch(/r9 .*· AI \(Maude chat\)/);
    expect(r.stdout).not.toMatch(/r8 .*\(Maude chat\)/);
    const j = await s.run('history', ['list', 'ui/home.tsx', '--json']);
    const v = JSON.parse(j.stdout).versions;
    expect(v[1]).toMatchObject({ revision: 9, runId: 'runX', chatId: 'c1' });
  });

  test('a row with neither ids names no agent (older rows)', async () => {
    const s = serve([row(5, { kind: 'ai', label: 'Claude Code' })]);
    const r = await s.run('history', ['list', 'ui/home.tsx']);
    expect(r.stdout).toContain('· AI');
    expect(r.stdout).not.toContain('(Claude Code)');
    expect(r.stdout).not.toContain('(Maude chat)');
  });
});
