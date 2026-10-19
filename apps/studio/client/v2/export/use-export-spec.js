// client/v2/export/use-export-spec.js — S8.2: the sheet's state ↔ ExportSpec v2 (contract S8-export-spec §5.7).
//
//   openExport(spec?)    open the sheet pre-filled — the ONE client entry (inspector, world menu, version
//                        history, ⇧⌘E all come here). `registerExportOpener` is how the shell hands it the
//                        function that actually mounts the sheet (use-shell-core's `setExportDialog`).
//   quickExport(spec)    run a spec without the sheet → `{ jobId }` (inspector one-click, ⇧⌘C).
//   useExportSpec(...)   the sheet's state, the spec it makes, and the server's estimate for that spec.
//
// The model half is pure (no React, no fetch) so a test drives it directly; the hooks are thin.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { applyAdvanced } from './advanced/model.js';
import { annotationsState } from './annotations-policy.js';
import { SCOPE_IDS } from './export-copy.js';
import { batchPart, isBatch } from './sections/batch-model.js';

// ── formats and scopes ───────────────────────────────────────────────────────────────────────────
export const RASTER = new Set(['png', 'jpg']);

/** Contract §5.2: which scopes a format can take. A format that is not here takes all four. */
const FORMAT_SCOPES = {
  zip: ['folder', 'project'],
  pptx: ['canvas', 'folder', 'project'],
  canva: ['canvas', 'folder', 'project'],
};
export const scopesFor = (format) => FORMAT_SCOPES[format] ?? SCOPE_IDS;

/** Keep `scope` when `format` can take it, else the first scope it can (zip → Whole project). */
export function scopeForFormat(format, scope) {
  const ok = scopesFor(format);
  if (ok.includes(scope)) return scope;
  return ok.includes('project') && format === 'zip' ? 'project' : ok[0];
}

/** v1 callers (context menu, palette, bridge) name engine scopes; the sheet speaks the four. */
const LEGACY_SCOPE = {
  artboard: 'selection',
  selection: 'selection',
  'selection-bounds': 'selection',
  'canvas-as-separate': 'canvas',
  'canvas-whole': 'canvas',
  'project-raw': 'project',
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The state a request opens the sheet with. `request` is what a caller handed `openExport` (or the shell's
 * `exportDialog` object): `{ scope?, format?, scale?, canvas?, folder?, region?, at? }`.
 * ctx: { hasSelection }
 */
export function initialState(request = {}, ctx = {}) {
  const asked = SCOPE_IDS.includes(request.scope)
    ? request.scope
    : (LEGACY_SCOPE[request.scope] ?? null);
  let format = typeof request.format === 'string' ? request.format : null;
  // the world menu's "Export project ZIP" is a legacy `project-raw` with no format
  if (!format && request.scope === 'project-raw') format = 'zip';
  format ||= 'png';
  // ⇧⌘E with nothing selected exports THIS CANVAS, never the project
  const scope = scopeForFormat(format, asked ?? (ctx.hasSelection ? 'selection' : 'canvas'));
  return {
    scope,
    format,
    scale: num(request.scale),
    annotations: false,
    region: request.region ?? null,
    unit: request.unit === 'one' || request.unit === 'each' ? request.unit : null,
    at: request.at ?? null,
    nothingSelected: !ctx.hasSelection && asked === null,
  };
}

/** The scale a raster export uses: the one picked, else the kind's own default (social 1×, web 2×). */
export const effectiveScale = (state, kind) => state.scale ?? (kind === 'web' ? 2 : 1);

const stripDesignRel = (path, designRel) => {
  const prefix = `${String(designRel || '.design')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')}/`;
  const p = String(path || '').replace(/^\.\//, '');
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
};

/** The canvas the sheet targets, designRoot-relative (what the spec carries), or null. */
export const canvasRel = (ctx) =>
  ctx.activePath && ctx.canvasOpen !== false ? stripDesignRel(ctx.activePath, ctx.designRel) : null;

/** The folder of the open canvas, designRoot-relative; null when it sits at the root. */
export function folderRel(ctx) {
  const rel = canvasRel(ctx);
  if (!rel || !rel.includes('/')) return null;
  return rel.slice(0, rel.lastIndexOf('/'));
}

/**
 * state + ctx → ExportSpecV2.
 * ctx: { designRel, activePath, artboards: string[], elements: string[], activeArtboardId, kind }
 */
export function buildSpec(state, ctx = {}) {
  const spec = { v: 2, scope: state.scope, format: state.format };
  const rel = canvasRel(ctx);
  if ((state.scope === 'selection' || state.scope === 'canvas') && rel) spec.canvas = rel;
  if (state.scope === 'folder') {
    const folder = folderRel(ctx);
    if (folder) spec.folder = folder;
  }
  if (state.scope === 'selection') {
    const elements = (ctx.elements ?? []).slice(0, 256);
    const artboards = ctx.artboards?.length
      ? ctx.artboards
      : ctx.activeArtboardId
        ? [ctx.activeArtboardId]
        : [];
    if (elements.length) spec.selection = { elements };
    else if (artboards.length) spec.selection = { artboards: artboards.slice(0, 256) };
  }
  if (state.region && (state.scope === 'selection' || state.scope === 'canvas'))
    spec.region = state.region;
  if (state.unit && state.region) spec.unit = state.unit;
  if (state.at) spec.at = state.at;
  const options = {};
  if (RASTER.has(state.format)) options.size = { scale: effectiveScale(state, ctx.kind) };
  if (state.annotations && !annotationsState(state.format, { kinds: ctx.kinds }).off)
    options.annotations = true;
  // S8.3 — many kinds at once: each kind's own format row; the picks, not the sheet's 1× / 2×, size it
  if (ctx.batch) {
    const part = batchPart(state.kindPicks, ctx.kinds ?? []);
    if (part) {
      spec.format = part.format;
      options.size = undefined;
      if (part.options) Object.assign(options, part.options);
      if (part.byKind) spec.byKind = part.byKind;
    }
  }
  for (const k of Object.keys(options)) if (options[k] === undefined) delete options[k];
  if (Object.keys(options).length) spec.options = options;
  // S8.3 — Advanced: whatever the fold has touched is laid over the spec
  return applyAdvanced(spec, state.adv);
}

/**
 * Counts → which scope segments are on. A scope with nothing in it is off, with a reason. Before the
 * server has answered (or if it cannot), the facts around the sheet decide, so nothing is wrongly shut.
 * facts: { canvasOpen, hasSelection, hasFolder }
 */
export function scopeAvailability(counts, facts = {}) {
  const { canvasOpen = true, hasSelection = true, hasFolder = true } = facts;
  const known = counts && typeof counts === 'object';
  const has = (id, fallback) =>
    known ? typeof counts[id] === 'number' && counts[id] > 0 : fallback;
  return {
    selection: has('selection', canvasOpen && hasSelection),
    canvas: has('canvas', canvasOpen),
    folder: has('folder', canvasOpen && hasFolder),
    project: has('project', true),
  };
}

/**
 * The legacy (v1) request the BROWSER lane needs: png/svg of one known artboard, and the PowerPoint deck of
 * the canvas, captured in the member's own browser (DDR-231). Null when the spec is not one of those —
 * everything else is the v2 body.
 */
export function browserLaneRequest(state, ctx = {}) {
  const { format, scope } = state;
  const artboardId = ctx.artboards?.[0] ?? ctx.activeArtboardId ?? null;
  if (ctx.exportLane === 'local' || !ctx.exportLane) return null;
  if ((format === 'png' || format === 'svg') && scope === 'selection' && artboardId) {
    const options = { artboardId };
    if (format === 'png') options.scale = effectiveScale(state, ctx.kind);
    const rel = ctx.activePath;
    if (rel) options.canvasFile = rel;
    return { format, scope: 'artboard', options };
  }
  if (format === 'pptx' && scope === 'canvas') {
    const options = {};
    if (ctx.activePath) options.canvasFile = ctx.activePath;
    return { format, scope: 'canvas-as-separate', options };
  }
  return null;
}

// ── the openExport / quickExport entries ─────────────────────────────────────────────────────────
let opener = null;

/** The shell registers what mounts the sheet; returns the unregister. */
export function registerExportOpener(fn) {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

/** Open the sheet pre-filled. Returns true when a shell was there to open it. */
export function openExport(spec = {}) {
  if (!opener) return false;
  opener({ mode: 'export', ...spec });
  return true;
}

/** Run a spec without the sheet. Lands in the Exports panel; resolves `{ jobId }`. */
export async function quickExport(spec, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl('/_api/export-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 2, spec }),
  });
  if (!r.ok) throw new Error((await r.text()) || `Export failed (${r.status})`);
  const body = await r.json();
  return { jobId: body.jobId };
}

// ── the estimate (POST /_api/export-estimate — numbers only) ─────────────────────────────────────
const ESTIMATE_DEBOUNCE_MS = 120;

export async function fetchEstimate(spec, signal, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl('/_api/export-estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spec }),
    signal,
  });
  if (!r.ok) return null;
  const body = await r.json();
  return body && typeof body === 'object' && body.counts ? body : null;
}

/** The server's estimate for `spec`, re-asked (debounced) when the spec changes. `null` until it answers. */
export function useEstimate(spec, { enabled = true } = {}) {
  const [est, setEst] = useState(null);
  const key = JSON.stringify(spec);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` IS the spec
  useEffect(() => {
    if (!enabled) return undefined;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchEstimate(spec, ctl.signal)
        .then((e) => {
          if (!ctl.signal.aborted) setEst(e);
        })
        .catch(() => {});
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [key, enabled]);
  return est;
}

/** The artboard kinds the estimate says the spec reaches. */
export const kindsOf = (est) => new Set(Object.keys(est?.byKind ?? {}));

/** Which section the sheet shows: a page that is only web artboards, else the image one. */
export function sectionKind(est) {
  const kinds = [...kindsOf(est)];
  return kinds.length > 0 && kinds.every((k) => k === 'web') ? 'web' : 'image';
}

/**
 * The sheet's state hook. `request` = the shell's `exportDialog` object; `ctx` = the facts around it.
 * Returns { state, set, spec, est, kind, section, setFormat, setScope }.
 */
export function useExportSpec(request, ctx) {
  const [state, setState] = useState(() => initialState(request, ctx));
  const set = useCallback((patch) => setState((s) => ({ ...s, ...patch })), []);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const setFormat = useCallback(
    (format) => setState((s) => ({ ...s, format, scope: scopeForFormat(format, s.scope) })),
    []
  );
  const setScope = useCallback(
    (scope) => setState((s) => ({ ...s, scope, nothingSelected: false })),
    []
  );
  // the section depends on what the spec reaches, which the estimate says: the first ask is the flat
  // draft; the kinds it names then decide whether the spec is a batch (S8.3), and the estimate is asked
  // again for that spec so its numbers are the ones the picks make
  const [kindsSeen, setKindsSeen] = useState([]);
  const batch = isBatch(kindsSeen, state.scope, state.format);
  const draft = useMemo(
    () => buildSpec(state, { ...ctx, kinds: kindsSeen, batch }),
    [state, ctx, kindsSeen, batch]
  );
  const est = useEstimate(draft, { enabled: ctx.estimate !== false });
  const seen = [...kindsOf(est)].sort().join('\u0000');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `seen` IS the kinds the estimate named
  useEffect(() => {
    if (est && seen !== [...kindsSeen].sort().join('\u0000')) setKindsSeen([...kindsOf(est)]);
  }, [seen]);
  const section = batch ? 'batch' : sectionKind(est);
  const kind = section === 'web' ? 'web' : 'digital';
  const spec = useMemo(
    () => buildSpec(state, { ...ctx, kind, kinds: kindsSeen, batch }),
    [state, ctx, kind, kindsSeen, batch]
  );
  return { state, set, setFormat, setScope, spec, est, kind, section, batch, kinds: kindsSeen };
}

// ── the other people in the project (Share vs Export hint) ───────────────────────────────────────
let people = [];
const peopleSubs = new Set();

/** The share cluster tells the sheet who else is here; names only, never ids. */
export function setExportPeople(names) {
  const next = (names ?? []).map((n) => String(n ?? '')).filter(Boolean);
  if (next.join('\u0000') === people.join('\u0000')) return;
  people = next;
  for (const f of peopleSubs) f();
}
const subscribePeople = (f) => {
  peopleSubs.add(f);
  return () => peopleSubs.delete(f);
};
export const useExportPeople = () =>
  useSyncExternalStore(
    subscribePeople,
    () => people,
    () => people
  );
