import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// Controls an EARLIER shard of the same sweep found DEAD (or erroring) and that were fixed fail-first afterwards. The
// shard's JSON still says DEAD, because it ran before the fix; the report lists such a row as `fixed since` with the
// commit and the test that pins it, instead of hiding it or counting it as open. A row only matches while its surface
// AND control match, so a NEW dead control of the same name elsewhere is still DEAD.
export const FIXED_SINCE = [
  {
    control: /^edit-align-(top|vmiddle|bottom)$/,
    commit: 'a36ae02e3',
    what: 'Align top / middles / bottom over artboards that already share the edge now say "Already aligned."',
    test: 'apps/studio/test/artboard-arrange-client.test.tsx › boards already level: Align top says so and commits nothing',
  },
  {
    control: /^(Zoom out|timeline-zoom-fit)$/,
    surface: /timeline-size/,
    commit: 'd6211455a',
    what: 'the timeline’s Zoom out and Fit are greyed with “The whole video already fits” while the video fits',
    test: 'apps/studio/test/p8-timeline-v2-body.test.tsx › at Fit, Zoom out and Fit are greyed with the reason',
  },
  {
    control: 'settings-reset-folds-btn',
    commit: 'd6211455a',
    what: 'Settings › Advanced › Close all Advanced sections answers its click (the button says Closed)',
    test: 'apps/studio/test/v2-s11-13-advanced.test.tsx › Close all Advanced sections answers its click',
  },
];

const hit = (pat, s) => (pat instanceof RegExp ? pat.test(s) : pat === s);

/** The fix that covers this DEAD row, or undefined. */
export function fixedSince(row) {
  return FIXED_SINCE.find(
    (f) =>
      hit(f.control, String(row.control ?? '')) &&
      (!f.surface || hit(f.surface, String(row.surface ?? '')))
  );
}

// Errors an EARLIER shard drew that a later fix removed. A shard records the commit it crawled (`build`, written by
// dead-controls.mjs since p8-sweep-close; older shards have none). An error is excused only when its shard ran
// before the fix: no `build`, or a `build` the fix commit is not an ancestor of. A shard crawled ON the fix that
// still draws the error counts it again — and an unknown commit (a rebase, a shallow clone) excuses nothing.
export const FIXED_ERRORS = [
  {
    text: /^Access to fetch at '[^']*\/_health' from origin '[^']*' has been blocked by CORS policy|^Failed to load resource: net::ERR_FAILED\n\s+at http:\/\/localhost:\d+\/_health:0/,
    commit: '19190861d',
    what: 'the loading cap probes the canvas origin with mode: no-cors (an opaque answer = the listener is up), so it no longer throws on the missing CORS header',
    test: 'apps/studio/test/p8-sweep-close-canvas-probe.test.ts › a live cross-origin canvas listener is "compile", not "server"',
  },
  {
    // the http row with no `answer:` is the same 400 read while the crawler reloaded the page (n1: `<load>`, right
    // after the Hide Frame / re-toggle AA pair; its console twin names /_api/edit-op the same way)
    text: /POST \/_api\/edit-op[\s\S]*One of the objects is not on this canvas|^POST \/_api\/edit-op$|status of 400 \(Bad Request\)\n\s+at http:\/\/localhost:\d+\/_api\/edit-op:0/,
    commit: '07d7af9d5',
    what: 'an edit-op built from the tree of before a stamp follows the stamped id (client/stamp-follow.js), so a second Layers click on a just-stamped object is not refused',
    test: 'apps/studio/test/p8-sweep-close-stamp-follow.test.tsx › Hide, then Show again before the canvas re-posts its tree: the second op names the stamped id',
  },
];

function defaultGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' });
}

/** Was `build` crawled without `commit`? Only git's plain "not an ancestor" (exit 1) says so; anything else is no. */
function predates(build, commit, git) {
  try {
    git(['merge-base', '--is-ancestor', commit, build]);
    return false; // the shard ran on the fix
  } catch (err) {
    return err?.status === 1;
  }
}

/** The fix that excuses this error (its shard was crawled before the fix), or undefined. */
export function fixedError(e, git = defaultGit) {
  const f = FIXED_ERRORS.find((x) => x.text.test(String(e.text ?? '')));
  if (!f) return undefined;
  if (!e.build) return f;
  return predates(e.build, f.commit, git) ? f : undefined;
}
