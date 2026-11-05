// client/v2/code/canvas-imports-words.js — the words for a canvas whose frame refuses its module because it
// reaches another canvas's code (gate-b-c4j) or, 2.0.5 (#205), because its built module inlined a file another
// canvas owns. Pure: the shell's card (canvas-imports-card.jsx), `maude design ds-check` (ds/canvas-cli.ts) and
// `/design:smoke` (bin/_canvas-reasons.mjs) say the same thing.

/** "a.tsx", "a.tsx and b.tsx", "a.tsx, b.tsx and c.tsx" */
function listWords(names) {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const namesOf = (list) =>
  Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];

/**
 * The card's lines. `imports`: designRoot-relative canvases it imports that the viewer may see (may be empty);
 * `refused` (2.0.5, #205): the design-root files its built module was refused for — a file another canvas owns.
 * `title` is the first reason, `also` the other one (when both are on record), `body` what to do.
 */
export function canvasImportsText(imports, componentDir, refused = []) {
  const names = namesOf(imports);
  const uses = namesOf(refused);
  const dir =
    String(componentDir || 'ui/components').replace(/^\.?\/+|\/+$/g, '') || 'ui/components';
  const importsLine = names.length
    ? `This canvas imports another canvas (${names.join(', ')}).`
    : 'This canvas imports another canvas.';
  const usesLine = uses.length
    ? `This canvas uses ${listWords(uses)}, which ${uses.length > 1 ? 'belong' : 'belongs'} to another canvas.`
    : null;
  const lines = names.length || !usesLine ? [importsLine, usesLine] : [usesLine];
  const [title, ...also] = lines.filter(Boolean);
  return {
    title,
    also,
    body: `Move the shared part into a component file (e.g. ${dir}/…) to render it here.`,
  };
}

/** The card's words as plain lines (title, the other reason, what to do) — for a terminal or a report. */
export function canvasImportsLines(imports, componentDir, refused = []) {
  const { title, also, body } = canvasImportsText(imports, componentDir, refused);
  return [title, ...also, body];
}
