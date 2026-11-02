// The cell's history, readable from outside it — feature-cloud-managed-git-posture.
//
// WHY THIS EXISTS. When a desktop folder is linked + credentialed to Maude
// Cloud, the cell is the sole committer (DDR-198/209/213) and DDR-218 withdrew
// the desktop's working-tree save surface. What it did NOT do was repoint the
// History tab, which went on reading the LOCAL repo — a repo nobody ever
// commits to in that posture. The panel therefore said "Cloud is saving" and
// "No saved versions yet" in the same breath: both true about different repos,
// and together indistinguishable from "nothing is being saved."
//
// These two routes are the other half. The desktop asks the cell for the
// history the cell is actually writing, server-side, with the hub credential
// the link flow already stored.
//
// ── WHAT IS UNTRUSTED HERE ───────────────────────────────────────────────────
// Both parameters. `sha` reaches the desktop's version-preview route from the
// UNTRUSTED canvas origin (DDR-054), so it is anchored to a hex object name and
// can never be a ref EXPRESSION (`HEAD~3`, `a..b`, `x:y`) — a ref expression is
// how a "read one blob" route becomes "walk anywhere in the object graph".
// `path` is containment-checked AND membership-checked, so a traversal, a
// runtime-state path (DDR-115) or `config.json` is refused the same way an
// absent file is.
//
// ── NO ORACLE ────────────────────────────────────────────────────────────────
// Every refusal past the token check is `404 not found` — out of scope, out of
// tree, malformed, wrong class and simply absent are ONE answer. That is the
// `PROJECT_FILE_PREFIX` route's posture and the reason it can be reached by
// anyone holding a project token without becoming a filesystem probe.
//
// ── IN NEITHER CANVAS ALLOWLIST ──────────────────────────────────────────────
// Registered in `server.mjs` behind `!(studioProxy && isCanvasHost(request))`.
// DDR-088's rule is that a privileged route is reachable from NEITHER
// allowlist — "it would 401 anyway" is the kind of reasoning that stops being
// true one refactor later.

import { basename, dirname, relative, resolve, sep } from 'node:path';

import { gitLogArgs, gitLogEnv, parseGitLog } from '../../studio/git/log-format.ts';
import {
  changedSubject,
  historyAllows,
  NOT_IN_SCOPE_REFUSAL,
  pathScope,
  peerAccess,
} from './access-docs.mjs';
import { readCanvasGroups } from './file-manifest.mjs';
import { classifyProjectFile } from './file-membership.mjs';
import { isContainedReal, realpathOfDeepestExisting } from './path-contain.mjs';

/** The route family. Both members are privileged (main origin only). */
export const HISTORY_PATH = '/api/history';
export const HISTORY_FILE_PATH = '/api/history/file';

/** A git OBJECT NAME, never an expression. Anchored end to end on purpose. */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/** How many commits one page may carry. */
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 40;

/** Hard ceiling on one historical blob. A canvas body is kilobytes. */
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

/**
 * The extensions this route will hand back.
 *
 * It answers `text/plain`, and a string-captured subprocess is lossy over
 * binary — so rather than serve a mangled PNG, it serves no PNG. Membership
 * (`classifyProjectFile`) still decides ADMISSION; this is the narrower
 * question of what the response shape can honestly carry.
 */
const TEXT_EXTS = new Set(['tsx', 'ts', 'jsx', 'js', 'mjs', 'css', 'md', 'json', 'svg', 'srt']);

/**
 * A document name no scope can ever match — the wildcard probe.
 *
 * The repo-wide log cannot be filtered per-commit the way the journal filters
 * per-entry, so a token bound to one namespace must not read it. Asking
 * `matchesScope` about a name nothing can prefix-match is how we ask "is this
 * token unscoped?" through the REAL scope function instead of re-typing its
 * wildcard rule here (which is how the two come to disagree).
 *
 * WRITTEN AS AN ESCAPE, NEVER AS A RAW BYTE. A literal NUL in the source makes
 * git treat this whole file as BINARY — no diffs, no reviewable change, and no
 * line-level merge in a tree where concurrent sessions edit the same files.
 * That is exactly what happened when this constant first landed, and it went
 * unnoticed because every grep for the file's contents still succeeded.
 *
 * WHY NUL AND NOT A SPACE: `SCOPE_REGEX` (`tokens.mjs`) is
 * /^[A-Za-z0-9._/-]{1,128}$/, so BOTH are unmatchable and either would work.
 * NUL is the one a future reader cannot mistake for a value somebody meant to
 * type, and cannot silently "tidy up" out of existence.
 */
const IMPOSSIBLE_DOC = '\u0000';

/**
 * Handle the history routes. Returns true when handled.
 *
 * @param {object} ctx
 * @param {string} ctx.path                     request pathname (auth-normalized)
 * @param {string} ctx.method
 * @param {Record<string,string>} ctx.query
 * @param {string|null} ctx.bearer
 * @param {(token: string) => ({scope?: string, label?: string}|null)} ctx.verify
 * @param {(scope: string|undefined, name: string) => boolean} ctx.matchesScope
 * @param {string|null} ctx.repoDir             the checkout, or null on a non-workspace hub
 * @param {string|null} ctx.designRoot          absolute design root inside the checkout
 * @param {((args: string[], o: {cwd: string, env?: Record<string,string>}) => Promise<{code:number,stdout:string,stderr:string}>)|null} ctx.run
 * @param {string|null} [ctx.projectName]       what the cell calls this project
 * @param {(label: string) => boolean} [ctx.checkRateLimit]
 * @param {(status: number, payload: unknown) => void} ctx.respondJson
 * @param {import('node:http').ServerResponse} [ctx.response]  needed only by the blob route
 */
export async function handleHistoryRoutes(ctx) {
  const { path, method, bearer, verify, respondJson } = ctx;
  const isLog = path === HISTORY_PATH;
  const isFile = path === HISTORY_FILE_PATH;
  if (!isLog && !isFile) return false;

  // Read-only BY CONSTRUCTION — the method gate precedes everything else, so
  // neither route can grow a write half by accident.
  if (method !== 'GET') {
    respondJson(405, { error: 'method not allowed' });
    return true;
  }

  const match = bearer ? verify(bearer) : null;
  if (!match) {
    respondJson(401, { error: 'a project token is required to read history' });
    return true;
  }
  // Budgeted immediately after auth, like the journal — everything below can
  // spawn git, and an authenticated caller is exactly who can afford to spray.
  if (ctx.checkRateLimit && !ctx.checkRateLimit(match.label)) {
    respondJson(429, { error: 'too many history reads' });
    return true;
  }

  // A hub with no checkout has no history. EMPTY, never an error — an
  // old-style hub answers a capability-gated client harmlessly. The blob route
  // has no empty answer, so it is the one 404 that is not about the argument.
  const repoDir = ctx.repoDir || null;
  const designRoot = ctx.designRoot || null;
  const run = ctx.run || null;
  if (!repoDir || !designRoot || !run) {
    if (isLog) respondJson(200, { entries: [], branch: null, project: null });
    else refuseFile(ctx);
    return true;
  }

  return isLog
    ? await handleLog(ctx, match, repoDir, designRoot, run)
    : await handleFile(ctx, match, repoDir, designRoot, run);
}

/** The blob route's ONE refusal — indistinguishable for every reason. */
function refuseFile(ctx) {
  if (ctx.response) respondText(ctx.response, 404, 'not found', 'text/plain; charset=utf-8');
  else ctx.respondJson(404, { error: 'not found' });
  return true;
}

/** `GET /api/history?path=&limit=` — the commit rows a History tab draws. */
async function handleLog(ctx, match, repoDir, designRoot, run) {
  const { query, matchesScope, respondJson } = ctx;
  const limit = clampLimit(query?.limit);

  const rawPath = typeof query?.path === 'string' && query.path !== '' ? query.path : null;
  // V2-1.16 L6 (S9.5): a canvas-only session must name a VISIBLE path. No
  // path, an invisible one and a missing one all get the one U1 answer.
  const peer = peerAccess(match);
  const canvasOnly = peer?.access.role === null;
  let repoRel;
  let visibleRel = null;
  if (canvasOnly) {
    const admitted =
      rawPath === null ? null : admitDesignPath(rawPath, designRoot, { requireText: false });
    if (
      !admitted ||
      !matchesScope(match.scope, admitted.rel) ||
      !historyAllows(peer, admitted.rel, 'read')
    ) {
      respondJson(403, { ...NOT_IN_SCOPE_REFUSAL });
      return true;
    }
    visibleRel = admitted.rel;
    repoRel = toRepoRel(repoDir, designRoot, admitted.rel);
  } else if (rawPath === null) {
    // The repo-wide log carries commits touching paths this token may not be
    // allowed to name, and unlike the journal there is no per-row filter that
    // could make it safe. Only an unscoped token reads it.
    if (!matchesScope(match.scope, IMPOSSIBLE_DOC)) {
      respondJson(404, { error: 'not found' });
      return true;
    }
  } else {
    const admitted = admitDesignPath(rawPath, designRoot, { requireText: false });
    if (!admitted || !matchesScope(match.scope, admitted.rel)) {
      respondJson(404, { error: 'not found' });
      return true;
    }
    repoRel = toRepoRel(repoDir, designRoot, admitted.rel);
  }

  // The GIT_LITERAL_PATHSPECS half of the scoped-argv pair — it travels with
  // `gitLogArgs`, out of the same module, so a call site cannot pick up one
  // half of the hardening and not the other. The runner merges it over its own
  // base env for THIS invocation only.
  const r = await run(gitLogArgs(limit, repoRel), { cwd: repoDir, env: gitLogEnv(repoRel) });
  // A failed log is an EMPTY history, not a 500: a fresh cell with no commits
  // yet is the common case, and the difference is not the caller's business.
  const parsed = r.code === 0 ? parseGitLog(r.stdout) : [];

  // `email` is deliberately dropped. The row renderer shows `author` and the
  // short sha and nothing else, and a member's address is not needed to draw a
  // row — so it does not leave the cell.
  //
  // U4 (canvas-only): the subject can name other canvases ("design: update 2
  // canvases", a manual message), so it is rewritten from the visible path.
  const scopedSubject = visibleRel
    ? changedSubject([pathScope(peer, visibleRel).canvas ?? visibleRel])
    : null;
  const entries = parsed.map((e) => ({
    sha: e.sha,
    message: scopedSubject ?? e.message,
    author: e.author,
    date: e.date,
  }));

  respondJson(200, {
    entries,
    branch: await currentBranch(run, repoDir),
    project: ctx.projectName ?? null,
  });
  return true;
}

/** `GET /api/history/file?sha=&path=` — one file's bytes at one commit. */
async function handleFile(ctx, match, repoDir, designRoot, run) {
  const { query, matchesScope, response, respondJson } = ctx;
  const refuse = () => refuseFile(ctx);

  const sha = typeof query?.sha === 'string' ? query.sha : '';
  if (!SHA_RE.test(sha)) return refuse();

  const admitted = admitDesignPath(query?.path, designRoot, { requireText: true });
  if (!admitted || !matchesScope(match.scope, admitted.rel)) return refuse();
  // V2-1.16 L6 (S9.5): raw bytes at a commit are the `export` class, for a path
  // the session sees against the CURRENT closure. Same refusal as missing (U1).
  const peer = peerAccess(match);
  if (peer?.access.role === null && !historyAllows(peer, admitted.rel, 'export')) {
    return refuse();
  }
  const repoRel = toRepoRel(repoDir, designRoot, admitted.rel);

  // Size BEFORE bytes. `cat-file -s` is a cheap object-header read, and it is
  // what keeps a pathological blob from being captured into memory at all —
  // the runner's own capture cap would silently TRUNCATE it instead, handing
  // back a half-file that builds into a plausible-looking wrong canvas.
  const sized = await run(['cat-file', '-s', `${sha}:${repoRel}`], { cwd: repoDir });
  if (sized.code !== 0) return refuse();
  const bytes = Number(sized.stdout.trim());
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_BLOB_BYTES) return refuse();

  const shown = await run(['show', `${sha}:${repoRel}`], { cwd: repoDir });
  if (shown.code !== 0) return refuse();

  if (response) {
    respondText(response, 200, shown.stdout, 'text/plain; charset=utf-8');
  } else {
    respondJson(200, { content: shown.stdout });
  }
  return true;
}

/* ------------------------------------------------------------- helpers ---- */

/** 1–100, defaulting when absent or unparseable. */
function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

/**
 * Is `raw` a design-root-relative path this route may address?
 *
 * Containment first (lexical AND through symlinks — a peer can COMMIT a
 * symlink, DDR-054), then membership on the RESOLVED path, so a link whose
 * lexical name looks benign cannot smuggle out runtime state or `config.json`.
 * Returns the resolved design-root-relative path, or null.
 *
 * NOTE WHAT THIS GUARD IS AND IS NOT DOING. It resolves against the WORKING
 * TREE, while `git show <sha>:<path>` reads the OBJECT DATABASE — the two can
 * legitimately disagree (a path symlinked today need not have been at that
 * commit). The disk-side check is therefore not what makes the historical read
 * safe. What makes it safe is that a committed symlink is a mode-120000 blob
 * whose CONTENT is the target string: `git show` of one returns the text
 * `/etc/passwd`, never the bytes at that path. The working-tree resolution is
 * still worth doing — it is what keeps the membership classifier honest about
 * `_history/` and `config.json` aliases — but the object-database property is
 * the load-bearing half. (Security re-review of 8134ca8f, finding F6.)
 */
function admitDesignPath(raw, designRoot, { requireText }) {
  if (typeof raw !== 'string' || raw === '' || raw.length > 512) return null;
  // Normalize separators BEFORE the guards so what is validated is byte-for-
  // byte what reaches git (no post-guard mutation re-opening a bypass).
  const rel = raw.replace(/\\/g, '/');
  if (rel.startsWith('/') || rel.split('/').includes('..')) return null;

  const root = resolve(designRoot);
  const abs = resolve(root, rel);
  if ((abs !== root && !abs.startsWith(root + sep)) || !isContainedReal(root, abs)) return null;

  // The REAL design-root-relative path — where the bytes actually come from.
  // Differs from the lexical `rel` exactly when a committed symlink sits on
  // the path, which is the case membership must judge.
  let realRel;
  try {
    const realRoot = realpathOfDeepestExisting(root);
    const realParent = realpathOfDeepestExisting(dirname(abs));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) return null;
    realRel = relative(realRoot, resolve(realParent, basename(abs)))
      .split(sep)
      .join('/');
  } catch {
    return null;
  }
  if (!realRel || realRel.startsWith('..')) return null;

  // `never` covers `config.json`, the DDR-115 runtime-state taxonomy and every
  // shape the classifier refuses — one answer for policy and malformity alike.
  if (classifyProjectFile(realRel, { canvasGroups: readCanvasGroups(designRoot) }) === 'never') {
    return null;
  }
  if (requireText) {
    const dot = realRel.lastIndexOf('.');
    const ext = dot < 0 ? '' : realRel.slice(dot + 1).toLowerCase();
    if (!TEXT_EXTS.has(ext)) return null;
  }
  return { rel: realRel };
}

/** design-root-relative → repo-relative, which is what git argv speaks. */
function toRepoRel(repoDir, designRoot, rel) {
  const prefix = relative(resolve(repoDir), resolve(designRoot)).split(sep).join('/');
  return prefix ? `${prefix}/${rel}` : rel;
}

/** The checked-out branch, or null when git cannot say (detached, no commits). */
async function currentBranch(run, repoDir) {
  const r = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir });
  if (r.code !== 0) return null;
  const name = r.stdout.trim();
  return name && name !== 'HEAD' ? name : null;
}

/** Raw-text response with the same no-store / nosniff posture as the file door. */
function respondText(response, status, body, contentType) {
  const buf = Buffer.from(body, 'utf8');
  response
    .writeHead(status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff',
    })
    .end(buf);
}
