// Preloaded into every hub test file (`npm test`): a file that exits before its
// own tests have all finished is a FAILURE, never a shorter green run.
//
// node's test runner reports what a test file TOLD it, and a file whose process
// exits with code 0 part-way through simply stops telling: its remaining suites
// vanish from the totals and the run stays green (2026-09-24: `files-ctl`
// stopped after its fifth suite, 996 of 1,002 tests reported, 0 failures). A
// process killed by a signal already fails; this covers the quiet exit.
//
// Both early exits seen (`files-ctl`, `history`) came at a suite boundary under
// `--test-force-exit`, which the script therefore no longer passes: without it
// the suite reported all tests in every run and nothing hung (2026-09-25).
import { after } from 'node:test';

let finished = false;
after(() => {
  finished = true;
});
process.on('exit', (code) => {
  if (finished || code !== 0) return;
  process.stderr.write(
    `\n[early-exit-guard] ${process.argv[1] ?? 'a test file'} exited before its tests finished — failing it\n`
  );
  process.exitCode = 1;
  process.reallyExit?.(1);
});
