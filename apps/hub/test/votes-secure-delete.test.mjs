// Ballot secrecy at the storage layer (S4-S9-votes-comments.md §2.6, "after the
// end no surface — hub, studio, backup, export — can tell who picked what").
//
// Deleting the ballot rows is not enough on its own: SQLite leaves a deleted
// row's bytes in the page's free space (and the WAL keeps the frame that wrote
// it), so a copy of `project.sqlite` + `-wal` taken after the end still held
// every voter's picks. The hub store runs `secure_delete = ON` and truncates
// the WAL once a vote's ballots are deleted (`votesEnd`, or a lapsed vote
// ended lazily by any later call).

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { openSqliteProjectStore } from '../src/project-transactions/store-sqlite.mjs';

// Two voters with DIFFERENT picks, so no picks string equals the (public) tally.
const PICKS = [
  { actor: 'vera@x.test', picks: { 'ab:pick-alpha': 2 } },
  { actor: 'max@x.test', picks: { 'ab:pick-beta': 1 } },
];
const PICK_STRINGS = PICKS.map((p) => JSON.stringify(p.picks));

let dataDir;
let store;
let clock = 1_800_000_000_000;

/** Every byte the store keeps on disk: the database and its WAL. */
function diskBytes() {
  const file = store.file;
  return [file, `${file}-wal`]
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f).toString('latin1'))
    .join('\n');
}

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-votes-secure-delete-'));
  store = openSqliteProjectStore(dataDir, { now: () => clock });
});

after(() => {
  store?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function voteWithBallots(canvas, durationS = 60) {
  const started = await store.votesStart({
    project: 'local',
    canvas,
    targets: ['ab:pick-alpha', 'ab:pick-beta'],
    durationS,
    actor: 'olga@x.test',
  });
  assert.ok(started.vote, JSON.stringify(started));
  for (const { actor, picks } of PICKS) {
    const cast = await store.votesCast({ project: 'local', voteId: started.vote.id, actor, picks });
    assert.ok(cast.vote, JSON.stringify(cast));
  }
  const live = diskBytes();
  for (const s of PICK_STRINGS) assert.ok(live.includes(s), `the live ballot ${s} is on disk`);
  return started.vote.id;
}

describe('a deleted ballot leaves no bytes on disk', () => {
  test('votesEnd: no picks string in the db file or the WAL', async () => {
    const voteId = await voteWithBallots('ui/a.tsx');
    const ended = await store.votesEnd({ project: 'local', voteId, actor: 'olga@x.test' });
    assert.deepEqual(ended.vote.tallies, { 'ab:pick-alpha': 2, 'ab:pick-beta': 1 });
    const bytes = diskBytes();
    for (const s of PICK_STRINGS) assert.equal(bytes.includes(s), false, `${s} survived the end`);
  });

  test('a lapsed vote ended lazily by a later read: same', async () => {
    await voteWithBallots('ui/b.tsx', 30);
    clock += 31_000;
    const list = await store.votesList({ project: 'local' });
    assert.ok(list.votes.every((v) => v.state === 'ended'));
    const bytes = diskBytes();
    for (const s of PICK_STRINGS) assert.equal(bytes.includes(s), false, `${s} survived the end`);
  });
});
