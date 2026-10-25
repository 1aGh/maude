// client/v2/ds/pinned-rows.js — S10.13: the words and shapes of the pinned Design system rows (13 · ds-where-*,
// ds-multi-panel), kept out of the component so they can be pinned without a DOM.
//
//   one system     "Design system" / "Studio site system · 12 canvases"
//   several        "Design systems · 2 in use", then one row per system named after it:
//                    Alligators brand system   Default · 87 canvases
//                    Combine 2026              6 canvases · 2026/combine
//                    Alligators 2023           Draft · no canvas uses it
//   amber dot      a system made before the schema (level 11), or one missing more than the functional roles
//   no system      "Make a design system" (while the person can edit)

const canvasesWord = (n) => `${n} ${n === 1 ? 'canvas' : 'canvases'}`;

const stripRoot = (p, designRel) => {
  const s = String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const root = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  return s.startsWith(`${root}/`) ? s.slice(root.length + 1) : s;
};

/** The words behind a row's amber dot, or null: a system made before the schema (level 11), or one that
 *  misses more than the functional roles (level 10 with a reason other than `missing-functional`). */
export function dsAmber(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.level === 11) return { title: 'Made before the schema' };
  if (
    state.level === 10 &&
    Array.isArray(state.reasons) &&
    state.reasons.some((r) => r !== 'missing-functional')
  )
    return { title: 'Not up to the schema yet' };
  return null;
}

/** The deepest folder (group root stripped) that holds every one of `files`, or '' when they share none. */
function commonFolder(files, groupRoots) {
  const dirs = files.map((f) => {
    let rel = f;
    for (const r of groupRoots) if (rel.startsWith(`${r}/`)) rel = rel.slice(r.length + 1);
    return rel.split('/').slice(0, -1);
  });
  if (!dirs.length) return '';
  const first = dirs[0];
  let n = first.length;
  for (const d of dirs) {
    let i = 0;
    while (i < n && i < d.length && d[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('/');
}

/**
 * Add the second line, the count, the default flag and the amber dot to `rows` ({ dsName, label }).
 * @param {{ designSystems?: { name: string, path?: string, label?: string }[],
 *           canvasDesignSystems?: Record<string, string>, defaultDs?: string | null,
 *           designRel?: string, state?: Record<string, { label?: string, level?: number, reasons?: string[] }> }} info
 */
export function decorateRows(rows, groups, info) {
  const {
    designSystems = [],
    canvasDesignSystems = {},
    defaultDs = null,
    designRel = '.design',
    state = {},
  } = info;
  const total = rows.length;
  const owned = designSystems.map((d) => stripRoot(d.path, designRel)).filter(Boolean);
  const groupRoots = (groups || [])
    .filter((g) => g.kind === 'canvas' && g.label !== 'Design system' && g.fullPath)
    .map((g) => stripRoot(g.fullPath, designRel));
  const byDs = new Map();
  for (const [file, name] of Object.entries(canvasDesignSystems ?? {})) {
    const rel = stripRoot(file, designRel);
    if (!rel.endsWith('.tsx')) continue;
    // a system's own folder (its Design system canvas, its specimens) is not a canvas that uses it
    if (owned.some((o) => rel === o || rel.startsWith(`${o}/`))) continue;
    if (!byDs.has(name)) byDs.set(name, []);
    byDs.get(name).push(rel);
  }
  const theDefault =
    defaultDs && designSystems.some((d) => d.name === defaultDs)
      ? defaultDs
      : (designSystems[0]?.name ?? null);
  const inUse = rows.filter((r) => (byDs.get(r.dsName)?.length ?? 0) > 0).length;
  return rows.map((r) => {
    const sys = designSystems.find((d) => d.name === r.dsName);
    const st = state[r.dsName] ?? null;
    const name = String(st?.label || sys?.label || r.dsName);
    const files = byDs.get(r.dsName) ?? [];
    const amber = dsAmber(st);
    const isDefault = r.dsName === theDefault;
    let sub;
    let subLines = null;
    if (total <= 1) {
      sub = `${name} · ${canvasesWord(files.length)}`;
      // 11 pn-ds: the one system is a card of two lines — the system's name, then what uses it
      subLines = [name, canvasesWord(files.length)];
    } else if (amber && st?.level === 11) sub = amber.title;
    else if (files.length === 0)
      sub = isDefault ? 'Default · no canvas uses it' : 'Draft · no canvas uses it';
    else if (isDefault) sub = `Default · ${canvasesWord(files.length)}`;
    else {
      const folder = commonFolder(files, groupRoots);
      sub = folder ? `${canvasesWord(files.length)} · ${folder}` : canvasesWord(files.length);
    }
    return {
      ...r,
      ...(total > 1 ? { label: name } : {}),
      systemLabel: name,
      sub,
      ...(subLines ? { subLines } : {}),
      count: files.length,
      isDefault,
      draft: total > 1 && files.length === 0,
      amber,
      inUse: files.length > 0,
      grouped: inUse > 1,
    };
  });
}

/** "Design systems · 2 in use" over the rows once more than one system is in use; "Make a design system"
 *  while the project has none and the person can edit. */
export function pinnedChrome(rows, canMake) {
  const used = rows.filter((r) => r.inUse).length;
  return {
    header: used > 1 ? { title: 'Design systems', note: `${used} in use` } : null,
    empty: rows.length === 0 && canMake ? { label: 'Make a design system' } : null,
  };
}
