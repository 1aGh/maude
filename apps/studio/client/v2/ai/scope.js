// client/v2/ai/scope.js — S5.8 (03 AI Chat `ai-scope`): the composer's scope chip, as pure functions.
//
// The chip says what AI touches. It follows the selection (nothing selected = the whole canvas; one
// artboard = its short name; several = a count) until the person narrows it in the chip's menu —
// Whole canvas · the artboard in view · Choose artboards… · No canvas — just ask. Opening the panel
// (⌘/) or changing the selection puts it back on "follows the selection" (⌘/ always attaches what is
// selected now).
//
// A scope is `{ kind: 'whole' } | { kind: 'artboards', ids: string[] } | { kind: 'none' }` or, since S2.19
// (⌘/ on a selection, in place), `{ kind: 'elements', refs, ids, selected? }`: the elements the person selected
// (`refs`: `{artboard, element, occurrence?}`), the artboards they sit on (`ids`, what the run leases) and the
// canvas's locators for them (`selected`, only for the prompt's `[selected: …]` lines). A *choice* is a scope
// the person picked, or `null` for "follow the selection".
//
// No DOM, no React: test/v2-ai-scope.test.ts runs it directly.

/** Longest artboard name the chip shows; the CSS ellipsis is the second line of defence. */
export const SCOPE_NAME_MAX = 28;

/** The most elements one ask names — the server's cap (acp/index.ts MAX_SCOPE_ELEMENTS). */
export const SCOPE_ELEMENTS_MAX = 200;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const first = (s) => (Array.isArray(s) ? s : s == null ? [] : [s]);

/** "Post 1:1 · Combine 2026" → "Post 1:1". Cut, never wrapped. */
export function shortArtboardName(label, max = SCOPE_NAME_MAX) {
  const head = String(label ?? '')
    .split(' · ')[0]
    .trim();
  if (head.length <= max) return head;
  return `${head.slice(0, max - 1).trimEnd()}…`;
}

/** The artboard ids a selection reaches on `canvas`, in selection order, each once. */
export function selectedArtboardIds(selected, canvas) {
  const out = [];
  for (const el of first(selected)) {
    if (!el || typeof el !== 'object') continue;
    if (canvas && el.file && el.file !== canvas) continue;
    const id = typeof el.artboardId === 'string' && el.artboardId ? el.artboardId : null;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The scope the selection implies (the chip's default). */
export function autoScope({ selected, canvas } = {}) {
  const ids = selectedArtboardIds(selected, canvas);
  return ids.length ? { kind: 'artboards', ids } : { kind: 'whole' };
}

/** A person's choice wins over the selection. */
export function resolveScope(choice, auto) {
  return choice ?? auto ?? { kind: 'whole' };
}

/**
 * S2.19 — the scope of ⌘/ on a selection. `refs` are the canvas's own `select-set` refs; anything that is not
 * a plain id is dropped, a duplicate folds, and an empty result is no scope (→ null).
 * @returns {{ kind: 'elements', refs: object[], ids: string[], selected: object[] } | null}
 */
export function elementsScope(refs, selected = []) {
  const out = [];
  const seen = new Set();
  for (const r of first(refs)) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.artboard !== 'string' || !ID_RE.test(r.artboard)) continue;
    if (typeof r.element !== 'string' || !ID_RE.test(r.element)) continue;
    const occ =
      Number.isInteger(r.occurrence) && r.occurrence >= 0 && r.occurrence < 10000
        ? r.occurrence
        : undefined;
    const key = `${r.artboard}\u0000${r.element}\u0000${occ ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      artboard: r.artboard,
      element: r.element,
      ...(occ !== undefined ? { occurrence: occ } : {}),
    });
    if (out.length >= SCOPE_ELEMENTS_MAX) break;
  }
  if (!out.length) return null;
  return {
    kind: 'elements',
    refs: out,
    ids: [...new Set(out.map((r) => r.artboard))],
    selected: first(selected).filter((e) => e && typeof e === 'object'),
  };
}

const labelOf = (id, artboards) => {
  const a = (artboards || []).find((x) => x.id === id);
  return a?.label ?? id;
};

/** The chip's text (without the ◆ — the component draws that). */
export function scopeLabel(scope, artboards = []) {
  if (!scope || scope.kind === 'whole') return 'Whole canvas';
  if (scope.kind === 'none') return 'No canvas';
  if (scope.kind === 'elements') {
    const n = scope.refs?.length ?? 0;
    return n === 1 ? '1 element' : `${n} elements`;
  }
  const ids = scope.ids || [];
  if (ids.length === 0) return 'Whole canvas';
  if (ids.length === 1) return shortArtboardName(labelOf(ids[0], artboards));
  return `${ids.length} artboards`;
}

/** Full names, for the hover list on a several-artboards chip. */
export function scopeNames(scope, artboards = []) {
  if (!scope || scope.kind !== 'artboards') return [];
  return (scope.ids || []).map((id) => labelOf(id, artboards));
}

/** What the chip's tooltip says: the same words the chip reads, with the full names when it counts. */
export function scopeTitle(scope, artboards = []) {
  if (scope?.kind === 'none') return 'AI answers without the canvas';
  if (scope?.kind === 'elements')
    return scope.refs.length === 1 ? 'AI works on this element' : 'AI works on these elements';
  if (scope?.kind === 'artboards' && scope.ids.length > 1)
    return `AI works on: ${scopeNames(scope, artboards).join(', ')}`;
  if (scope?.kind === 'artboards') return `AI works on ${scopeNames(scope, artboards)[0]}`;
  return 'AI works on the whole canvas';
}

const sameIds = (a = [], b = []) => a.length === b.length && a.every((id) => b.includes(id));

/** Is `scope` the same scope as `other`? (the menu's check mark) */
export function sameScope(scope, other) {
  if (!scope || !other || scope.kind !== other.kind) return false;
  if (scope.kind === 'elements') {
    const key = (r) => `${r.artboard}\u0000${r.element}\u0000${r.occurrence ?? ''}`;
    return sameIds(scope.refs.map(key), other.refs.map(key));
  }
  return scope.kind !== 'artboards' || sameIds(scope.ids, other.ids);
}

/**
 * The chip's menu, in 03's order: Whole canvas · <the artboard in view> · Choose artboards… ·
 * ── · No canvas — just ask. `activeArtboardId` is the viewport-active (or selected) artboard; the row
 * is left out when the canvas has none.
 */
export function scopeMenu({
  scope,
  artboards = [],
  activeArtboardId = null,
  choosing = false,
} = {}) {
  const items = [{ id: 'whole', label: 'Whole canvas', scope: { kind: 'whole' } }];
  if (activeArtboardId) {
    items.push({
      id: `artboard:${activeArtboardId}`,
      label: labelOf(activeArtboardId, artboards),
      scope: { kind: 'artboards', ids: [activeArtboardId] },
    });
  }
  if (artboards.length > 1) items.push({ id: 'choose', label: 'Choose artboards…', choose: true });
  items.push({ id: 'sep', sep: true });
  items.push({ id: 'none', label: 'No canvas — just ask', scope: { kind: 'none' } });
  return items.map((it) => ({
    ...it,
    checked: !it.sep && !it.choose && sameScope(it.scope, scope),
    ...(it.choose
      ? { checked: choosing || (scope?.kind === 'artboards' && scope.ids.length > 1) }
      : {}),
  }));
}

/** Toggle one artboard inside a "Choose artboards…" selection; never leaves it empty (→ whole). */
export function toggleArtboard(scope, id) {
  const ids = scope?.kind === 'artboards' ? [...scope.ids] : [];
  const at = ids.indexOf(id);
  if (at >= 0) ids.splice(at, 1);
  else ids.push(id);
  return ids.length ? { kind: 'artboards', ids } : { kind: 'whole' };
}

/**
 * The scope as the prompt carries it: ids only (the artboards' own names are the canvas's untrusted
 * data and ride sanitised inside chat-context.js). `none` carries nothing — no canvas block at all.
 */
export function scopeForPrompt(scope, artboards = []) {
  if (!scope || scope.kind === 'none') return null;
  if (scope.kind === 'whole') return { kind: 'whole', ids: [], names: [] };
  // ids only — the elements' text is the canvas's untrusted data and rides sanitised as `[selected: …]` lines
  if (scope.kind === 'elements')
    return { kind: 'elements', ids: scope.ids, refs: scope.refs, names: [] };
  return { kind: 'artboards', ids: scope.ids, names: scopeNames(scope, artboards) };
}
