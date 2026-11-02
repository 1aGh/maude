// p8-fix-d F20 — Version history on a project whose history is the op log (a hub-linked project, and
// the local home too: both answer `/_api/project/history`).
//
//   diff  — `maude design history diff <canvas>` answered "not diffable from here yet". It now asks
//           the panel's own question (`GET /_api/project/changes`, V2-1.9 §5.11 "the words"):
//           from the version before the canvas's newest (or `--from`), to now (or `--to`).
//   who   — a terminal AI run's prompt stays on this Mac on purpose, so its action carries the stage's
//           placeholder label ("Claude Code"). That is no prompt: Version history titles the row by
//           its words and the verb prints "<person> · AI" — CONTRACT §3 (AI, never "Claude").
//           A person's row names the person (the studio's own name lookup), not an actor id.

import { afterEach, describe, expect, test } from 'bun:test';

import { fold, initialState, view } from '../client/v2/undo/projection.js';
import { promptOfRun } from '../history/run-label.ts';
import { toRowVersion } from '../history/versions.ts';
import { fakeStudio, json } from './_fake-studio.ts';

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});

const rows = [
  {
    revision: 7,
    actionId: 'a7',
    actor: 'u_tereza',
    actorName: 'Tereza',
    mine: false,
    kind: 'edit',
    label: 'Edit annotations',
    committedAt: '2026-10-29T10:00:00.000Z',
    undoes: null,
    canvases: ['ui/home.tsx'],
  },
  {
    revision: 5,
    actionId: 'a5',
    actor: 'u_michal',
    actorName: 'Michal',
    mine: true,
    kind: 'ai',
    label: 'Claude Code',
    committedAt: '2026-10-29T09:00:00.000Z',
    undoes: null,
    canvases: ['ui/home.tsx'],
  },
];

describe('history diff on an op-log project', () => {
  test('asks for the words from the version before the newest to now, and prints them', async () => {
    studio = fakeStudio((s) => {
      if (s.path === '/_api/project/history') return json({ ok: true, history: rows });
      if (s.path === '/_api/project/changes')
        return json({
          ok: true,
          changes: [
            {
              artboards: ['hero'],
              grade: 'major',
              kind: 'changed',
              words: 'Headline: “Hi” → “Hello”',
            },
            { artboards: [], grade: 'minor', kind: 'added', words: 'Added a sticky' },
          ],
          detail: [],
          blame: {},
        });
      return undefined;
    });
    const r = await studio.run('history', ['diff', 'ui/home.tsx']);
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' });
    const asked = studio.seen.find((s) => s.path === '/_api/project/changes');
    expect(asked?.query).toEqual({ path: '.design/ui/home.tsx', from: 'r5', to: 'now' });
    expect(r.stdout).toContain('hero  Headline: “Hi” → “Hello”');
    expect(r.stdout).toContain('Added a sticky');
  });

  test('--from / --to are passed through; --json carries the changes', async () => {
    studio = fakeStudio((s) => {
      if (s.path === '/_api/project/history') return json({ ok: true, history: rows });
      if (s.path === '/_api/project/changes')
        return json({ ok: true, changes: [], detail: [], blame: {} });
      return undefined;
    });
    const r = await studio.run('history', [
      'diff',
      'ui/home.tsx',
      '--from',
      'r2',
      '--to',
      'r7',
      '--json',
    ]);
    expect(r.code).toBe(0);
    const asked = studio.seen.find((s) => s.path === '/_api/project/changes');
    expect(asked?.query).toEqual({ path: '.design/ui/home.tsx', from: 'r2', to: 'r7' });
    expect(JSON.parse(r.stdout)).toMatchObject({
      kind: 'synced',
      from: 'r2',
      to: 'r7',
      changes: [],
    });
  });

  test('without a canvas it says which canvas to name; a bad ref is a usage error', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/project/history' ? json({ ok: true, history: rows }) : undefined
    );
    const none = await studio.run('history', ['diff']);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('<canvas>');
    const bad = await studio.run('history', ['diff', 'ui/home.tsx', '--from', 'yesterday']);
    expect(bad.code).toBe(2);
    expect(studio.seen.some((s) => s.path === '/_api/project/changes')).toBe(false);
  });
});

describe('history rows name the person and the AI', () => {
  test('list prints the person’s name and "· AI" for a run, never "Claude Code"', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/project/history' ? json({ ok: true, history: rows }) : undefined
    );
    const r = await studio.run('history', ['list', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Tereza  edit  Edit annotations');
    expect(r.stdout).toContain('Michal (you) · AI');
    expect(r.stdout).not.toContain('Claude Code');
    expect(r.stdout).not.toContain('u_tereza');
  });

  test('the placeholder label of a prompt-less run is no prompt', () => {
    expect(promptOfRun('Claude Code')).toBeUndefined();
    expect(promptOfRun('AI')).toBeUndefined();
    expect(promptOfRun('  ')).toBeUndefined();
    expect(promptOfRun(null)).toBeUndefined();
    expect(promptOfRun('Make the footer calmer')).toBe('Make the footer calmer');
    const v = toRowVersion(
      { ...rows[1], committedAt: 1, label: 'Claude Code' } as never,
      'ui/home.tsx'
    );
    expect(v.prompt).toBeUndefined();
    const w = toRowVersion(
      { ...rows[1], committedAt: 1, label: 'Make the footer calmer' } as never,
      'ui/home.tsx'
    );
    expect(w.prompt).toBe('Make the footer calmer');
  });

  test('the ⌘Z stack calls a prompt-less run "AI edit", not "Claude Code"', () => {
    const s0 = initialState({ canvas: 'ui/home.tsx', openedAt: 0 });
    const s1 = fold(s0, [
      {
        type: 'action',
        action: {
          actionId: 'a5',
          mine: true,
          kind: 'ai',
          label: 'Claude Code',
          madeAt: 10,
          revision: 5,
          canvases: ['ui/home.tsx'],
        },
      },
    ]);
    expect(view(s1).entries.map((e: { label: string }) => e.label)).toEqual(['AI edit']);
  });
});
