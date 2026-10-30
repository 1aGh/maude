// client/v2/canvases/move-model.js — S1.2: where a canvas can go (11 · pn-move, "Move to…").
//
// Pure. The folders of the tree, in tree order, each with a label that says where it sits ("2026 › combine")
// and a depth for the indent; the folder the canvas already lives in is not offered. A filter folds case
// and accents the way the panel's search does (`index/match.ts fold`), by hand here so the client keeps
// no server import.

const SEP = ' › ';

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** `[{ path, label, name, depth }]` — every folder a canvas in `fromDir` can move to. */
export function moveTargets(tree, { fromDir, projectLabel = '' } = {}) {
  const out = [];
  const single = !!tree?.single;
  const walk = (f, trail, depth, isRoot) => {
    const here = isRoot ? [] : [...trail, f.name];
    // a single canvas group's root IS the project: "Alligators brand", not ".design/ui"
    const name = isRoot ? (single ? projectLabel || f.name : f.name) : f.name;
    if (f.path !== fromDir)
      out.push({
        path: f.path,
        name,
        label: isRoot ? name : here.join(SEP),
        depth,
      });
    for (const s of f.folders) walk(s, here, depth + 1, false);
  };
  for (const r of tree?.roots || []) walk(r, [], 0, true);
  return out;
}

/** The targets whose label has every word of `query` (empty query = all). */
export function filterTargets(targets, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return targets;
  return targets.filter((t) => {
    const hay = fold(t.label);
    return words.every((w) => hay.includes(w));
  });
}
