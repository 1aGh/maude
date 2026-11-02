// S6.13b fixture — a desktop that relaunches into a refused offline create and is killed
// (SIGKILL, no exit handlers) at one point INSIDE the rename that follows. Used by
// `offline-create-collision-rename.test.ts`.
//
//   bun test/fixtures/create-rename-crash.ts <repoRoot> <hubUrl> <point>
//
// Exits 3 when the point is never reached (the test then fails on the exit code).

import { startPeer } from './sync-peer.ts';

const [repoRoot, hubUrl, point] = process.argv.slice(2);
if (!repoRoot || !hubUrl || !point) process.exit(2);

setTimeout(() => process.exit(3), 60_000);
await startPeer(repoRoot, hubUrl, {
  createRenameFault: (at) => {
    if (at === point) process.kill(process.pid, 'SIGKILL');
  },
});
