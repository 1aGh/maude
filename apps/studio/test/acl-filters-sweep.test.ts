// S9.10 — the canary sweep over every route S9.10 filters (studio browser door, like the
// hub's `acl-canary-sweep`). One A-only session reads each answer; none may carry the
// canary planted in B and C (paths, folder names, a DS name, a kind, a comment, commit
// subjects). Each route the OWNER sees the canary on is listed as such, so a filter that
// returns nothing for everyone cannot pass. S9.12 folds this list into the gate sweep.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  A,
  A_ONLY,
  bootCanaryCell,
  type Cell,
  canaries,
  get,
  OWNER,
} from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

/** [route, does the owner's answer carry the canary] */
const ROUTES = (sha: string): Array<[string, boolean]> => [
  ['/_index-data', true],
  ['/_config', true],
  ['/_system-data', true],
  ['/_system-data?ds=shared', false],
  ['/_comments-all', true],
  ['/_api/index', true],
  ['/_api/git/log', true],
  ['/_api/git/log?limit=200', true],
  [`/_api/git/log?path=${encodeURIComponent(A)}`, true],
  [`/_api/git/diff?sha=${sha}`, true],
  ['/_api/git/diff', true],
  ['/_api/project/history', false],
];

describe('S9.10 canary sweep — an A-only session', () => {
  test('no filtered answer carries the canary; the owner’s do', async () => {
    const leaks: Record<string, string[]> = {};
    const vacuous: string[] = [];
    for (const [route, ownerHas] of ROUTES(cell.firstSha)) {
      const r = await get(cell, route, A_ONLY);
      const found = canaries(r.text);
      if (found.length) leaks[route] = found;
      if (ownerHas && canaries((await get(cell, route, OWNER)).text).length === 0)
        vacuous.push(route);
    }
    expect({ leaks, vacuous }).toEqual({ leaks: {}, vacuous: [] });
  });
});
