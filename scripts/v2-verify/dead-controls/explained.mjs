// Rows the walk could not re-reach on a fresh project, and the REASON each is gone. A vanished / unreachable row is
// only accepted here when its control belongs to a family below AND a sibling of that family was clicked and judged
// somewhere else in the same run (the twin is named in the report). Anything else stays 'not reached' and fails the run.
//
// Every family was checked by replaying the state on a fresh project (--replay), not assumed.
const FAMILIES = [
  {
    match: /^canvas-jump-toggle-/,
    family: /^canvas-jump-toggle-/,
    why: 'a canvas row shows its artboard twisty only once that canvas’s artboards have been read (the canvas was opened once); the walk met the row after an earlier click had opened the canvas, a fresh project has not read it yet',
  },
  {
    match: /^file-row-(cache|state|server-json|export-jobs|exports|trash)$/,
    family: /^file-row-/,
    why: 'a runtime-folder row of the hidden-files list: the server creates that folder (_cache, _state, …) only after the work that fills it; a freshly started server has not made it yet',
  },
  {
    match: /^(M|I) .* N ago$/,
    family: /^(M|I) .* N ago$/,
    why: 'a comment row named by its relative time',
  },
];

/** `{ why, twin }` when this vanished/unreachable row is accepted, else null. `results` = every row of the run. */
export function explain(row, results) {
  const control = String(row.control ?? '');
  const surfaceTail = String(row.surface ?? '')
    .split(' › ')
    .pop();
  for (const f of FAMILIES) {
    const probe = f.match.test(control) ? control : f.match.test(surfaceTail) ? surfaceTail : null;
    if (!probe) continue;
    const twin = results.find(
      (r) =>
        r.mode === row.mode &&
        r !== row &&
        f.family.test(String(r.control)) &&
        !['vanished', 'unreachable', 'twin', 'disabled', 'skipped-destructive'].includes(r.effect)
    );
    if (twin) return { why: f.why, twin: `${twin.surface} · ${twin.control}` };
  }
  return null;
}
