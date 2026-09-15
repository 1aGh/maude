// Baseline import — entering accepted revisions without losing a byte.
// DDR-241 §7, plan T30.
//
// When a project switches to `transactions` mode the store must hold EVERY
// document the project has, or the first proposal against a legacy document
// meets `dependency-missing` and the designer's work has nowhere to go. The
// switch has already fenced every socket (read-only on reconnect, epoch
// advanced), so what the documents hold now is final: it is read once and
// committed as ordinary accepted actions by the `maude-migration` actor.
//
//   • a document the store has never seen      → doc.create with its lanes;
//   • a document whose content moved on while
//     the project was back in legacy mode       → lane.replace from the head,
//     so re-entering never rolls back legacy-era work (T30 rollback boundary);
//   • folders the checkout has                  → dir.create;
//   • tombstoned or retired (moved-away) docs   → skipped (they are gone);
//   • a body that does not validate             → the checkout's last valid
//     body when there is one, else skipped and REPORTED — never imported
//     invalid, never silently dropped.
//
// Chunked so no single action exceeds the proposal limits.

import { canvasSlugFromRel } from '../../../studio/canvas-slug.ts';
import { validateCanvasPath } from '../../../studio/sync/canvas-path.ts';
import { checkLane, LANE_NAMES, laneHash, readLane } from './lanes.mjs';

export const MIGRATION_ACTOR = 'maude-migration';
const MAX_OPS_PER_ACTION = 200;
const MAX_BYTES_PER_ACTION = 12 * 1024 * 1024;
const DOC_SLUG = /^(?:ws\/[^/]+\/[^/]+\/)?([^/]+)$/;

/**
 * @param {object} deps
 * @param {{ openDirectConnection(name: string, ctx: object): Promise<any> }} deps.hocuspocus
 * @param {object} deps.store         project store (async API)
 * @param {object} deps.kernel        acceptance kernel (`submit`)
 * @param {string} deps.projectId
 * @param {() => {name: string}[]} deps.listDocuments   the document storage listing
 * @param {() => Set<string>} [deps.tombstoned]         names deleted in the project
 * @param {(slug: string) => string|null} [deps.checkoutPath]  a canvas's path on the checkout
 * @param {(rel: string) => string|null} [deps.checkoutBody]   the checkout's body at a path
 * @param {() => string[]} [deps.checkoutDirs]           folders under the canvas groups
 * @param {() => string[]|null} [deps.canvasGroups]
 * @param {string} [deps.designRel]
 */
export async function importBaseline(deps) {
  const {
    hocuspocus,
    store,
    kernel,
    projectId,
    listDocuments,
    tombstoned = () => new Set(),
    checkoutPath = () => null,
    checkoutBody = () => null,
    checkoutDirs = () => [],
    canvasGroups = () => null,
    designRel = '.design',
  } = deps;
  const manifest = await store.manifest();
  const known = new Map(manifest.docs.map((d) => [d.doc, d]));
  const dead = tombstoned();
  const ops = [];
  const report = { created: 0, updated: 0, dirs: 0, skipped: [] };

  const validPath = (slug, path) => {
    if (typeof path !== 'string' || !path) return false;
    const groups = canvasGroups();
    return validateCanvasPath({
      path,
      slug,
      designRel,
      canvasGroups: groups ?? undefined,
      allowUndeclaredGroup: !groups || groups.length === 0,
    }).ok;
  };

  for (const { name } of listDocuments()) {
    if (name === 'maude.files' || dead.has(name)) continue;
    const slug = DOC_SLUG.exec(name)?.[1];
    if (!slug) continue;
    const head = known.get(name);
    if (head?.retired) continue;

    const lanes = {};
    let carriedPath = null;
    let movedTo = null;
    const conn = await hocuspocus.openDirectConnection(name, { migration: true });
    try {
      await conn.transact((doc) => {
        for (const lane of LANE_NAMES) lanes[lane] = readLane(doc, lane);
        const meta = doc.getMap('syncMeta');
        carriedPath = meta.get('path') ?? null;
        movedTo = meta.get('movedTo') ?? null;
      });
    } finally {
      await conn.disconnect();
    }
    if (movedTo && !head) continue; // a legacy move's retired half

    const path = head?.path ?? (validPath(slug, carriedPath) ? carriedPath : checkoutPath(slug));
    if (!path || !validPath(slug, path)) {
      report.skipped.push({ doc: name, reason: 'no valid canvas path' });
      continue;
    }
    if (lanes.html) {
      const verdict = checkLane('html', lanes.html, { path });
      if (!verdict.ok) {
        const fallback = checkoutBody(path);
        if (fallback && checkLane('html', fallback, { path }).ok) {
          lanes.html = fallback;
        } else {
          report.skipped.push({ doc: name, reason: `source-invalid: ${verdict.reason}` });
          continue;
        }
      }
    }
    const clean = {};
    for (const lane of LANE_NAMES) {
      const v = lanes[lane];
      if (!v) continue;
      const checked = checkLane(lane, v, { path });
      if (checked.ok && checked.content) clean[lane] = checked.content;
    }

    if (!head) {
      if (Object.keys(clean).length === 0) {
        report.skipped.push({ doc: name, reason: 'empty document' });
        continue;
      }
      ops.push({ op: 'doc.create', doc: name, path, lanes: clean });
      report.created += 1;
      continue;
    }
    // Known document: carry forward whatever changed while the project was
    // legacy, lane by lane, from the head the store holds.
    for (const lane of LANE_NAMES) {
      const current = clean[lane] ?? '';
      const headHash = head.lanes[lane]?.hash ?? null;
      const currentHash = current === '' ? null : laneHash(current);
      if ((headHash ?? null) === currentHash) continue;
      ops.push({
        op: 'lane.replace',
        doc: name,
        lane,
        ...(headHash ? { base: headHash } : {}),
        content: current,
      });
      report.updated += 1;
    }
  }

  const haveDirs = new Set(manifest.dirs);
  for (const dir of checkoutDirs()) {
    if (haveDirs.has(dir)) continue;
    ops.push({ op: 'dir.create', path: dir });
    report.dirs += 1;
  }

  // Commit in bounded actions.
  const chunks = [];
  let current = [];
  let bytes = 0;
  for (const op of ops) {
    const size = Buffer.byteLength(JSON.stringify(op), 'utf8');
    if (
      current.length &&
      (current.length >= MAX_OPS_PER_ACTION || bytes + size > MAX_BYTES_PER_ACTION)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(op);
    bytes += size;
  }
  if (current.length) chunks.push(current);

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const state = await store.state();
    const label =
      chunks.length > 1
        ? `Import project baseline (${i + 1}/${chunks.length})`
        : 'Import project baseline';
    const envelope = JSON.stringify({
      protocol: 1,
      projectId,
      epoch: state.epoch,
      transactionId: `tx_migration_${state.epoch}_${Date.now()}_${i}`,
      origin: { deviceId: 'hub', sessionId: 'migration', client: 'hub' },
      action: { kind: 'migration.import', label, operations: chunks[i] },
    });
    const { status, body } = await kernel.submit(envelope, {
      actor: MIGRATION_ACTOR,
      readOnly: false,
    });
    results.push({ status, code: body.code ?? null, revision: body.revision ?? null });
    if (status !== 200) {
      report.failed = { chunk: i + 1, code: body.code, reason: body.reason ?? null };
      break;
    }
  }
  report.actions = results.length;
  return report;
}

/** The slug a checkout path maps to (the rule the kernel checks). */
export function slugOfPath(rel, designRel = '.design') {
  return canvasSlugFromRel(rel, designRel);
}
