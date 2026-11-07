import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import {
  alice,
  type Cell,
  canvasWithArtboards,
  cellOrNull,
  bob as studio,
  eventually,
  read,
} from '../helpers/cell-peers';
import { dismissNotices } from '../helpers/chrome';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 15 Annotations · an-vote — a formal vote between two people with real identities (T2.6c, issue #172).
 *
 * Why a cell: on a local project two browsers vote as the same person, so the count of who has voted — and the rule
 * that nobody sees the others' picks until the end — can only be driven where each person has a session of their own.
 * Bob is the app under test (the designer's copy, linked to the cell as bob); alice is the headless studio the lane
 * started, signed in to the cell as alice, driven through her own `/_api/votes/*` door.
 *
 *   start     ⌘K "Start a vote…" → the sheet (`vote-sheet`): three artboards ticked, the hub secrecy line, Start vote →
 *             the vote bar (`vote-bar`) with the title and "0 done"
 *   secrecy   alice casts: bob's bar says "1 done" and shows WHO (a face), never what; bob's own answer carries no
 *             pick of alice's and no tally; neither the board in bob's copy nor the cell's checkout has a ballot
 *   end       bob casts (through his own door — see below), the bar says "2 done", End vote (the bar's button) → the bar
 *             goes, the counts are the sum of both ballots, and the board carries the result section
 *
 * Not driven by DOM: a person's picks are dots placed on the artboards INSIDE the canvas frame (another origin in the
 * cell lane — see the memory "canvas iframe is unreachable by DOM"), and Cast posts them. Bob's ballot therefore goes
 * through the same door Cast posts to (`POST /_api/votes/ballot` from the shell, as the app's own button does).
 *
 * Preconditions: the cell lane (wdio.an-vote.conf.ts: Node 24 for the hub, a built test app, a stub `claude`), nothing
 * else. WRITTEN, NOT RUN in the T2.6c hand-back — the lead runs it once, alone.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const CANVAS = 'jerseys.tsx';
const FILE = `.design/ui/${CANVAS}`;
const BOARD = '.design/ui-jerseys.annotations.json';

const CELL = cellOrNull();
let voteId = '';

/** Bob's view of the canvas's votes (his session's answer — never anyone else's picks). */
async function bobVotes() {
  const r = await studio('GET', `/_api/votes?file=${encodeURIComponent(FILE)}`);
  expect(r.status).toBe(200);
  return r.body as {
    mode: string;
    me?: string;
    mine: Record<string, Record<string, number>>;
    votes: Array<{
      id: string;
      state: string;
      title?: string;
      done?: string[];
      tallies?: Record<string, number>;
    }>;
  };
}

describe('an-vote (native-desktop) — a vote between two people, secret until the end', () => {
  before(async function () {
    if (!CELL) this.skip();
    startReport('an-vote (native-desktop) — start, secrecy, end between bob and alice on a cell');
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch((error: unknown) =>
      console.warn(`[an-vote] window pin failed: ${String(error)}`)
    );
  });

  it('0 · a canvas of three artboards reaches both people', async () => {
    const c = CELL as Cell;
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-welcome')).waitForDisplayed({ timeout: 120_000 });
    mkdirSync(join(c.designer, '.design', 'ui'), { recursive: true });
    writeFileSync(
      join(c.designer, '.design', 'ui', CANVAS),
      canvasWithArtboards('Helmy', ['a', 'b', 'c'])
    );
    await eventually(
      'the canvas in alice’s copy',
      () => (read(join(c.teammate, '.design', 'ui', CANVAS)) ?? '').includes('Helmy'),
      180_000
    );
    await (await canvasRow('canvas-row-ui-jerseys')).click();
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 60_000 });
    await dismissNotices();
    await capture('00-vote-canvas');
  });

  it('1 · ⌘K "Start a vote…" opens the sheet; three artboards and the hub’s secrecy line; Start vote opens the bar', async () => {
    await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
      );
    });
    const input = await $(tid('palette-input'));
    await input.waitForExist({ timeout: 10_000 });
    await input.setValue('Start a vote');
    const row = await $(tid('palette-row-action:annotations.start-vote'));
    await row.waitForExist({ timeout: 10_000, timeoutMsg: '⌘K has no "Start a vote…" row' });
    await row.click();
    await (await $(tid('vote-sheet'))).waitForExist({
      timeout: 30_000,
      timeoutMsg: 'the sheet never opened (the canvas answers the shell for it)',
    });
    for (const id of ['a', 'b', 'c'])
      await (await $(tid(`vote-sheet-target-${id}`))).waitForExist({ timeout: 10_000 });
    // a hub that keeps ballots says so; the local line ("Anyone who can open this project's files…") is the other mode
    const line = await $(tid('vote-sheet-line'));
    await line.waitForExist({ timeout: 10_000 });
    expect(await line.getText()).toContain('Nobody sees the others’ votes until the end.');
    for (const id of ['a', 'b', 'c']) await (await $(tid(`vote-sheet-target-${id}`))).click();
    await (await $(tid('vote-sheet-title'))).setValue('Helmy');
    await capture('01-vote-sheet');
    await (await $(tid('vote-sheet-start'))).click();

    const bar = await $(tid('vote-bar'));
    await bar.waitForExist({ timeout: 30_000, timeoutMsg: 'no vote bar after Start vote' });
    expect(await bar.getText()).toContain('Helmy');
    expect((await (await $(tid('vote-bar-left'))).getText()).replace(/\s+/g, ' ')).toContain(
      '3 left of your 3'
    );
    expect((await (await $(tid('vote-bar-done'))).getText()).trim()).toBe('0 done');
    expect(await (await $(tid('vote-bar-end'))).isExisting()).toBe(true); // bob started it: editors may end it
    const v = await bobVotes();
    expect(v.mode).toBe('hub');
    expect(v.votes).toHaveLength(1);
    voteId = v.votes[0].id;
    await capture('02-vote-bar-open');
  });

  it('2 · alice casts: bob sees THAT she has voted (a face, "1 done"), never what; no ballot reaches any board', async () => {
    const c = CELL as Cell;
    // alice's studio must know the canvas and the vote (the vote element reaches her board with the sync)
    await eventually(
      'alice’s studio to list the open vote',
      async () => {
        const r = await alice(c, 'GET', `/_api/votes?file=${encodeURIComponent(FILE)}`);
        return (
          r.status === 200 && (r.body?.votes ?? []).some((x: { id: string }) => x.id === voteId)
        );
      },
      120_000
    );
    const cast = await alice(c, 'POST', '/_api/votes/ballot', {
      file: FILE,
      id: voteId,
      picks: { 'ab:a': 2, 'ab:b': 1 },
    });
    expect(cast.status).toBe(200);

    // the bar re-reads every few seconds while a vote is open
    await browser.waitUntil(
      async () => (await (await $(tid('vote-bar-done'))).getText()).trim() === '1 done',
      { timeout: 30_000, interval: 500, timeoutMsg: 'the bar never counted alice’s ballot' }
    );
    const v = await bobVotes();
    const vote = v.votes.find((x) => x.id === voteId);
    expect(vote?.state).toBe('open');
    expect((vote?.done ?? []).some((n) => /alice/i.test(n))).toBe(true); // who, by name
    expect(vote?.tallies).toBeUndefined(); // no counts before the end
    expect(v.mine[voteId]).toBeUndefined(); // bob has not voted: nothing of alice's rides in his answer
    expect(JSON.stringify(v)).not.toContain('"ab:a":2');

    // the secrecy holds in the files too: the board bob's Mac and the cell keep has the vote, not its ballots
    for (const board of [join(c.designer, BOARD), join(c.cellRepo, BOARD)]) {
      const text = read(board);
      if (text === null) continue; // the vote element may not have reached this copy yet; absence cannot leak
      expect(text).not.toContain('"ballot"');
      expect(text).not.toContain('picks');
      expect(text).not.toContain('tallies');
    }
    await capture('03-vote-one-done');
  });

  it('3 · bob casts through the door Cast posts to; End vote ends it: both ballots are counted and the board carries the result', async () => {
    const c = CELL as Cell;
    const cast = await studio('POST', '/_api/votes/ballot', {
      file: FILE,
      id: voteId,
      picks: { 'ab:a': 1, 'ab:c': 1 },
    });
    expect(cast.status).toBe(200);
    await browser.waitUntil(
      async () => (await (await $(tid('vote-bar-done'))).getText()).trim() === '2 done',
      { timeout: 30_000, interval: 500, timeoutMsg: 'the bar never counted bob’s own ballot' }
    );
    // his own dots are his to see: two spent of three
    expect((await (await $(tid('vote-bar-left'))).getText()).replace(/\s+/g, ' ')).toContain(
      '1 left of your 3'
    );
    await capture('04-vote-two-done');

    await (await $(tid('vote-bar-end'))).click();
    await (await $(tid('vote-bar'))).waitForExist({
      reverse: true,
      timeout: 30_000,
      timeoutMsg: 'the bar stayed after End vote',
    });
    const ended = await bobVotes();
    const vote = ended.votes.find((x) => x.id === voteId);
    expect(vote?.state).toBe('ended');
    expect(vote?.tallies).toEqual({ 'ab:a': 3, 'ab:b': 1, 'ab:c': 1 });

    // the result is on the board, and so is the vote's tally — and still no individual ballot
    await eventually(
      'the result in the cell’s checkout',
      () => (read(join(c.cellRepo, BOARD)) ?? '').includes('Vote · Helmy'),
      120_000
    );
    expect(existsSync(join(c.cellRepo, BOARD))).toBe(true);
    expect(read(join(c.cellRepo, BOARD)) ?? '').not.toContain('"ballot"');
    await capture('05-vote-ended');
  });
});
