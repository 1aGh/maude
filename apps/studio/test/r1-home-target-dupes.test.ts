// r1 (Michal rc.1, img 7) — "Starts a new canvas in" listed alligators and StudyFi twice. Not an index bug:
// they are two registered folders each that share one project name — a folder in ~/Maude plus the app's
// own synced copy of the same cloud project, and two repos whose `.design/config.json` both say "StudyFi".
// Each row is a real, different target, so the menu keeps both and tells them apart: a name that occurs
// more than once gets a hint — the synced copy's cloud address, else the folder's own name. And the
// menu must sit above the cards under it (the ask card is the stacking context the menu lives in).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildHomeModel, targetChoices } from '../client/home/home-model.js';

const A = 'l00000000000000a1';
const B = 'l00000000000000b2';
const C = 'l00000000000000c3';
const D = 'l00000000000000d4';
const E = 'l00000000000000e5';

const shell = {
  projects: [
    {
      pid: A,
      root: '/Users/x/Maude/alligators',
      name: 'alligators',
      profile: 'default',
      place: 'tab',
    },
    {
      pid: B,
      root: '/Users/x/Library/Application Support/com.maude.app/projects/alligators.cloud.maude.sh--alligators',
      name: 'alligators',
      profile: 'default',
      place: 'closed',
      hub: 'https://alligators.cloud.maude.sh',
    },
    {
      pid: C,
      root: '/Users/x/git/studyfi/studyfi-design',
      name: 'StudyFi',
      profile: 'default',
      place: 'closed',
    },
    {
      pid: D,
      root: '/Users/x/git/studyfi/AI-StudyMate',
      name: 'StudyFi',
      profile: 'default',
      place: 'closed',
    },
    {
      pid: E,
      root: '/Users/x/Maude/Tralala',
      name: 'Tralala',
      profile: 'default',
      place: 'closed',
    },
  ],
  profiles: [{ id: 'default', label: 'Personal' }],
  recent: [E, A, C, B, D],
};
const index = {
  v: 1,
  projects: [A, B, C, D, E].map((pid) => ({
    pid,
    state: 'ok',
    project: { name: shell.projects.find((p) => p.pid === pid)?.name },
    counts: { canvases: 1 },
    canvases: [],
  })),
};

describe('the target menu tells same-named projects apart', () => {
  const items = targetChoices({
    model: buildHomeModel({ shell, index, clouds: [] }),
    signedIn: false,
    online: true,
  });
  const byPid = (pid: string) => items.find((i) => i.pid === pid);

  test('every registered folder stays a choice — two folders are two targets', () => {
    expect(items.filter((i) => i.kind === 'local').map((i) => i.pid)).toEqual([E, A, C, B, D]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  test('a name that occurs twice gets a hint: the synced copy names its cloud, a folder its own name', () => {
    expect(byPid(A)?.hint).toBe('alligators');
    expect(byPid(B)?.hint).toBe('alligators.cloud.maude.sh');
    expect(byPid(C)?.hint).toBe('studyfi-design');
    expect(byPid(D)?.hint).toBe('AI-StudyMate');
  });

  test('a unique name stays quiet', () => {
    expect(byPid(E)?.hint).toBeNull();
  });

  test('two same-named rows never end with the same hint', () => {
    const named = new Map<string, Set<string>>();
    for (const i of items) {
      if (i.kind !== 'local') continue;
      const s = named.get(i.name) ?? new Set();
      s.add(`${i.hint}`);
      named.set(i.name, s);
    }
    expect(named.get('alligators')?.size).toBe(2);
    expect(named.get('StudyFi')?.size).toBe(2);
  });
});

describe('the target menu sits above the cards under it', () => {
  const css = readFileSync(join(import.meta.dir, '../client/home/home.css'), 'utf8');
  const rule = (sel: string) => {
    const at = css.indexOf(`${sel} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  test('the ask card is positioned and raised: the menu lives in its stacking context (backdrop-filter)', () => {
    const card = rule('.island.home-ask-card');
    expect(card).toMatch(/position:\s*relative/);
    expect(card).toMatch(/z-index:\s*[1-9]/);
  });

  test('…and stays under the sticky header (z-index 10), so scrolled content still slides beneath it', () => {
    const z = Number(/z-index:\s*(\d+)/.exec(rule('.island.home-ask-card'))?.[1]);
    expect(z).toBeLessThan(10);
  });
});

describe('the target menu stays inside the window', () => {
  test('room below: it opens below, no taller than that room', async () => {
    const { menuPlace } = await import('../client/home/TargetChip.jsx');
    expect(menuPlace({ top: 200, bottom: 232 }, 900)).toEqual({ up: false, maxHeight: 320 });
    expect(menuPlace({ top: 200, bottom: 232 }, 500)).toEqual({ up: false, maxHeight: 256 });
  });
  test('no room below and more above: it opens above', async () => {
    const { menuPlace } = await import('../client/home/TargetChip.jsx');
    expect(menuPlace({ top: 700, bottom: 732 }, 800)).toEqual({ up: true, maxHeight: 320 });
  });
});
