#!/usr/bin/env node
// Cold-start rehydrate — Cloud Phase 5 Task 1, actually written in Phase 15.
//
// The cell entrypoint has invoked this file since Phase 5. It did not exist,
// so every cold start would have died on `Cannot find module` and the
// entrypoint would have refused to boot — correctly, but for the wrong
// reason, and the cell image had never been built so nobody found out.
//
// WHAT IT DOES. Restores the newest COMPLETE backup generation into the
// working set: the SQLite databases into DATA_DIR, and the git checkout from
// the same generation's bundle into MAUDE_REPO_DIR. One generation for both —
// see repo-checkpoint.mjs for why mixing them is corruption.
//
// WHY THIS IS THE NORMAL PATH, NOT RECOVERY. A cell's disk is ephemeral and
// the platform migrates instances whenever it likes. Making wake-from-cold use
// the exact same code as the restore drill means the restore path is exercised
// every single wake instead of once a quarter, which is the only way to know
// it works.
//
// EXITS NON-ZERO ON ANY DOUBT. The entrypoint treats that as fatal, and it
// should: a cell that starts with an empty working set is indistinguishable
// from a deleted project to the person opening it, and the autosave agent
// would then commit that emptiness over their real work.
//
//   node src/rehydrate.mjs --data /data --repo /repo

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { baseTargetFromEnv, listBackups, restoreLatest, targetFromEnv } from './backup.mjs';
import { replayDocsTail } from './docs-tail.mjs';
import { createGitRunner } from './git-runner.mjs';
import { closeJournal, openJournal, replayTailFromTarget } from './journal.mjs';
import { adoptWorkspaceId, readWorkspaceId } from './workspace-identity.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * The boot decision — Phase 0 F4 + Track A' A1.
 *
 * IT LIVES HERE, and that is the point. The cell entrypoint used to decide
 * this in shell with `[ -f /data/hub.db ]`, and the Docker path never decided
 * it at all (`CMD ["node","dist/hub.bundle.mjs"]`, no entrypoint). Two boot
 * paths, one of which recovers. This module already imports `listBackups`,
 * `restoreLatest` and `targetFromEnv`, already exits non-zero on doubt, and is
 * already built as its own dist entry — so putting the table here means both
 * callers share ONE decision and the shell test is deleted rather than
 * duplicated. Fewer decision points than before, not more.
 *
 * THE BUG THE OLD SHELL TEST CARRIED (live in production cells): `hub.db`
 * present was taken to mean "warm start". With two volumes, `/data` intact and
 * `/repo` lost is exactly that shape — so rehydrate was skipped, boot
 * continued, and `seedRepo` cloned MAUDE_SEED_REPO over a checkout that had
 * simply gone missing. Green boot, silent history loss.
 *
 * `/repo` only participates in workspace mode. A plain relay hub has no
 * checkout, so an empty `/repo` there is the normal state and must not refuse.
 *
 * Identity (whose generation is this?) is NOT decided here — `restoreLatest`
 * asks `decideRestoreOwnership` once the manifest is in hand. This function
 * answers only the shape question: restore, seed, start fresh, or stop.
 *
 * @returns {{action:'proceed'|'restore'|'seed'|'fresh'|'refuse', reason:string}}
 */
export function decideBoot({
  dataPopulated,
  repoPopulated,
  generationCount,
  workspaceMode = false,
  seedConfigured = false,
  allowEmptyStart = false,
  listFailed = false,
}) {
  if (allowEmptyStart) {
    return { action: 'proceed', reason: 'MAUDE_ALLOW_EMPTY_START=1 was set deliberately' };
  }

  const checkoutMissing = workspaceMode && !repoPopulated;

  if (dataPopulated && !checkoutMissing) {
    return { action: 'proceed', reason: 'the working set is present' };
  }

  // An unreachable bucket, checked AFTER the working-set test on purpose (F4).
  // A genuine warm start (`/data` present AND the checkout present) already
  // returned above, so reaching here with `listFailed` means the working set is
  // incomplete: `/data` empty (first-boot vs lost-volume is indistinguishable
  // without the bucket) OR `/repo` gone in workspace mode (the documents/
  // checkout mismatch the stop below exists for). Either way a listing blip must
  // NOT proceed — that is how a fresh identity gets minted over real history, or
  // a stale checkout paired with newer documents. Refuse and let the operator
  // retry, exactly as rehydrate's "exit non-zero on any doubt" contract intends.
  if (listFailed) {
    return {
      action: 'refuse',
      reason:
        'the working set is incomplete and the backup target could not be listed, so recovery ' +
        'cannot be decided safely — refusing rather than starting wrong. Retry when storage is ' +
        'reachable, or set MAUDE_ALLOW_EMPTY_START=1 for a genuinely fresh deployment.',
    };
  }

  // `/data` intact, `/repo` gone. Restoring only the checkout would pair a
  // fresh bundle with older documents, which repo-checkpoint.mjs names as the
  // corruption that "looks like a bug in the app for weeks"; restoring both
  // halves would overwrite documents that are NEWER than the generation. There
  // is no safe automatic answer, so this is the one row that stops.
  if (dataPopulated && checkoutMissing) {
    return {
      action: 'refuse',
      reason:
        'the documents are present but the checkout is gone. Restoring the checkout alone would ' +
        'pair it with newer documents, and restoring the whole generation would discard them. ' +
        'Restore deliberately, or set MAUDE_ALLOW_EMPTY_START=1 to start without the history.',
    };
  }

  if (generationCount > 0) {
    return { action: 'restore', reason: `${generationCount} generation(s) available` };
  }
  if (seedConfigured) {
    return { action: 'seed', reason: 'no generations and a seed repository is configured' };
  }
  return { action: 'fresh', reason: 'no generations and nothing to seed from' };
}

function isEmptyish(dir) {
  if (!existsSync(dir)) return true;
  try {
    // `lost+found` on a fresh ext4 volume is not content.
    return readdirSync(dir).filter((n) => n !== 'lost+found').length === 0;
  } catch {
    return true;
  }
}

/**
 * Replay the journal tail, then and ONLY then decide the epoch (DDR-226 §3).
 *
 * This is the load-bearing amendment of the sync v2 redesign, and the order is
 * the whole point. A cell rehydrates from a ≤6 h-old generation on EVERY wake —
 * this is the normal path, not disaster recovery. The generation's `journal.db`
 * is therefore routinely BEHIND what peers already hold.
 *
 *   - Replay first ⇒ the head is reconstructed past the generation, seqs are
 *     the same ones peers checkpointed against, and the epoch survives. Cursors
 *     stay valid, and nobody re-anchors.
 *   - Rotate the epoch on every restore instead ⇒ a full re-anchor and a storm
 *     of conflict copies become a DAILY event.
 *   - Do neither ⇒ the journal silently rewinds and every cursor is stale
 *     forever, which is worse than both.
 *
 * So the epoch rotates only when the tail genuinely cannot reconstruct the
 * head: `state: 'lost'`. Best-effort — a hub that cannot settle its journal
 * still boots, because refusing to start is not a better answer for the person
 * opening the project.
 */
async function settleJournal(dataDir, target) {
  if (!target) return;
  try {
    const journal = openJournal(dataDir);
    const headBefore = journal.head();
    const res = await replayTailFromTarget({ journal, target });
    if (res.state === 'lost' && headBefore > 0) {
      // The journal has rows peers may have consumed and no tail to prove where
      // it got to. That is an unreconstructible rewind — say so and re-anchor.
      journal.rotateEpoch('the journal tail could not be read at rehydrate');
    }
    closeJournal(dataDir);
  } catch (err) {
    console.error(`[rehydrate] journal tail replay failed: ${err.message}`);
  }
}

/**
 * Merge the documents' write-behind over the restored hub.db (docs-tail.mjs).
 * Best-effort like settleJournal: a tail that cannot be read leaves the
 * documents at the generation — what a wake did before G3b — and the hub boots.
 */
async function settleDocuments(dataDir, target) {
  let db;
  try {
    const { createRequire } = await import('node:module');
    const Database = createRequire(import.meta.url)('better-sqlite3');
    db = new Database(join(dataDir, 'hub.db'));
    await replayDocsTail({ target, db, dataDir });
  } catch (err) {
    console.error(`[rehydrate] documents tail replay failed: ${err.message}`);
  } finally {
    try {
      db?.close();
    } catch {
      /* closed */
    }
  }
}

async function main() {
  const dataDir = arg('data', process.env.DATA_DIR ?? '/data');
  const repoDir = arg('repo', process.env.MAUDE_REPO_DIR ?? '/repo');

  const target = targetFromEnv();
  if (!target) {
    // No object storage ⇒ nothing to rehydrate FROM. That is a legitimate
    // local/dev configuration, not a failure: there is no earlier state to
    // lose. The entrypoint only calls this when a bucket IS configured, so
    // reaching here means the config disagrees with itself — say so.
    console.error('[rehydrate] no object storage configured — nothing to restore from');
    process.exit(1);
  }

  let generations = [];
  let listFailed = false;
  try {
    generations = await listBackups(target);
  } catch (err) {
    // NOT fatal. An unreachable bucket is not evidence that anything was lost,
    // and refusing here converts a credential rotation or a storage blip into
    // an outage. Loud, then carry on — the boot table owns this row.
    console.error(`[rehydrate] cannot reach ${target.describe}: ${err.message}`);
    listFailed = true;
  }

  // THE ORPHAN NET (Phase 0 F3). Only reachable for an operator who added a
  // prefix to a deployment that had been running without one: the prefixed
  // keyspace is disjoint from the bare root, so every existing generation went
  // invisible in one config change. Left alone, the next lost volume reads
  // "zero generations" and seeds over a deployment that had good backups
  // yesterday. One extra list, against the BARE target — asking the prefixed
  // one twice would answer zero both times.
  if (!listFailed && generations.length === 0 && process.env.MAUDE_BACKUP_PREFIX) {
    try {
      const bare = baseTargetFromEnv();
      const atRoot = bare ? await listBackups(bare) : [];
      if (atRoot.length > 0) {
        console.error(
          `[rehydrate] refusing to start — this hub is configured with ` +
            `MAUDE_BACKUP_PREFIX=${process.env.MAUDE_BACKUP_PREFIX}, which is EMPTY, while ` +
            `${atRoot.length} generation(s) sit at the bucket root. Adding a prefix does not move ` +
            `them, and starting now would treat this as a first boot.\n` +
            `  Move them, then restart:\n` +
            `    aws s3 cp --recursive s3://<bucket>/backups/ ` +
            `s3://<bucket>/${process.env.MAUDE_BACKUP_PREFIX}/backups/\n` +
            `  Or remove MAUDE_BACKUP_PREFIX to keep using the root.`
        );
        process.exit(1);
      }
    } catch (err) {
      // The net is a courtesy, not a gate. If the root cannot be listed, that
      // is the same unreachable-target condition the table already fails open
      // on, and turning it into a refusal here would be the outage-for-
      // integrity trade this track exists to avoid.
      console.error(`[rehydrate] orphan check skipped: ${err.message}`);
    }
  }

  const verdict = decideBoot({
    dataPopulated: !isEmptyish(dataDir),
    repoPopulated: !isEmptyish(repoDir),
    generationCount: generations.length,
    workspaceMode:
      process.env.HUB_WORKSPACE_MODE === '1' || process.env.MAUDE_WORKSPACE_MODE === '1',
    seedConfigured: Boolean(process.env.MAUDE_SEED_REPO),
    allowEmptyStart: process.env.MAUDE_ALLOW_EMPTY_START === '1',
    listFailed,
  });

  if (verdict.action === 'refuse') {
    console.error(`[rehydrate] refusing to start — ${verdict.reason}`);
    process.exit(1);
  }
  if (verdict.action !== 'restore') {
    // proceed / seed / fresh all mean "nothing to restore here". A tenant can
    // have written journal rows before its first backup fired, and those seqs
    // are already in peers' cursors, so the tail is replayed even on the paths
    // that restore nothing else.
    console.log(`[rehydrate] ${verdict.action} — ${verdict.reason}`);
    await settleJournal(dataDir, target);
    process.exit(0);
  }

  // WALK BACK THROUGH GENERATIONS. The newest is tried first, but a generation
  // that cannot be restored must not be the end of it: a cell whose latest
  // backup is bad still has yesterday's, and refusing outright would leave the
  // tenant unreachable over a fault that older copies do not share.
  //
  // Learned the hard way: the alligators cell was seeded with a shallow clone,
  // so every generation it wrote contained a bundle that `git clone` refuses.
  // The cell crash-looped rather than falling back, and "refuses to start"
  // looked identical to "the platform is broken".
  const newestFirst = [...generations].reverse();
  const attempted = [];
  try {
    let result = null;
    for (const which of newestFirst) {
      try {
        result = await restoreLatest({
          target,
          which,
          destDir: dataDir,
          repoDir,
          run: createGitRunner(),
          // The working set is empty on a cold start — the boot table above
          // established that. Not forcing means a restore over live data fails
          // loudly instead of overwriting it.
          force: false,
          // Phase 0 F2 — whose generation is this? A hub that lost `/data` has
          // no local identity, so ownership falls to the keyspace: a dedicated
          // prefix means these generations are ours by construction, while the
          // bare bucket root is shared by definition and cannot answer.
          ownership: {
            localId: readWorkspaceId(dataDir),
            prefixSet: Boolean(process.env.MAUDE_BACKUP_PREFIX),
          },
        });
        break;
      } catch (err) {
        attempted.push(`${which}: ${err.message.slice(0, 160)}`);
        // Clear whatever the failed attempt left behind, or the next attempt
        // refuses on "already exists" and the fallback is no fallback at all.
        const { rmSync } = await import('node:fs');
        for (const dir of [dataDir, repoDir]) {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            /* best effort — the next attempt reports it */
          }
        }
      }
    }
    if (!result) {
      console.error(
        `[rehydrate] every backup generation failed to restore:\n  ${attempted.join('\n  ')}`
      );
      process.exit(1);
    }
    if (attempted.length > 0) {
      // Loud, because a tenant restored from an older copy has LOST work, and
      // finding that out from the data rather than from a message is the worst
      // way to learn it.
      console.error(
        `[rehydrate] restored an OLDER generation — ${attempted.length} newer one(s) could not be ` +
          `restored:\n  ${attempted.join('\n  ')}`
      );
    }
    // Keep writing as the workspace we just restored. Without this the next
    // backup tick would mint a fresh identity, look like a second hub arriving
    // in its own keyspace, and the write-side refusal would fire against the
    // very hub it protects.
    if (result.adopt) adoptWorkspaceId(dataDir, result.adopt);

    // ANNOUNCE IT. A hub that quietly came back from a five-day-old generation
    // and resumed committing is a worse incident than one that refused,
    // because no investigation ever starts. The age is reported, never used as
    // a kill switch — dying here would fire in the case where booting is
    // obviously right.
    const createdAt = result.manifest?.createdAt;
    const ageHours = createdAt ? Math.round((Date.now() - Date.parse(createdAt)) / 36e5) : null;
    console.log(
      `[rehydrate] RESTORED ${result.generation}` +
        (ageHours === null ? '' : ` (${ageHours}h old)`) +
        ` — ${result.restored.join(', ')}${result.repo?.state === 'restored' ? ' + checkout' : ''}`
    );
    if (result.manifest.repo && result.repo?.state !== 'restored') {
      // The generation carried a checkout and we did not end up with one. The
      // documents would open against an empty history, and the autosave agent
      // would commit over it.
      console.error(
        `[rehydrate] the generation contains a checkout but it was not restored ` +
          `(${result.repo?.reason ?? 'unknown'})`
      );
      process.exit(1);
    }
    // The generation is on disk. NOW replay the tail and decide the epoch —
    // in that order, never the other way round (see settleJournal).
    await settleJournal(dataDir, target);
    // …and the documents written after the generation (G3b): a hard kill lost
    // them before the write-behind existed.
    await settleDocuments(dataDir, target);
    process.exit(0);
  } catch (err) {
    console.error(`[rehydrate] restore failed: ${err.message}`);
    process.exit(1);
  }
}

// Run only when invoked as a program. The boot table above is exported so it
// can be tested directly, and an unguarded `await main()` would exit the test
// runner's process the moment the module was imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
