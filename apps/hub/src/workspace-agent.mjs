// The headless workspace agent — Cloud Phase 16 Task 1.
//
// THE HOLE THIS FILLS. Until now, autosave-to-git ran only in the CLIENT
// (apps/studio/sync/index.ts). A project opened from a phone, or from a
// browser, or simply with no desktop attached, therefore had no history at
// all — its only record was its current bytes, one bad sync from
// unrecoverable. Worse, "GitHub mirror" would have been a false claim: there
// would have been nothing truthful to push.
//
// So the server commits. It subscribes to its own hub's documents, projects
// each one onto the checkout, and drives the SAME `createAutoCommit` the
// desktop uses — same append-only rule, same author≠committer contract, same
// quiescence batching. One implementation, so a server-made commit and a
// desktop-made commit are indistinguishable in the log.
//
// CONTAINMENT (DDR-193 §2) IS UNTOUCHED. This agent syncs, writes and commits
// bytes. It does not import a canvas, does not bundle one, does not evaluate
// one, and does not spawn anything that could. The canvas body is a string
// from a Y.Text to a file on disk and nothing in between ever looks inside it.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createAutoCommit } from '../../studio/sync/autocommit.ts';
import { resolveCanvasBodyRel } from '../../studio/sync/canvas-path.ts';
// The SAME validator the studio projector gates disk writes with — a second
// spelling here is how the hub came to write and commit source the desktop
// refuses (audit 2026-09-13 P0 #2).
import { sourceError } from '../../studio/sync/source-validation.ts';
import { createGitRunner, ensureRepo, gitAvailable } from './git-runner.mjs';
import { realpathOfDeepestExisting } from './path-contain.mjs';
import {
  attributionFor,
  committableLanes,
  filesForCanvas,
  indexCanvasPaths,
  readDocContent,
  siblingPaths,
} from './workspace-files.mjs';

/** Documents are `ws/<workspace>/<branch>/<slug>`; anything else is legacy-flat. */
const DOC_NAME = /^ws\/[^/]+\/[^/]+\/([^/]+)$/;

/**
 * Slug carried by a document name.
 * Returns null for names this agent must not touch — a name it cannot parse is
 * a name whose destination it would have to guess, and guessing writes a
 * tenant's work to the wrong file.
 */
export function slugFromDocName(name) {
  const m = DOC_NAME.exec(String(name ?? ''));
  if (m) return m[1];
  // Legacy flat slugs predate the namespace and are still valid documents.
  if (/^[a-z0-9._-]+$/.test(String(name ?? ''))) return String(name);
  return null;
}

/** Recursively list files under `dir`, relative to it. Missing dir → []. */
function listFiles(dir, prefix = '', out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      listFiles(join(dir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function readIfPresent(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write via temp + rename, so a reader never observes a half-written canvas.
 * The temp file is a sibling: rename is only atomic within one filesystem, and
 * /tmp in a container frequently is not the same one as /repo.
 */
function atomicWrite(abs, text) {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, abs);
}

/**
 * @param {object} opts
 * @param {string} opts.repoDir      the checkout root
 * @param {string} [opts.designRel]  design root, relative to repoDir
 * @param {number} [opts.debounceMs] quiescence window before a commit
 * @param {Function} [opts.run]      injected GitRunner (tests)
 * @param {object}   [opts.log]
 */
export function createWorkspaceAgent(opts) {
  const repoDir = resolve(opts.repoDir);
  const designRel = (opts.designRel ?? '.design').replace(/^\/+|\/+$/g, '');
  const designRoot = join(repoDir, designRel);
  const log = opts.log ?? console;
  const run = opts.run ?? createGitRunner();
  // ONE PROJECTOR PER CHECKOUT (DDR-241, plan T14). When a paired studio child
  // projects the accepted documents onto this same checkout, this agent must
  // not ALSO write, relocate or park canvas files: two writers over one disk
  // race each other (the hub parked a moved canvas's old file microseconds
  // before the studio's own rename reached it — surface run 2026-09-15, L04).
  // It keeps committing whatever the projector put on disk. Asked per event,
  // because the project's save mode can change while the cell runs.
  const writesCheckout = opts.writesCheckout ?? (() => true);

  let auto = null;
  let ready = false;
  let pathIndex = new Map();
  // The last body this writer observed/materialized, not an authority over a
  // newer local save. A paired studio can project a peer edit and then save a
  // user edit before this hub's delayed store hook runs for the peer edit.
  const storedBodyHashes = new Map();
  // Body rel → { hash, reason } for a document body the validator refused.
  // The candidate itself stays in the Y.Doc; the checkout keeps the last
  // valid body and history never records the rejected one.
  const rejectedSources = new Map();
  /** Declared canvas groups, from the tenant's own `.design/config.json`. */
  let canvasGroups = null;

  /**
   * The tenant's declared canvas groups, or null when they have not said.
   *
   * Read rather than assumed because the groups decide BOTH what an incoming
   * path is allowed to be and where an un-pathed canvas lands, and a project
   * that renamed `ui` to `screens` would otherwise have every fallback go to a
   * directory it does not use. Never throws: a missing or unparseable config is
   * the normal state of a fresh checkout, and `canvas-path.ts` has a documented
   * default for exactly that.
   */
  function readCanvasGroups() {
    try {
      const raw = readFileSync(join(designRoot, 'config.json'), 'utf8');
      const cfg = JSON.parse(raw);
      const groups = cfg?.canvasGroups;
      return Array.isArray(groups) && groups.length > 0 ? groups : null;
    } catch {
      return null;
    }
  }

  /**
   * Design-root-relative paths that mean something other than "a canvas".
   *
   * `system` is a DEFAULT canvas group and `.css`/`.meta.json` are derived from
   * the body path, so a document named `system-colors_and_type` carrying
   * `system/colors_and_type.tsx` passes every rule and writes its css lane over
   * `tokensCssRel` — the stylesheet the dev server serves. Rule 7 ties a path to
   * its own DOCUMENT and says nothing about what already occupies it.
   */
  function readServedPaths() {
    const out = new Set(['config.json']);
    try {
      const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
      if (typeof cfg?.tokensCssRel === 'string') out.add(cfg.tokensCssRel);
      for (const ds of cfg?.designSystems ?? []) {
        if (typeof ds?.tokensCssRel === 'string') out.add(ds.tokensCssRel);
      }
    } catch {
      out.add('system/colors_and_type.css'); // the documented default
    }
    return out;
  }

  /**
   * Resolve the checkout before accepting any document. Reports rather than
   * throws — see ensureRepo.
   */
  /**
   * NOTHING IN HERE MAY THROW.
   *
   * This is not defensive style, it is the design. Losing history is bad;
   * refusing to open the project because history is unavailable is worse — the
   * tenant's work is intact and reachable, and a cell that will not boot is a
   * cell nobody can fix the permissions on either.
   *
   * The first run of this code against a real image proved the point: /repo
   * existed but was root-owned, `mkdirSync` threw from outside the try, and the
   * ENTIRE HUB crash-looped. A read-only or wrongly-owned volume must cost the
   * tenant their history, never their workspace.
   */
  async function start() {
    try {
      if (!(await gitAvailable(run))) {
        log.warn?.(
          '[workspace] git is not available in this image — the workspace will sync and serve, ' +
            'but it will keep NO history. Install git in the runtime image (Cloud Phase 16 T2).'
        );
        return { state: 'failed', reason: 'git not on PATH' };
      }
      try {
        mkdirSync(designRoot, { recursive: true });
      } catch (err) {
        return {
          state: 'failed',
          reason:
            `cannot create ${designRoot} (${err.code ?? err.message}) — ` +
            'the checkout volume is not writable by the hub user',
        };
      }
      const repo = await ensureRepo(repoDir, run);
      if (repo.state === 'failed') {
        log.error?.(`[workspace] git unavailable: ${repo.reason} — continuing without history`);
        return repo;
      }
      // Provenance-aware (fix 5, sync RCA 2026-08-10): a boot-scan entry comes
      // from a real file in the checkout — the strongest claim there is — so it
      // carries fromPath: true and is never relocated on a peer's say-so.
      pathIndex = new Map(
        [...indexCanvasPaths(listFiles(designRoot))].map(([slug, rel]) => [
          slug,
          { rel, fromPath: true },
        ])
      );
      for (const { rel } of pathIndex.values()) {
        const body = readIfPresent(join(designRoot, rel));
        if (body !== null)
          storedBodyHashes.set(rel, createHash('sha256').update(body).digest('hex'));
      }
      canvasGroups = readCanvasGroups();
      auto = createAutoCommit({
        repoRoot: repoDir,
        run,
        debounceMs: opts.debounceMs,
        log,
        // THE HUB COMMITS THE DESIGN ROOT EVEN WHEN GIT IS IGNORING IT.
        //
        // A hub-owned project (DDR-228) gitignores `/.design/`, and this
        // checkout is seeded from that repo, so it inherits the rule and the
        // hub would silently stop recording the one thing it exists to hold.
        // Generation backups bundle committed objects only, and object storage
        // mirrors `assets/` alone — so the design system would have had no
        // durable copy anywhere, which is precisely what makes a deletion
        // unrecoverable rather than merely inconvenient.
        //
        // Safe here and nowhere else: on a desktop the ignore file is the
        // user's instruction about their own repo; on the hub the design root
        // is the product.
        stageIgnored: true,
      });
      ready = true;
      log.log?.(
        `[workspace] server-side history active — ${repo.state} at ${repoDir} ` +
          `(${pathIndex.size} canvas${pathIndex.size === 1 ? '' : 'es'} indexed)`
      );
      return repo;
    } catch (err) {
      return { state: 'failed', reason: err.message };
    }
  }

  /**
   * One document finished storing. Project it onto the checkout and hand the
   * touched paths to autocommit.
   *
   * Never throws: this runs inside a Hocuspocus hook, and an exception there
   * takes down the store for every OTHER document too. A projection failure
   * must cost this canvas its commit, not the tenant their sync.
   */
  /**
   * Retired documents (the move protocol, studio codec stampMovedTo) whose
   * checkout ghost has not been provable-safe to remove yet. slug →
   * { movedTo, who }.
   */
  const retirementsPending = new Map();

  function noteRetirement(slug, movedTo, user) {
    if (!retirementsPending.has(slug)) {
      retirementsPending.set(slug, { movedTo: String(movedTo), who: attributionFor(user) });
    }
  }

  /**
   * Is `rel` the body of a canvas this agent has indexed — some canvas OTHER
   * than the one being retired?
   *
   * `pathIndex` is the agent's own record of where each slug's body lives, so
   * this asks "did a canvas land here", not "does a file exist here". A move
   * whose destination has not stored yet simply HOLDs and is re-asked on the
   * next store, which is the same shape as the in-flight case above.
   */
  function isIndexedCanvasPath(rel, retiringSlug) {
    for (const [slug, entry] of pathIndex) {
      if (slug !== retiringSlug && entry?.rel === rel) return true;
    }
    return false;
  }

  /**
   * Mass-delete breaker for the move-retirement path (DDR-226 §8, extended).
   *
   * `movedTo` is peer-written CRDT content, and acting on it quarantines four
   * lanes and stages a git deletion. One at a time that is the move protocol
   * working; a burst of them is a project being emptied by a peer asserting
   * moves that never happened — and `_trash/` is runtime state (DDR-115),
   * gitignored and, on a cell, on an ephemeral disk. So the burst stops.
   */
  const RETIREMENT_BURST_MAX = 10;
  const RETIREMENT_BURST_WINDOW_MS = 60_000;
  let retirementWindowStart = 0;
  let retirementsThisWindow = 0;
  let breakerAnnounced = false;

  function retirementBreakerTripped() {
    const t = Date.now();
    if (t - retirementWindowStart > RETIREMENT_BURST_WINDOW_MS) {
      retirementWindowStart = t;
      retirementsThisWindow = 0;
      breakerAnnounced = false;
    }
    if (retirementsThisWindow < RETIREMENT_BURST_MAX) return false;
    if (!breakerAnnounced) {
      breakerAnnounced = true;
      log.warn?.(
        `[hub] move-retirement breaker: ${retirementsThisWindow} canvases retired within ${RETIREMENT_BURST_WINDOW_MS / 1000}s — refusing to quarantine more this window. The rest stay pending; if this is a real bulk move it resumes on its own, and if it is not, nothing was removed.`
      );
    }
    return true;
  }

  /**
   * Quarantine a retired document's checkout ghost — but ONLY when the ghost
   * is provably a ghost. The naive version quarantined the moment the stamp
   * arrived, which on a CELL races the mover's own rename over the SAME disk:
   * the hub parked `ui/home.tsx` into `_trash/` microseconds before
   * `moveCanvas`'s `rename()` reached it, and the move died with ENOENT while
   * the canvas sat in two trash folders. The whole race is decided by one
   * table instead:
   *
   *   old path │ new path │ verdict
   *   ─────────┼──────────┼─────────────────────────────────────────────
   *   absent   │ (any)    │ done — the mover (or a prior sweep) handled it
   *   present  │ absent   │ HOLD — a move is in flight; touching the file
   *            │          │ now is the race. Re-checked on every store.
   *   present  │ present  │ the ghost: quarantine + stage the deletion
   *
   * `movedTo` is UNTRUSTED (a peer wrote it); it is used only as a
   * containment-checked existence probe, never as a write target — a path
   * that resolves outside the design root reads as "never arrives", which
   * HOLDs forever and quarantines nothing. Fail-open to the ghost, never to
   * a deletion.
   *
   * Two things the probe alone does not give, both added after the Increment-3
   * attacker pass:
   *
   *   • **The target must be a canvas this agent knows**, not merely a path
   *     where something exists. "Does a file live here" answers yes for
   *     `config.json`, so a peer could stamp `movedTo: "config.json"` on every
   *     slug in the project and have each one quarantined for a move that
   *     never happened. A move ends at a canvas; anything else HOLDs.
   *   • **A mass-delete breaker.** Even with a real canvas target, this path
   *     is a deletion path by any honest description — and DDR-226 §8's
   *     breakers guard the tombstone lane, not this one. Past the cap in one
   *     window the sweep stops and says so, rather than draining a project one
   *     store at a time.
   */
  function sweepRetirements() {
    for (const [slug, pending] of retirementsPending) {
      if (retirementBreakerTripped()) return;
      const indexed = pathIndex.get(slug);
      if (!indexed) {
        retirementsPending.delete(slug);
        continue;
      }
      const oldAbs = join(designRoot, indexed.rel);
      if (!existsSync(oldAbs)) {
        // Somebody else already removed it — the mover's own rename, or (on a
        // cell, sharing this disk) the studio child's retirement watcher,
        // which usually wins. GONE FROM DISK IS NOT GONE FROM HISTORY: the
        // path is still tracked, and if nobody notes it the checkout and its
        // git history diverge permanently — the canvas moved months ago and
        // `git show HEAD` still lists it at the old path.
        //
        // Note it and let autocommit judge: it stages a tracked-but-missing
        // path as a deletion and silently drops one git never knew.
        const sib = siblingPaths(indexed.rel);
        for (const rel of [indexed.rel, sib.meta, sib.css, sib.annotations]) {
          auto.note(relative(repoDir, join(designRoot, rel)).split(sep).join('/'), pending.who);
        }
        pathIndex.delete(slug);
        retirementsPending.delete(slug);
        continue;
      }
      // Not the projector: the studio child moves the file; this agent only
      // records the move once the old path is gone (the branch above).
      if (!writesCheckout()) continue;
      const newAbs = resolve(join(designRoot, pending.movedTo));
      const contained = newAbs === designRoot || newAbs.startsWith(designRoot + sep);
      if (!contained || !existsSync(newAbs)) continue; // HOLD — move still in flight
      // …and it has to be a CANVAS, not just something that exists. A peer
      // naming `config.json` here is asserting a move that cannot have
      // happened; HOLD is the answer, the same as for a move still in flight.
      if (!isIndexedCanvasPath(pending.movedTo, slug)) continue;
      retirementsThisWindow += 1;
      const sib = siblingPaths(indexed.rel);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const trashDir = join(designRoot, '_trash', `${stamp}__moved-${slug}`);
      const vacated = [];
      for (const rel of [indexed.rel, sib.meta, sib.css, sib.annotations]) {
        try {
          mkdirSync(trashDir, { recursive: true });
          renameSync(join(designRoot, rel), join(trashDir, rel.split('/').pop()));
          vacated.push(rel);
        } catch {
          /* that lane never materialised — nothing to park */
        }
      }
      pathIndex.delete(slug);
      retirementsPending.delete(slug);
      if (vacated.length > 0) {
        log.log?.(
          `[workspace] ${slug} retired (moved to ${pending.movedTo.slice(0, 120)}) — parked ${vacated.length} ghost file(s) in _trash/.`
        );
        for (const rel of vacated) {
          // Stage the deletion — autocommit's vanished-path handling stages a
          // tracked-but-missing file as a delete and drops untracked ones.
          auto.note(relative(repoDir, join(designRoot, rel)).split(sep).join('/'), pending.who);
        }
      }
    }
  }

  async function onDocumentStored({ documentName, document, user }) {
    if (!ready || !auto) return null;
    const slug = slugFromDocName(documentName);
    if (!slug) {
      log.warn?.(
        `[workspace] ignoring unparseable document name: ${String(documentName).slice(0, 80)}`
      );
      return null;
    }

    try {
      const content = readDocContent(document);
      // THE MOVE PROTOCOL'S HUB HALF (studio codec stampMovedTo). A retired
      // document materialises nothing, ever again — and if the checkout still
      // holds its files, they are the GHOST the user sees in the cloud tree
      // after moving a canvas elsewhere. Quarantine them to `_trash/` (never
      // unlink — the recoverability spine) and stage the deletions, so the
      // checkout and its history both agree the canvas lives at the new path
      // now. Safe against plain-deletion ambiguity because `movedTo` is an
      // explicit statement that the content lives on in another document;
      // acting on bare absence stays forbidden (DDR-076 / Increment 6).
      if (content.movedTo !== null) {
        noteRetirement(slug, content.movedTo, user);
        sweepRetirements();
        return null;
      }
      // Every store also sweeps pending retirements — the NEW document's
      // materialisation is usually the event that makes an old ghost provable
      // (see sweepRetirements for the decision table).
      sweepRetirements();
      // A fresh checkout has no config until the project's first sync brings
      // one down, so this cannot be a boot-time-only read.
      if (canvasGroups === null) canvasGroups = readCanvasGroups();

      // WHERE THIS CANVAS GOES, in the only order that is safe.
      //
      //   1. The checkout, when it already holds a file for this slug — but the
      //      claim carries PROVENANCE now (fix 5, sync RCA 2026-08-10). An
      //      entry a real file or a validated path decided (fromPath: true —
      //      every boot-scan entry included) wins unconditionally: relocating
      //      an existing file on a remote peer's say-so would let any peer move
      //      any other peer's work. An entry the FALLBACK produced
      //      (fromPath: false) is only a guess this agent made when a body
      //      arrived before its `syncMeta.path` stamp — superseded below.
      //   2. The document's own `syncMeta.path`, validated — the canvas the
      //      checkout has never seen, which is the whole bug. See
      //      studio/sync/canvas-path.ts; rule 7 (the path must slug back to
      //      THIS document) is why a hostile path is self-defeating.
      //   3. The fallback, which is flat but lands inside a canvas group, so an
      //      un-pathed canvas from an older peer is at least visible.
      //
      // Step 2 is IMPORTED, never re-typed here — the Dockerfile copies that
      // module in for the same reason it copies autocommit.ts: re-typing a
      // guarantee is re-typing it without its tests.
      const indexed = pathIndex.get(slug);
      const resolved = indexed?.fromPath
        ? null
        : resolveCanvasBodyRel({
            path: content.path,
            slug,
            designRel,
            canvasGroups,
            onRefused: (reason) =>
              log.warn?.(`[workspace] ignoring the path on ${slug} — ${reason}`),
          });

      // A late VALIDATED path supersedes a memoised fallback. The first store
      // routinely arrives before the peer's `syncMeta.path` stamp lands, the
      // fallback wrote a flat stub, and pinning that stub in pathIndex meant
      // the real nested path could never win — the body filled a file nobody
      // serves and the canvas failed its dynamic import forever. Only a
      // fallback is ever superseded; never a location a real file decided.
      let relocateFrom = null;
      let bodyRel;
      let fromPath;
      if (indexed && !indexed.fromPath && resolved.fromPath && resolved.rel !== indexed.rel) {
        relocateFrom = indexed.rel;
        bodyRel = resolved.rel;
        fromPath = true;
      } else if (indexed) {
        bodyRel = indexed.rel;
        // Same location — a validated path that AGREES with the fallback still
        // upgrades its provenance, closing the relocation window for good.
        fromPath = indexed.fromPath || !!(resolved?.fromPath && resolved.rel === indexed.rel);
      } else {
        bodyRel = resolved.rel;
        fromPath = resolved.fromPath;
      }

      // A remote path may not choose a location that means something else. Runs
      // whenever the REMOTE is choosing — a first write, or a relocation — and
      // never when the checkout already decided from a real file.
      if (!indexed || relocateFrom) {
        const served = readServedPaths();
        const cand = siblingPaths(bodyRel);
        if ([bodyRel, cand.meta, cand.css].some((rel) => served.has(rel))) {
          log.error?.(`[workspace] refusing to write over a served project file: ${bodyRel}`);
          if (!relocateFrom) return null;
          // Refuse the RELOCATION, not the store: the flat fallback is untidy,
          // overwriting the tenant's stylesheet is a loss.
          bodyRel = relocateFrom;
          fromPath = false;
          relocateFrom = null;
        }
      }
      const sib = siblingPaths(bodyRel);
      const abs = (rel) => join(designRoot, rel);

      // Path containment. `slug` is already charset-constrained by the hub's
      // documentName regex, but this is the last point before a write and the
      // consequence of being wrong is writing outside the tenant's checkout.
      const realRoot = realpathOfDeepestExisting(designRoot);
      for (const rel of [bodyRel, sib.meta, sib.css, sib.annotations]) {
        const target = resolve(abs(rel));
        if (target !== designRoot && !target.startsWith(designRoot + sep)) {
          log.error?.(`[workspace] refusing write outside the design root: ${rel}`);
          return null;
        }
        // …and again through the symlinks, because the check above cannot see
        // them and the peer now chooses the directory. See the helper.
        const real = realpathOfDeepestExisting(target);
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          log.error?.(`[workspace] refusing write through a symlink: ${rel}`);
          return null;
        }
      }

      // Execute the relocation: move the stub (and any sidecars it grew) to
      // the validated home — filesystem rename + staging both halves ≈ git mv,
      // AFTER the containment gates above proved the destination is inside the
      // design root. A lane that fails to move is simply left for the normal
      // write path below to (re)create at the new location.
      const vacated = [];
      const arrived = [];
      if (relocateFrom && writesCheckout()) {
        const from = siblingPaths(relocateFrom);
        for (const [src, dst] of [
          [relocateFrom, bodyRel],
          [from.meta, sib.meta],
          [from.css, sib.css],
          [from.annotations, sib.annotations],
        ]) {
          if (src === dst) continue;
          try {
            mkdirSync(dirname(abs(dst)), { recursive: true });
            renameSync(abs(src), abs(dst));
            vacated.push(src);
            arrived.push(dst);
          } catch {
            /* that lane never materialized — nothing to vacate */
          }
        }
        log.log?.(
          `[workspace] relocated ${slug}: ${relocateFrom} → ${bodyRel} ` +
            '(a validated syncMeta.path superseded the fallback)'
        );
        // The delete half is stageable only for paths git TRACKS: `git add` on
        // a vanished never-committed path exits 128, and autocommit re-queues
        // the whole batch forever — and the stub often lives shorter than one
        // debounce window. `ls-files` lists only tracked paths, exit 0 always.
        if (vacated.length > 0) {
          const repoRels = vacated.map((rel) => relative(repoDir, abs(rel)).split(sep).join('/'));
          const tracked = await run(['ls-files', '--', ...repoRels], { cwd: repoDir });
          const known = new Set(
            tracked.code === 0 ? tracked.stdout.split('\n').filter(Boolean) : repoRels
          );
          for (let i = vacated.length - 1; i >= 0; i--) {
            if (!known.has(repoRels[i])) vacated.splice(i, 1);
          }
        }
      }

      const onDisk = {
        body: readIfPresent(abs(bodyRel)),
        meta: readIfPresent(abs(sib.meta)),
        css: readIfPresent(abs(sib.css)),
        annotations: readIfPresent(abs(sib.annotations)),
      };
      const bodyHash =
        content.body === null ? null : createHash('sha256').update(content.body).digest('hex');
      const diskBodyHash =
        onDisk.body === null ? null : createHash('sha256').update(onDisk.body).digest('hex');
      const awaitingBodyImport =
        bodyHash !== null &&
        diskBodyHash !== (storedBodyHashes.get(bodyRel) ?? null) &&
        onDisk.body !== content.body;
      const invalidReason = content.body === null ? null : sourceError(bodyRel, content.body);
      if (invalidReason) {
        if (rejectedSources.get(bodyRel)?.hash !== bodyHash) {
          log.warn?.(
            `[workspace] refusing invalid source for ${bodyRel} (${invalidReason}); ` +
              'the checkout keeps its last valid body and history skips this revision'
          );
        }
        rejectedSources.set(bodyRel, { hash: bodyHash, reason: invalidReason });
      } else if (content.body !== null) {
        rejectedSources.delete(bodyRel);
      }
      // Keep unrelated lanes flowing. Body-coupled CSS must wait too, and the
      // same filtered content must govern both projection and commit eligibility.
      const holdBody = awaitingBodyImport || invalidReason !== null;
      const projectable = holdBody ? { ...content, body: null, css: null } : content;
      const writes = writesCheckout()
        ? filesForCanvas({ bodyRel, content: projectable, onDisk })
        : [];

      // WHAT TO COMMIT IS NOT WHAT WE WROTE — desktop ↔ cloud live pairing.
      //
      // This used to `note` exactly the paths this function had just written,
      // which was correct while the hub was the only writer. Under pairing
      // (DDR-213) it is not: the studio child's doc→file projector writes the
      // same bytes from the same doc, and usually WINS the race. The hub then
      // reads disk, finds it already identical, writes nothing — and, noting
      // nothing, never commits. The tenant's edits were safely on the cell's
      // disk and permanently absent from its history, which is the one thing a
      // cell owns on their behalf (`MAUDE_SYNC_NO_AUTOCOMMIT=1` disables the
      // child's own autocommit precisely because the hub is meant to do this).
      //
      // `committableLanes` answers "which lanes may be staged", applying the
      // SAME gates as the write path — see workspace-files.mjs for why the two
      // are neighbours and why the meta lane in particular must not diverge.
      const committable = committableLanes({ bodyRel, content: projectable, onDisk });

      if (writes.length === 0 && committable.length === 0 && vacated.length === 0) return null;

      const who = attributionFor(user);
      // A relocation stages BOTH halves of the move: the vacated paths (the
      // delete side — `git add` records a tracked-but-missing file as gone) and
      // the arrived ones (the add side, even when the bytes were untouched).
      const toStage = new Set([...committable, ...vacated, ...arrived]);
      for (const w of writes) {
        atomicWrite(abs(w.relPath), w.text);
        toStage.add(w.relPath);
      }
      if (!holdBody && bodyHash !== null) storedBodyHashes.set(bodyRel, bodyHash);
      for (const rel of toStage) {
        // autocommit stages paths relative to the REPO root, not the design root.
        auto.note(relative(repoDir, abs(rel)).split(sep).join('/'), who);
      }
      // A brand-new canvas becomes indexable immediately (a second event in the
      // same session does not re-derive the default flat path) — and provenance
      // travels with it, so a fallback entry stays supersedable until a
      // validated path or a relocation upgrades it.
      pathIndex.set(slug, { rel: bodyRel, fromPath });

      return { slug, bodyRel, written: writes.map((w) => w.relPath), staged: [...toStage] };
    } catch (err) {
      log.error?.(`[workspace] projecting ${slug} failed: ${err.message}`);
      return null;
    }
  }

  return {
    start,
    onDocumentStored,
    /** Force any pending commit now. The shutdown path depends on this. */
    flush: () => (auto ? auto.flush() : Promise.resolve(null)),
    async stop() {
      ready = false;
      if (!auto) return null;
      // Flush BEFORE stopping. A cell is migrated mid-session as the normal
      // path, not the exception — dropping the pending commit on SIGTERM
      // would lose the last few seconds of every session the platform moves.
      //
      // The outcome is RETURNED, not swallowed. The first live SIGTERM test
      // left the tree staged-but-uncommitted and there was no way to tell
      // whether the flush had run and failed or never run at all.
      const outcome = await auto.flush();
      auto.stop();
      auto = null;
      return outcome;
    },
    /** Test/diagnostic surface. */
    get indexed() {
      return pathIndex.size;
    },
    /** Body rel → { hash, reason } of document bodies the validator refused. */
    get rejectedSources() {
      return rejectedSources;
    },
  };
}
