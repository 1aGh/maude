// client/v2/diagnostics/sync-details/sync-details-model.js — S11.12 (06 ad-syncd): what Sync details
// shows, from the live `sync:status` payload. Pure; fail-closed like the v1 panel's readers (a field
// whose shape can't be trusted is left out, never rendered as "NaN").
//
//   header   "Sync · <project>" + "<n> need you" (null when nothing does)
//   needs    the held source conflicts (Keep mine · Use theirs · Keep both + Compare) and the
//            unfinished AI edit (Publish · Discard) — what needs the person comes first
//   moving   the asset transfer in flight, with ✕ (cancel)
//   counts   Project files · Assets · Held · rate-limited · failed
//   lists    the held / rate-limited / failed detail behind those counts
//   signIn   "Sync stopped — the sign-in to the cloud ran out." (desktop only)

const isCount = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const CONFLICT_PREFIX = 'source-conflict-';

/** Printable, bounded, no control characters — names come off a hub-written payload. */
export function cleanName(raw, fallback = '') {
  const s = String(raw ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return fallback;
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/**
 * Canvas slug → the name a person knows it by. The sync runtime names a canvas by its slug (`ui/Smoke.tsx` →
 * `ui-smoke`: path separators to `-`, spaces to `_`, lower-case — sync/index.ts `slugFor`); the Needs-you card
 * read "ui-smoke changed here and in the cloud." (P8 B1). `groups` is the tree's: canvas groups list repo-relative
 * `paths`, the design root is the first segment of `fullPath`.
 */
export function canvasNamesBySlug(groups) {
  const out = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || g.kind !== 'canvas' || !Array.isArray(g.paths)) continue;
    const designRel = typeof g.fullPath === 'string' ? g.fullPath.split('/')[0] : '';
    for (const p of g.paths) {
      if (typeof p !== 'string' || !/\.(tsx|html)$/i.test(p)) continue;
      const rel = designRel && p.startsWith(`${designRel}/`) ? p.slice(designRel.length + 1) : p;
      const slug = rel
        .replace(/\//g, '-')
        .replace(/\s+/g, '_')
        .replace(/\.(tsx|html)$/i, '')
        .replace(/^\.+/, '')
        .toLowerCase();
      out.set(slug, rel.slice(rel.lastIndexOf('/') + 1).replace(/\.(tsx|html)$/i, ''));
    }
  }
  return out;
}

/** A canvas slug the runtime can name (no path, no traversal) — the same rule the bus applies. */
export const SAFE_SLUG = /^[A-Za-z0-9_.-]{1,200}$/;

/**
 * The held source conflicts (the runtime's `source-conflict-<slug>` notices, sync/status.ts), each with the
 * time the runtime raised it: `{ slug, at }`. `at` tells one conflict from a later one on the same canvas
 * (a resolved conflict's notice is cleared; a new one is a new notice), so the one-time toast keys on both.
 */
export function heldConflicts(status) {
  const out = [];
  for (const n of Array.isArray(status?.notices) ? status.notices : []) {
    if (!n || typeof n.id !== 'string' || !n.id.startsWith(CONFLICT_PREFIX)) continue;
    const slug = n.id.slice(CONFLICT_PREFIX.length);
    if (!SAFE_SLUG.test(slug) || out.some((c) => c.slug === slug)) continue;
    out.push({ slug, at: Number.isFinite(n.at) ? n.at : 0 });
  }
  return out;
}

/** The canvases with a held source conflict (the runtime's `source-conflict-<slug>` notices). */
export function conflictSlugs(status) {
  return heldConflicts(status).map((c) => c.slug);
}

function readAssets(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.total, raw.done, raw.failedCount].every(isCount)) return null;
  return raw;
}

function readFiles(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.synced, raw.pulled, raw.conflicts].every(isCount)) return null;
  return raw;
}

function readProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.tracked, raw.delivered, raw.remaining].every(isCount)) return null;
  return raw;
}

const ATTENTION = new Set(['conflict', 'stuck', 'referenced-but-unoffered', 'local-only']);

/** Words for the per-file states a person has to look at (file-ledger.ts owns the union). */
export const DELIVERY_WORD = Object.freeze({
  conflict: 'conflict — the older copy is in the trash',
  stuck: 'stuck',
  'referenced-but-unoffered': 'used, never received',
  'local-only': 'only on this Mac',
});

const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function syncDetailsModel(
  status,
  { project = '', cloud = null, native = false, refused = false } = {}
) {
  const needs = conflictSlugs(status).map((slug) => ({ kind: 'conflict', slug }));
  const ai = status?.aiAction?.state === 'held' ? status.aiAction : null;
  if (ai) {
    needs.push({
      kind: 'ai',
      label: cleanName(ai.label, 'AI edit'),
      canvases: Array.isArray(ai.canvases) ? ai.canvases.length : 0,
    });
  }

  const assets = readAssets(status?.assets);
  // P8 B1 — failed media uploads ("3 media uploads failed", the menu's own word for them) sat under Needs you
  // in the menu but not in this tab: the card list had no row for them, so "Needs you" opened onto nothing.
  // The v1 Sync panel listed them with their reasons and "retry on the next launch"; so does this.
  if (assets && assets.failedCount > 0) {
    const failures = Array.isArray(assets.failures) ? assets.failures : [];
    needs.push({
      kind: 'assets-failed',
      count: assets.failedCount,
      failures: failures.slice(0, 5).map((f) => ({
        name: cleanName(f?.key, '(unnamed)'),
        reason: cleanName(f?.reason, 'failed'),
      })),
    });
  }
  const moving =
    assets && !assets.finished && assets.total > 0
      ? {
          name: cleanName(assets.active, ''),
          pct: Math.min(100, Math.round((assets.done / assets.total) * 100)),
          done: assets.done,
          total: assets.total,
        }
      : null;

  const files = readFiles(status?.files);
  const progress = readProgress(status?.files?.progress);
  const held = Array.isArray(files?.held)
    ? files.held.filter((h) => h && typeof h.kind === 'string')
    : [];
  const rateLimited = files?.rateLimited
    ? isCount(files.rateLimited.waiting)
      ? files.rateLimited.waiting
      : 0
    : 0;
  const failed = files && isCount(files.failed) ? files.failed : 0;
  const attention = [];
  const delivery = status?.files?.delivery;
  if (delivery && typeof delivery === 'object' && !Array.isArray(delivery)) {
    for (const [rel, state] of Object.entries(delivery))
      if (typeof state === 'string' && ATTENTION.has(state)) attention.push([rel, state]);
    attention.sort((a, b) => a[0].localeCompare(b[0]));
  }

  const counts = [];
  if (progress) {
    counts.push([
      'files',
      'Project files',
      progress.remaining > 0
        ? `${thousands(progress.delivered)} of ${thousands(progress.tracked)}`
        : `${thousands(progress.tracked)} · all here`,
    ]);
  } else if (files) {
    counts.push(['files', 'Project files', `${thousands(files.synced)} · all here`]);
  }
  if (assets) {
    counts.push([
      'assets',
      'Assets',
      moving
        ? `${thousands(assets.total)} · ${assets.total - assets.done} moving`
        : thousands(assets.total),
    ]);
  }
  if (files) {
    counts.push([
      'held',
      'Held · rate-limited · failed',
      `${held.length} · ${files.rateLimited ? Math.max(1, rateLimited) : 0} · ${failed}`,
    ]);
  }

  return {
    title: `Sync · ${cleanName(project, 'this project')}`,
    needWord: needs.length ? `${needs.length} need you` : null,
    needs,
    moving,
    counts,
    lists: {
      held: held.map((h) => ({
        kind: h.kind,
        detail: cleanName(h.detail, 'Sync paused — nothing was removed.'),
        paths: Array.isArray(h.paths)
          ? h.paths.filter((p) => typeof p === 'string').slice(0, 50)
          : [],
      })),
      rateLimited: files?.rateLimited ? { waiting: rateLimited } : null,
      failed,
      attention: attention.slice(0, 50),
    },
    signIn: refused && !cloud && native,
  };
}

/** The sentence after a pick (CONTRACT §3–§4: plain, no "we"). */
export function resolvedWords(choice, answer) {
  if (!answer?.ok) {
    if (answer?.code === 'still-editing')
      return 'This canvas is still changing. Try again in a moment.';
    if (answer?.code === 'no-local-version') return 'This Mac’s version is gone — nothing to keep.';
    return cleanName(answer?.error, 'That didn’t work. Both versions are still here.');
  }
  if (choice === 'keep-both') {
    const name = cleanName(
      answer.copy?.rel
        ?.split('/')
        .pop()
        ?.replace(/\.tsx$/i, ''),
      'a copy'
    );
    return `Both kept. This Mac’s version is “${name}”.`;
  }
  if (choice === 'mine') return 'Your version is the canvas now.';
  return 'The cloud’s version is the canvas now.';
}
