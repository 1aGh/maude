// client/v2/ai/run-compare.js — S5.19 G4 (03 `ai-long`): Before / After and Compare in the Result card.
//
// A run that changed artboards is one version in Version history (V2-1.5: one run = one action). The
// versions list (`GET /_api/project/versions`, newest first) already carries each version's picture, so the
// card needs no thumbnail of its own: After = the run's version, Before = the version just older than it.
// Compare is the one Version history has (compare-store.js): the Before version is A, Now is B.
//
// When the list has no version older than the run (the canvas's first), or the pictures are not drawn yet,
// the card shows Compare alone (or no Compare when there is nothing to compare against) — never a made-up
// thumbnail.

import { versionsUrl } from '../history/use-versions.js';

/** The row's picture URL once it is drawn, else null. */
export const pictureUrl = (row) =>
  row?.picture?.status === 'ready' && typeof row.picture.url === 'string' ? row.picture.url : null;

/**
 * `{ after, before }` for run `runId` out of the versions rows (newest first): the run's own version and the
 * next older one that is not an undo/redo. `after` null = the run left no version in this list.
 */
export function beforeAfterOf(rows, runId) {
  const list = Array.isArray(rows) ? rows : [];
  const isUndo = (r) => !!r.undoes || r.kind === 'undo';
  const at = list.findIndex((r) => r && r.runId === runId && !isUndo(r));
  if (at < 0) return { after: null, before: null };
  const before = list.slice(at + 1).find((r) => r && !isUndo(r)) ?? null;
  return { after: list[at], before };
}

/** What the card draws: Compare when there is a Before version; the two thumbs only when BOTH are drawn. */
export function compareView({ after, before }) {
  const b = pictureUrl(before);
  const a = pictureUrl(after);
  return {
    canCompare: !!before,
    thumbs: b && a ? { before: b, after: a } : null,
    pending:
      !!before && (before.picture?.status === 'pending' || after?.picture?.status === 'pending'),
  };
}

/** Read the versions of the run's canvas. `null` when unreachable. */
export async function fetchRunVersions(
  run,
  { designRel = '.design', fetchImpl = globalThis.fetch } = {}
) {
  const canvas = run?.scope?.canvas;
  if (!canvas || !run?.runId) return null;
  const trim = (p) => String(p ?? '').replace(/^\/+|\/+$/g, '');
  const path = `${trim(designRel)}/${trim(canvas)}`.replace(/^\//, '');
  try {
    const res = await fetchImpl(versionsUrl({ path }), { cache: 'no-store' });
    const body = await res.json();
    if (!body?.ok) return null;
    return { path, ...beforeAfterOf(body.rows, run.runId) };
  } catch {
    return null;
  }
}
