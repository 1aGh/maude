// Maude design-runtime .gitignore block — Phase 9 Task 9 (gitignore strategy).
//
// Single `full` strategy in v1.1 (DDR-056): canvases + their JSON snapshots
// stay in git (cold backup, PR-reviewable .html diffs, bootstrap-from-clone),
// while regenerable per-machine runtime state is ignored — even in linked mode.
//
// The rules live between `# maude:begin` / `# maude:end` markers so the writer
// is idempotent: re-running replaces the block in place (never duplicates), and
// anything the user authored outside the markers is untouched. `maude design
// unlink` deliberately leaves the block — the rules are harmless in solo mode
// (the ignored files just don't get created).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BEGIN_MARKER = '# maude:begin';
export const END_MARKER = '# maude:end';

/**
 * The runtime paths Maude ignores under the design root, relative to repo root.
 * `designRel` defaults to `.design` (the only design root in v1.1 defaults).
 */
export function buildBlock(designRel = '.design', { s3Assets = false } = {}) {
  const root = designRel.replace(/\/+$/, '');
  // The canonical IGNORED set is the DDR-115 runtime-state taxonomy — kept in
  // lockstep with `apps/studio/git/service.ts` (isMaudeRuntimeState backstop)
  // and the repo's own `.gitignore`. VERSIONED content (canvases, `.meta.json`,
  // `*.annotations.json` (v1 `.svg`), `system/**`, `config.json`) is deliberately absent.
  const lines = [
    BEGIN_MARKER,
    '# Maude design plugin runtime — gitignored even in linked mode (DDR-056/DDR-115).',
    // Per-machine runtime JSON.
    `${root}/_server.json`,
    `${root}/_server.log`,
    `${root}/_server.lock`,
    `${root}/_active.json`,
    // Per-member siblings in a cloud cell (Phase 27 D3) — same runtime state,
    // one file per person, and no more committable than the singleton.
    `${root}/_active.*.json`,
    `${root}/_sync.json`, // linked-mode offline/sync status (Task 8)
    `${root}/_preflight.json`,
    `${root}/_locator.json`, // regenerable slug→path index
    `${root}/_export-history.json`,
    `${root}/_generate-history.json`, // AI-media generation job ledger (regenerable — feature-ai-media-generation, DDR-16x)
    // Per-machine / per-user dirs.
    `${root}/_export-jobs/`, // background-export job byte store (regenerable — feature-background-export-notification-center)
    `${root}/_state/`, // binary CRDT logs (regenerable from hub)
    `${root}/_history/`,
    `${root}/_trash/`, // soft-deleted canvases (recoverable locally — Phase 22 delete)
    `${root}/_draw/`, // draw-agent proof canvases (regenerable — Phase 25)
    `${root}/_photo/`, // photo-bg-remove headless proof canvases (regenerable — feature-photo-editor)
    `${root}/_smoke/`, // batch-screenshot output (regenerable — DDR-021)
    `${root}/_reports/`, // offline bug-report bundles (feature-bug-report-button — local fallback, may hold screenshots)
    `${root}/_canvas-state/`, // per-machine canvas scratch + camera (`*.view.json`, DDR-115)
    `${root}/_chat/`, // ACP transcripts (per-machine)
    `${root}/_untrusted/`, // hub-synced untrusted file mirror (DDR-054)
    `${root}/_comments/`, // hub-sync-only collab comments (DDR-102/DDR-115 — never git)
    // Cloud Phase 3 Task 2 — when an S3/R2 asset lane is configured, binary
    // media lives in the bucket and must STOP entering git: a 60 MB clip is
    // 60 MB in every clone forever, and delta compression does nothing for it.
    // Off by default, because without a bucket the only copy of an asset is the
    // one in the repo and ignoring it would delete people's media on the next
    // clean checkout.
    ...(s3Assets
      ? [
          `${root}/assets/`, // binary media lives in the S3/R2 bucket (DDR-192 §1)
        ]
      : []),
    // kgai knowledge-graph projection (repo-root, NOT under the design root) —
    // per-machine append-only store, rebuilds from the remote on `kg sync`
    // (feature-kgai-ecosystem-integration, DDR-115). kgai itself also ignores it.
    '.kgai/',
    END_MARKER,
  ];
  return `${lines.join('\n')}\n`;
}

/** True when the file already contains a maude-managed block. */
export function hasBlock(contents) {
  return contents.includes(BEGIN_MARKER) && contents.includes(END_MARKER);
}

/**
 * Replace the existing maude block in `contents`, or append a fresh one.
 * Pure — returns the new file text. Preserves everything outside the markers.
 */
export function applyBlock(contents, block) {
  if (!hasBlock(contents)) {
    // Append with a single blank-line separator (avoid leading newline on an
    // empty file; avoid double-blank when the file already ends in a newline).
    if (contents.length === 0) return block;
    const sep = contents.endsWith('\n') ? '\n' : '\n\n';
    return `${contents}${sep}${block}`;
  }
  const begin = contents.indexOf(BEGIN_MARKER);
  const endIdx = contents.indexOf(END_MARKER);
  const after = endIdx + END_MARKER.length;
  // Consume one trailing newline after END so we don't accumulate blank lines.
  const tail = contents.slice(after).replace(/^\n/, '');
  const head = contents.slice(0, begin);
  return `${head}${block}${tail ? `\n${tail}` : ''}`;
}

/**
 * Write (or refresh) the maude block in `<repoRoot>/.gitignore`.
 *
 * @param {string} repoRoot
 * @param {{ designRel?: string, dryRun?: boolean }} [opts]
 * @returns {{ action: 'created' | 'updated' | 'unchanged', path: string }}
 */
export function writeGitignoreBlock(repoRoot, { designRel = '.design', dryRun = false } = {}) {
  const path = resolve(repoRoot, '.gitignore');
  const existed = existsSync(path);
  const current = existed ? readFileSync(path, 'utf8') : '';
  const block = buildBlock(designRel);
  const next = applyBlock(current, block);

  let action;
  if (!existed) action = 'created';
  else if (next === current) action = 'unchanged';
  else action = 'updated';

  if (!dryRun && next !== current) {
    writeFileSync(path, next, 'utf8');
  }
  return { action, path };
}
