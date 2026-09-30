// Is this repo's .gitignore telling git to drop content Maude calls VERSIONED?
//
// THE FAILURE THIS DETECTS. DDR-115 splits the design root in two: per-machine
// runtime state is ignored, and durable project content (`*.tsx`,
// `*.meta.json`, `*.annotations.svg`, `system/**`, `config.json`) is committed.
// `gitignore-block.mjs` encodes that — the versioned paths are "deliberately
// absent" from the block it writes. But that block lives between
// `# maude:begin` / `# maude:end` markers and `applyBlock` only ever replaces
// what is BETWEEN them, so a rule sitting OUTSIDE the markers is invisible to
// it, forever.
//
// Observed in a real project (Brno Alligators, 2026-08-13): a hand-authored
// pre-markers block carried `.design/*.annotations.svg`, copied from a v1.0
// planning document that predates the DDR-115 correction. Consequence: not one
// annotation sidecar had ever been committed. The draw layer was live in both
// UIs and absent from every clone, every backup and every PR — and nothing
// anywhere said so, because each half was behaving exactly as written. Maude
// believed the file was versioned; git had been told otherwise years earlier.
//
// WHY DETECTION AND NOT SILENT SURGERY. The obvious "fix" is to make the block
// writer delete offending lines. It must not: those lines are OUTSIDE our
// markers, which is precisely the region the writer promises never to touch
// ("anything the user authored outside the markers is untouched"). A tool that
// quietly edits a person's hand-written gitignore on every `maude design link`
// is a worse bug than the one it closes. So this module only ever REPORTS, and
// removal is an explicit `maude doctor --fix` — the surface whose whole contract
// is that it is never silent.

/**
 * Design-root-relative patterns that name VERSIONED content.
 *
 * Kept as literal shapes rather than a glob engine on purpose: this decides
 * whether to propose deleting a line from somebody's `.gitignore`, and a clever
 * matcher that is right 95 % of the time is not good enough for that. Every
 * entry here is a rule that CANNOT be legitimate under DDR-115 — matching one is
 * proof of drift, not a heuristic. Mirrors the "deliberately absent" list in
 * `gitignore-block.mjs` and the taxonomy in `apps/studio/git/service.ts`.
 */
const VERSIONED_PATTERNS = [
  { pattern: '*.annotations.json', what: 'canvas draw layers (annotations)' },
  { pattern: '*.annotations.svg', what: 'canvas draw layers (annotations, v1 form)' },
  { pattern: '*.meta.json', what: 'canvas sidecars (layout, artboards, tags)' },
  { pattern: '*.tsx', what: 'canvas bodies' },
  { pattern: 'config.json', what: 'the project design config' },
  { pattern: 'system', what: 'the design system' },
  { pattern: 'system/', what: 'the design system' },
  { pattern: 'system/**', what: 'the design system' },
];

/** One `.gitignore` line that ignores versioned content. */
/**
 * @typedef {object} GitignoreDrift
 * @property {number} line     1-indexed line number in `.gitignore`
 * @property {string} text     the offending line, verbatim
 * @property {string} pattern  the design-root-relative shape it matched
 * @property {string} what     plain-language name of what it drops
 */

/**
 * Find rules that ignore VERSIONED design content.
 *
 * SCOPED TO THE DESIGN ROOT. Only lines that explicitly name the design root
 * (`.design/*.annotations.svg`) are considered. A bare `*.tsx` at the repo root
 * is a decision about a whole codebase — very possibly deliberate, and never
 * ours to second-guess from here.
 *
 * NEGATIONS ARE NOT DRIFT. A `!` line RE-INCLUDES a path; it is the fix, not the
 * fault. Comments and blank lines are skipped.
 *
 * Lines INSIDE the `# maude:begin` / `# maude:end` markers are skipped too: that
 * region is generated, so anything wrong there is a bug in the generator and is
 * corrected by re-running it, not by editing a person's file.
 *
 * @param {string} contents  raw `.gitignore` text ('' when absent)
 * @param {string} designRel design root relative to the repo root
 * @returns {GitignoreDrift[]}
 */
export function findGitignoreDrift(contents, designRel = '.design') {
  const root = String(designRel ?? '.design')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
  if (!root) return [];
  /** @type {GitignoreDrift[]} */
  const out = [];
  let inBlock = false;
  const lines = String(contents ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.trim();
    if (text === '# maude:begin') {
      inBlock = true;
      continue;
    }
    if (text === '# maude:end') {
      inBlock = false;
      continue;
    }
    if (inBlock || !text || text.startsWith('#') || text.startsWith('!')) continue;
    // Anchor and trailing-slash forms are the same rule to git.
    const body = text.replace(/^\/+/, '').replace(/\/+$/, '');
    if (body === root) continue; // ignoring the WHOLE design root is a choice, not drift
    if (!body.startsWith(`${root}/`)) continue;
    // Normalise BOTH sides the same way, or the comparison silently never
    // matches: `system/**` was stripped to `system` on the pattern side only, so
    // a real `.design/system/**` rule — a shape this module lists as versioned —
    // was reported clean. A detector that quietly covers less than it claims is
    // worse than one that covers less openly.
    const norm = (s) => s.replace(/\/+$/, '').replace(/\/\*\*$/, '');
    const rel = norm(body.slice(root.length + 1));
    const hit = VERSIONED_PATTERNS.find((p) => rel === norm(p.pattern));
    if (hit) out.push({ line: i + 1, text, pattern: hit.pattern, what: hit.what });
  }
  return out;
}

/**
 * Remove the drifting lines, and only those.
 *
 * Deletes whole lines by NUMBER, taken from a `findGitignoreDrift` run over the
 * same text — never by re-matching, so what is removed is exactly what was
 * reported to the person who approved it. Everything else, including their
 * comments and their blank lines, survives byte-for-byte.
 *
 * @param {string} contents
 * @param {GitignoreDrift[]} drift
 * @returns {string}
 */
export function removeGitignoreDrift(contents, drift) {
  if (!drift?.length) return contents;
  const drop = new Set(drift.map((d) => d.line));
  return String(contents ?? '')
    .split('\n')
    .filter((_, i) => !drop.has(i + 1))
    .join('\n');
}

/**
 * One line per finding, for the report.
 *
 * Names the CONSEQUENCE, not the rule: "your annotations are never committed"
 * is what the person needs to hear. The rule is already on screen.
 *
 * @param {GitignoreDrift[]} drift
 * @returns {string[]}
 */
export function describeGitignoreDrift(drift) {
  return (drift ?? []).map(
    (d) => `.gitignore:${d.line}  ${d.text}  — drops ${d.what} from git (DDR-115 says versioned)`
  );
}
