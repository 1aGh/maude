// Internal shim behind smoke.sh and `maude design status` — issue #158: the files a linked canvas
// uses that will not reach the workspace, each with the reason. Read-only; disk only.
//
//   bun _unsynced-refs.mjs --design-root <dir> [--json]
//
// Default output is the terminal lines (`sync/unsynced-refs.ts` `unsyncedLines`); nothing at all (exit 0)
// for an unlinked project or a clean one. `--json` prints the whole report plus its `lines` (the same
// terminal lines, for a caller that cannot load TypeScript). Advisory: the exit code is 0 whatever it
// finds, 2 on bad arguments.
import { unsyncedLines, unsyncedRefsOnDisk } from '../sync/unsynced-refs.ts';

const argv = process.argv.slice(2);
const at = argv.indexOf('--design-root');
const root = at >= 0 ? argv[at + 1] : undefined;
if (!root) {
  process.stderr.write('usage: _unsynced-refs.mjs --design-root <dir> [--json]\n');
  process.exit(2);
}
const report = unsyncedRefsOnDisk(root);
const lines = unsyncedLines(report);
if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ ...report, lines })}\n`);
else for (const line of lines) process.stdout.write(`${line}\n`);
