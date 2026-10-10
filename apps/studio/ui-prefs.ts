// ui-prefs.ts — disk-backed UI / view preferences (feature-unified-settings-modal).
//
// The Settings modal's non-secret UI prefs (theme + the Canvas & View toggles)
// persist here so they survive a restart AND a cleared browser localStorage
// (the native WKWebView shell is the case that motivated an explicit on-disk
// store rather than trusting localStorage alone). Stored GLOBALLY per user, not
// per-project — these are user preferences, not canvas state — at
// `~/.config/maude/prefs.json` (XDG-aware, same location discipline as
// generation/keys.ts's keys.json and sync/hubs-config.ts's hubs.json).
//
// NON-SECRET by construction: this file only ever holds view toggles and small
// id -> boolean maps (v2: fold state, tour "seen" ids, pinned-panel widths). It is
// never versioned and never served to a canvas — the GET/POST routes are
// MAIN-ORIGIN ONLY (privileged), like /_api/generate/prefs.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { PREFS_VERSION } from './ui-prefs-migrate.ts';

/** The dockable shell panels the Layout tab can move between the two sides. */
export const DOCK_PANEL_IDS = [
  'tree',
  'layers',
  'inspector',
  'comments',
  'changes',
  'assistant',
] as const;
export type DockPanelId = (typeof DOCK_PANEL_IDS)[number];
export type DockSide = 'left' | 'right';
export type PanelSides = Record<DockPanelId, DockSide>;

export interface UiPrefs {
  theme: 'light' | 'dark';
  minimap: boolean;
  zoom: boolean;
  annotations: boolean;
  autoOpenInspector: boolean;
  /** Which side each dockable panel lives on (feature-configurable-panel-docking). */
  panelSides: PanelSides;
  /** Whether Layers is its own dockable panel or a tab inside the Inspector. */
  layersMode: 'separate' | 'in-inspector';
  /**
   * Schema version of the file (absent = 1, the seven fields above). Carried, never invented by the
   * reader: a file written by a newer build keeps its version when an older build rewrites it.
   */
  version?: number;
  /** v2 homes (V2-2.7). Optional: a 1.x file has none of them, and a 1.x writer carries them untouched. */
  pin?: { on?: boolean; widths?: { left?: number; right?: number } };
  fold?: Record<string, boolean>;
  seen?: Record<string, true>;
  canvases?: { showHidden?: boolean };
  panelsHidden?: boolean;
  migratedFrom?: number;
  /**
   * Lossless reader (V2-1.12): any top-level field this build does not know round-trips untouched
   * through read and write, so a build that predates a field never strips it.
   */
  [extra: string]: unknown;
}

// Defaults MUST agree with app.jsx's initial state (THEME default 'dark',
// MINIMAP/ZOOMCTL false, annotations on, auto-open-inspector on) and with
// use-chrome-visibility.tsx's provider defaults. Panel defaults mirror the
// pre-docking shell: tree + layers on the left, everything else on the right;
// Layers ships as its own panel (`separate`), docked left.
export const PANEL_SIDES_DEFAULTS: PanelSides = {
  tree: 'left',
  layers: 'left',
  inspector: 'right',
  comments: 'right',
  changes: 'right',
  assistant: 'right',
};
export const UI_PREFS_DEFAULTS: UiPrefs = {
  theme: 'dark',
  minimap: false,
  zoom: false,
  annotations: true,
  autoOpenInspector: true,
  panelSides: { ...PANEL_SIDES_DEFAULTS },
  layersMode: 'separate',
};

/** Resolve the on-disk path to prefs.json (mirrors keys.ts's XDG logic). */
export function uiPrefsPath(): string {
  if (process.env.MAUDE_UI_PREFS_PATH) return process.env.MAUDE_UI_PREFS_PATH;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'maude', 'prefs.json');
}

function coercePanelSides(raw: unknown): PanelSides {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...PANEL_SIDES_DEFAULTS };
  for (const id of DOCK_PANEL_IDS) {
    if (o[id] === 'left' || o[id] === 'right') out[id] = o[id] as DockSide;
  }
  return out;
}

// Own keys that must never be copied off disk: a spread would define them as plain data
// properties, and the next consumer that assigns through one would be assigning into a prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const KNOWN_KEYS = new Set([
  'theme',
  'minimap',
  'zoom',
  'annotations',
  'autoOpenInspector',
  'panelSides',
  'layersMode',
  'version',
]);

function coerce(raw: unknown): UiPrefs {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (!KNOWN_KEYS.has(k) && !UNSAFE_KEYS.has(k)) extra[k] = o[k];
  }
  const version =
    typeof o.version === 'number' && Number.isInteger(o.version) && o.version >= 1
      ? { version: o.version }
      : {};
  return {
    ...extra,
    ...version,
    theme: o.theme === 'light' || o.theme === 'dark' ? o.theme : UI_PREFS_DEFAULTS.theme,
    minimap: bool(o.minimap, UI_PREFS_DEFAULTS.minimap),
    zoom: bool(o.zoom, UI_PREFS_DEFAULTS.zoom),
    annotations: bool(o.annotations, UI_PREFS_DEFAULTS.annotations),
    autoOpenInspector: bool(o.autoOpenInspector, UI_PREFS_DEFAULTS.autoOpenInspector),
    panelSides: coercePanelSides(o.panelSides),
    layersMode: o.layersMode === 'in-inspector' ? 'in-inspector' : UI_PREFS_DEFAULTS.layersMode,
  };
}

const plain = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export type UiPrefsPatchResult =
  | { ok: true; patch: Partial<UiPrefs> }
  | { ok: false; error: string };

const MAP_KEY = /^[A-Za-z0-9._:/-]{1,128}$/;
const MAP_MAX = 256;
const WIDTH_MAX = 4000;

/** A fold / seen map: {id: boolean} (or {id: true}); ids are plain, short, and never prototype keys. */
function checkMap(
  name: string,
  v: unknown,
  only: 'boolean' | 'true'
): string | Record<string, boolean> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${name} must be an object`;
  const out: Record<string, boolean> = {};
  const keys = Object.keys(v);
  if (keys.length > MAP_MAX) return `${name} has more than ${MAP_MAX} entries`;
  for (const k of keys) {
    const x = (v as Record<string, unknown>)[k];
    if (UNSAFE_KEYS.has(k) || !MAP_KEY.test(k)) return `${name} has an invalid id`;
    if (only === 'true' ? x !== true : typeof x !== 'boolean') {
      return only === 'true' ? `${name} values must be true` : `${name} values must be booleans`;
    }
    out[k] = x as boolean;
  }
  return out;
}

/**
 * The /_api/ui-prefs body whitelist, lifted out of http.ts so it can be tested without a server.
 * Only well-typed known keys pass through — a bad field is rejected rather than silently resetting a
 * stored value — and unknown top-level keys are ignored, exactly as the route always did. The seven
 * 1.x fields keep their original messages byte for byte; the v2 homes (V2-2.7) are accepted only in
 * their exact shape.
 */
export function validateUiPrefsPatch(body: Record<string, unknown>): UiPrefsPatchResult {
  const patch: Partial<UiPrefs> = {};
  const fail = (error: string): UiPrefsPatchResult => ({ ok: false, error });

  if ('theme' in body) {
    if (body.theme !== 'light' && body.theme !== 'dark') return fail('theme must be light|dark');
    patch.theme = body.theme;
  }
  for (const k of ['minimap', 'zoom', 'annotations', 'autoOpenInspector'] as const) {
    if (k in body) {
      if (typeof body[k] !== 'boolean') return fail(`${k} must be a boolean`);
      patch[k] = body[k] as boolean;
    }
  }
  if ('layersMode' in body) {
    if (body.layersMode !== 'separate' && body.layersMode !== 'in-inspector')
      return fail('layersMode must be separate|in-inspector');
    patch.layersMode = body.layersMode;
  }
  if ('panelSides' in body) {
    const ps = body.panelSides;
    if (!ps || typeof ps !== 'object' || Array.isArray(ps))
      return fail('panelSides must be an object');
    for (const v of Object.values(ps as Record<string, unknown>)) {
      if (v !== 'left' && v !== 'right') return fail('panelSides values must be left|right');
    }
    // writeUiPrefs → coerce keeps only known ids, so unknown keys are dropped.
    patch.panelSides = ps as UiPrefs['panelSides'];
  }

  // ── v2 homes ────────────────────────────────────────────────────────────────────────────────
  if ('version' in body) {
    const v = body.version;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > PREFS_VERSION)
      return fail(`version must be an integer from 1 to ${PREFS_VERSION}`);
    patch.version = v;
  }
  if ('migratedFrom' in body) {
    const v = body.migratedFrom;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v >= PREFS_VERSION)
      return fail(`migratedFrom must be an integer from 1 to ${PREFS_VERSION - 1}`);
    patch.migratedFrom = v;
  }
  if ('panelsHidden' in body) {
    if (typeof body.panelsHidden !== 'boolean') return fail('panelsHidden must be a boolean');
    patch.panelsHidden = body.panelsHidden;
  }
  if ('canvases' in body) {
    const c = body.canvases;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return fail('canvases must be an object');
    const o = c as Record<string, unknown>;
    for (const k of Object.keys(o))
      if (k !== 'showHidden') return fail('canvases has an unknown key');
    if ('showHidden' in o && typeof o.showHidden !== 'boolean')
      return fail('canvases.showHidden must be a boolean');
    patch.canvases = 'showHidden' in o ? { showHidden: o.showHidden as boolean } : {};
  }
  if ('pin' in body) {
    const pin = body.pin;
    if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return fail('pin must be an object');
    const o = pin as Record<string, unknown>;
    for (const k of Object.keys(o))
      if (k !== 'on' && k !== 'widths') return fail('pin has an unknown key');
    const out: NonNullable<UiPrefs['pin']> = {};
    if ('on' in o) {
      if (typeof o.on !== 'boolean') return fail('pin.on must be a boolean');
      out.on = o.on;
    }
    if ('widths' in o) {
      const w = o.widths;
      if (!w || typeof w !== 'object' || Array.isArray(w))
        return fail('pin.widths must be an object');
      const wo = w as Record<string, unknown>;
      for (const k of Object.keys(wo))
        if (k !== 'left' && k !== 'right') return fail('pin.widths has an unknown key');
      out.widths = {};
      for (const side of ['left', 'right'] as const) {
        if (side in wo) {
          const n = wo[side];
          if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > WIDTH_MAX)
            return fail(`pin.widths.${side} must be a number from 0 to ${WIDTH_MAX}`);
          out.widths[side] = n;
        }
      }
    }
    patch.pin = out;
  }
  if ('fold' in body) {
    const m = checkMap('fold', body.fold, 'boolean');
    if (typeof m === 'string') return fail(m);
    patch.fold = m;
  }
  if ('seen' in body) {
    const m = checkMap('seen', body.seen, 'true');
    if (typeof m === 'string') return fail(m);
    patch.seen = m as Record<string, true>;
  }
  return { ok: true, patch };
}

type RawPrefs =
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'corrupt' }
  | { kind: 'ok'; value: unknown };

/**
 * What is on disk, without judging it. `corrupt` is text that is not a JSON object (a torn write
 * from a build that does not rename, a half-synced file, a hand edit); `empty` is whitespace only.
 */
function readRaw(path: string): RawPrefs {
  if (!existsSync(path)) return { kind: 'missing' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { kind: 'corrupt' };
  }
  if (text.trim() === '') return { kind: 'empty' };
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { kind: 'ok', value };
  } catch {
    /* fall through */
  }
  return { kind: 'corrupt' };
}

/** Current UI prefs merged over the defaults (defaults when missing/unreadable). */
export function readUiPrefs(): UiPrefs {
  const raw = readRaw(uiPrefsPath());
  return raw.kind === 'ok' ? coerce(raw.value) : { ...UI_PREFS_DEFAULTS };
}

/**
 * Persist a partial patch over the on-disk prefs (only the provided keys change;
 * every other stored value is preserved). Returns the merged result. Best-effort
 * — a write failure throws so the route can surface it.
 *
 * Crash-safe: the new file is written beside the old one and renamed over it, so a reader (or a
 * second Maude process — every project window has its own server since V2-1.1) never sees a torn
 * file. A file that cannot be parsed is copied to `prefs.json.corrupt-<ms>` first, so healing it
 * with defaults never destroys what the person had.
 */
export function writeUiPrefs(patch: Partial<UiPrefs>): UiPrefs {
  const path = uiPrefsPath();
  const raw = readRaw(path);
  if (raw.kind === 'corrupt') {
    try {
      copyFileSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      /* best-effort: the heal below still proceeds */
    }
  }
  const cur = raw.kind === 'ok' ? coerce(raw.value) : { ...UI_PREFS_DEFAULTS };
  // panelSides is deep-merged so a partial patch (one panel moved) preserves the
  // other panels' sides instead of resetting them to defaults via coerce.
  const merged: Partial<UiPrefs> = {
    ...cur,
    ...patch,
    panelSides: { ...cur.panelSides, ...(patch.panelSides ?? {}) },
  };
  // v2 homes are maps: a patch adds or changes keys, it never replaces the whole map (so a closed
  // fold or a second tour id cannot wipe its siblings). `version` only moves forward.
  for (const k of ['fold', 'seen', 'canvases'] as const) {
    if (patch[k] !== undefined) merged[k] = { ...plain(cur[k]), ...plain(patch[k]) } as never;
  }
  if (patch.pin !== undefined) {
    const c = plain(cur.pin);
    const p = plain(patch.pin);
    const pin: Record<string, unknown> = { ...c, ...p };
    if (c.widths !== undefined || p.widths !== undefined) {
      pin.widths = { ...plain(c.widths), ...plain(p.widths) };
    }
    merged.pin = pin as never;
  }
  if (typeof patch.version === 'number') {
    merged.version = Math.max(patch.version, typeof cur.version === 'number' ? cur.version : 0);
  }
  const next = coerce(merged);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return next;
}
