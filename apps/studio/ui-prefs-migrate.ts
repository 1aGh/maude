// ui-prefs-migrate.ts — the pure core of the prefs migration (Gate 0 D20, plan V2-2.7).
//
// 1.x keeps its preferences in two places: `~/.config/maude/prefs.json` (seven fields, written
// through /_api/ui-prefs) and ~26 localStorage keys per shell origin. v2 keeps one durable store
// per Mac — the same prefs.json — and treats localStorage as at most a per-origin mirror. This
// module turns "what a 1.x install holds" into "what v2 reads", and nothing else:
//
//   migratePrefs({ disk, local }) -> { disk2, report }
//
// RULES (each one is pinned by test/prefs-migrate.test.ts)
//   read old, write new   disk wins where it has a value; localStorage fills only what disk lacks.
//   fill-if-absent        a value already in the v2 file is never overwritten, so a second shell
//                         origin (one per project window) can only add what is still missing.
//   delete nothing        a 1.x build on the same machine still reads the old keys. `report.removed`
//                         is always empty; the module has no way to remove, and never mutates input.
//   idempotent            migrate(migrate(x)) == migrate(x), with the same legacy keys or none.
//   lossless              unknown top-level fields round-trip; a file from a NEWER build is returned
//                         untouched (`report.newer`).
//   seen flags            the 1.x tour / hint flags are NOT carried: v2 `seen` starts empty so every
//                         upgrader gets the v2 tour once. (What's New markers are version watermarks
//                         and stay as they are — a missing one means "first ever run".)
//
// PURE and import-free on purpose: the client bundle imports this file, so no node:* and no DOM
// (a test pins that `V1_DEFAULTS` equals ui-prefs.ts's `UI_PREFS_DEFAULTS` — they cannot share code
// without dragging node:fs into the bundle).
//
// NOT WIRED in Phase 2. The v1 UI still owns every old key, and nothing reads the v2 homes until
// V2-4.x, so seeding them now would only create stale state. The call site is Phase 4's.

export const PREFS_VERSION = 2;

/** Per-origin marker the client adapter writes after a successful migration (a NEW key). */
export const LEGACY_VERSION_KEY = 'maude-prefs-version';

export type KeyClass =
  | 'migrate' // carried into a v2 home (fill-if-absent)
  | 'rekeyed' // a "seen" flag: deliberately NOT carried, so the v2 tour is shown once
  | 'kept' // stays as it is in localStorage; Phase 4 reads it unchanged
  | 'dropped' // read by 1.x, migrates nothing by decision
  | 'dead' // no writer anywhere (reader fallback only, or a comment)
  | 'canvas-origin' // lives on the canvas origin; the shell cannot reach it
  | 'marker'; // the v2 migration's own per-origin marker

export interface KeyRule {
  class: KeyClass;
  /** The v2 home, for `migrate` keys. Dotted path into the v2 prefs object. */
  to?: string;
  note: string;
}

/**
 * Every storage key the code can touch. test/prefs-migrate.test.ts scans the source tree and fails
 * if a key is used that is not listed here, so a new key cannot ship unclassified.
 * `maude-cloud-role-seen:*` is a family (one key per role).
 */
export const KEY_CLASS: Readonly<Record<string, KeyRule>> = {
  'mdcc-theme': {
    class: 'migrate',
    to: 'theme',
    note: 'light|dark; disk already wins at 1.x boot.',
  },
  'mdcc-minimap-visible': { class: 'migrate', to: 'minimap', note: '"1"|"0"; View > Advanced.' },
  'mdcc-zoomctl-visible': { class: 'migrate', to: 'zoom', note: '"1"|"0"; View > Advanced.' },
  'mdcc-annotations-visible': { class: 'migrate', to: 'annotations', note: '"1"|"0"; shift-P.' },
  'maude-auto-open-inspector': {
    class: 'migrate',
    to: 'autoOpenInspector',
    note: '"1"|"0"; 1.x treats anything but "0" as on.',
  },
  'mdcc-layers-mode': {
    class: 'migrate',
    to: 'layersMode',
    note: 'separate|in-inspector, carried verbatim; Phase 4 decides what it means.',
  },
  'mdcc-panel-sides': {
    class: 'migrate',
    to: 'panelSides',
    note: 'JSON {panelId: left|right}, carried verbatim (incl. the client-only `sync` id).',
  },
  'maude-sb-w': {
    class: 'migrate',
    to: 'pin.widths.left',
    note: 'px, clamped to 200..420 as 1.x did.',
  },
  'maude-rp-w': {
    class: 'migrate',
    to: 'pin.widths.right',
    note: 'px, clamped to 260..480 as 1.x did.',
  },
  'mdcc-show-hidden': {
    class: 'migrate',
    to: 'canvases.showHidden',
    note: '"1"|"0"; hidden files switch.',
  },
  'mdcc-sidebar-open': {
    class: 'migrate',
    to: 'panelsHidden',
    note: '"1"|"0", inverted: a closed sidebar is panelsHidden=true (the cmd-backslash state).',
  },
  'maude-cp-mode': {
    class: 'dropped',
    note: 'Written on every mount, so it is never a choice; D18 makes Designer the only default.',
  },
  'mdcc-usage-tour-seen': { class: 'rekeyed', note: 'Re-keyed: v2 `seen` starts empty (D20).' },
  'mdcc-collab-tour-seen': { class: 'rekeyed', note: 'Re-keyed: v2 `seen` starts empty (D20).' },
  'maude-mode-hint-seen': { class: 'rekeyed', note: 'Re-keyed: v2 `seen` starts empty (D20).' },
  'mdcc-whatsnew-seen': {
    class: 'kept',
    note: 'Version watermark. A missing one reads as first-ever-run and silently acknowledges, so never reset.',
  },
  'mdcc-whatsnew-toast-dismissed': {
    class: 'kept',
    note: 'Version watermark, same rule as -seen.',
  },
  'maude-cloud-role-seen:*': {
    class: 'kept',
    note: 'v1-only banner (D12 replaces it with the access word).',
  },
  'maude-sync-consent': {
    class: 'kept',
    note: 'Consent records per hub; carried forward unchanged, never reset.',
  },
  'maude-sync-notice-ack': {
    class: 'kept',
    note: 'Per-hub notice acks; carried forward unchanged.',
  },
  'mdcc-settings-tab': {
    class: 'kept',
    note: 'Tab id of the 7-tab v1 Settings; v2 has 3. Guarded by has(v).',
  },
  'maude-acp-picks': {
    class: 'kept',
    note: 'Chat model/effort/mode picks; the chat panel stays v1 until Phase 4.',
  },
  'maude-acp-transcript-view': {
    class: 'kept',
    note: 'Chat transcript view; same panel, same rule.',
  },
  'maude-install-id': {
    class: 'kept',
    note: 'Anonymous install identity for bug reports. Never re-key.',
  },
  'maude-acp-model': {
    class: 'dead',
    note: 'Read once as a fallback for picks; no writer anywhere.',
  },
  'maude-acp-effort': {
    class: 'dead',
    note: 'Read once as a fallback for picks; no writer anywhere.',
  },
  'mdcc-sections-expanded': {
    class: 'dead',
    note: 'Pre-#124 seed for tree state; reader only, no writer.',
  },
  'maude-browse-hint-seen': {
    class: 'dead',
    note: 'Only named in a comment (shell/constants.js); superseded by mode-hint.',
  },
  'maude-annot-hints-v1': {
    class: 'canvas-origin',
    note: 'Annotation hint bitmap on the CANVAS origin; the shell cannot reach it. Phase 4 annotations owner.',
  },
  'maude-undo:*': {
    class: 'canvas-origin',
    note: 'sessionStorage undo mirror on the canvas origin; runtime state, not a pref.',
  },
  [LEGACY_VERSION_KEY]: {
    class: 'marker',
    note: 'Per-origin "this origin has been through the v2 migration".',
  },
};

const FAMILY_PREFIX = 'maude-cloud-role-seen:';

/** True for a key a 1.x shell origin can hold (the ones the adapter snapshots). */
export function isLegacyKey(key: string): boolean {
  if (key.startsWith(FAMILY_PREFIX)) return true;
  const r = KEY_CLASS[key];
  return !!r && r.class !== 'marker' && r.class !== 'canvas-origin';
}

/** What 1.x defaulted to when a field was absent. Equal to ui-prefs.ts `UI_PREFS_DEFAULTS` (tested). */
export const V1_DEFAULTS = {
  theme: 'dark',
  minimap: false,
  zoom: false,
  annotations: true,
  autoOpenInspector: true,
  panelSides: {
    tree: 'left',
    layers: 'left',
    inspector: 'right',
    comments: 'right',
    changes: 'right',
    assistant: 'right',
  },
  layersMode: 'separate',
} as const;

/** The widths 1.x clamped to (shell dock.jsx `usePanelSize`): what the person saw is what migrates. */
export const PIN_WIDTH_BOUNDS = {
  left: { min: 200, max: 420 },
  right: { min: 260, max: 480 },
} as const;

type Obj = Record<string, unknown>;
export type LocalSnapshot = Readonly<Record<string, string | null | undefined>>;

export interface MigrateReport {
  fromVersion: number;
  toVersion: number;
  /** A newer build wrote this file: returned as is, nothing migrated. */
  newer?: true;
  /** v2 homes filled from a legacy key, by dotted path. */
  filled: string[];
  /** v1 fields that fell back to the 1.x default (no disk value, no usable legacy value). */
  defaulted: string[];
  /** Legacy keys present but unusable (bad JSON, wrong enum). */
  invalid: string[];
  /** Legacy keys present and deliberately not migrated, with why. */
  notMigrated: { key: string; class: KeyClass }[];
  /** Always empty: this module deletes nothing. */
  removed: string[];
}

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isPosInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function cloneObj(v: unknown): Obj {
  const out: Obj = {};
  if (!isObj(v)) return out;
  for (const k of Object.keys(v)) if (!UNSAFE.has(k)) out[k] = structuredClone(v[k]);
  return out;
}

/** Valid `{id: left|right}` entries only; undefined when none survive. */
function sidesOf(v: unknown): Record<string, 'left' | 'right'> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, 'left' | 'right'> = {};
  for (const k of Object.keys(v)) {
    if (!UNSAFE.has(k) && (v[k] === 'left' || v[k] === 'right')) out[k] = v[k] as 'left' | 'right';
  }
  return Object.keys(out).length ? out : undefined;
}

const bool01 = (s: string | null): boolean | undefined =>
  s === '1' ? true : s === '0' ? false : undefined;

function jsonOf(s: string | null): unknown {
  if (s === null) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function widthOf(s: string | null, b: { min: number; max: number }): number | undefined {
  if (s === null) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? Math.min(b.max, Math.max(b.min, n)) : undefined;
}

export function migratePrefs(input: { disk?: unknown; local?: LocalSnapshot }): {
  disk2: Obj;
  report: MigrateReport;
} {
  const local = input.local ?? {};
  const base = cloneObj(input.disk);
  const fromVersion = isPosInt(base.version) ? base.version : 1;
  const report: MigrateReport = {
    fromVersion,
    toVersion: PREFS_VERSION,
    filled: [],
    defaulted: [],
    invalid: [],
    notMigrated: [],
    removed: [],
  };

  if (fromVersion > PREFS_VERSION) {
    report.toVersion = fromVersion;
    report.newer = true;
    return { disk2: base, report };
  }

  const get = (k: string): string | null => {
    const v = local[k];
    return typeof v === 'string' ? v : null;
  };
  const legacyKeys = Object.keys(local).filter(
    (k) => typeof local[k] === 'string' && isLegacyKey(k)
  );
  for (const k of legacyKeys) {
    const rule = KEY_CLASS[k] ?? KEY_CLASS[`${FAMILY_PREFIX}*`];
    if (rule && rule.class !== 'migrate') report.notMigrated.push({ key: k, class: rule.class });
  }

  /** disk value if valid, else the legacy value, else the fallback (v1 fields only). */
  function resolve<T>(
    path: string,
    current: unknown,
    valid: (v: unknown) => v is T,
    legacyKey: string | null,
    legacy: (raw: string | null) => T | undefined,
    fallback?: T
  ): T | undefined {
    if (valid(current)) return current;
    if (legacyKey) {
      const raw = get(legacyKey);
      const l = legacy(raw);
      if (l !== undefined) {
        report.filled.push(path);
        return l;
      }
      if (raw !== null) report.invalid.push(legacyKey);
    }
    if (fallback !== undefined) {
      report.defaulted.push(path);
      return fallback;
    }
    return undefined;
  }

  const out: Obj = { ...base };

  // The seven 1.x fields.
  out.theme = resolve(
    'theme',
    base.theme,
    (v): v is 'light' | 'dark' => v === 'light' || v === 'dark',
    'mdcc-theme',
    (s) => (s === 'light' || s === 'dark' ? s : undefined),
    V1_DEFAULTS.theme
  );
  const flags: [string, string, boolean][] = [
    ['minimap', 'mdcc-minimap-visible', V1_DEFAULTS.minimap],
    ['zoom', 'mdcc-zoomctl-visible', V1_DEFAULTS.zoom],
    ['annotations', 'mdcc-annotations-visible', V1_DEFAULTS.annotations],
    ['autoOpenInspector', 'maude-auto-open-inspector', V1_DEFAULTS.autoOpenInspector],
  ];
  for (const [field, key, dflt] of flags)
    out[field] = resolve(field, base[field], isBool, key, bool01, dflt);
  out.layersMode = resolve(
    'layersMode',
    base.layersMode,
    (v): v is 'separate' | 'in-inspector' => v === 'separate' || v === 'in-inspector',
    'mdcc-layers-mode',
    (s) => (s === 'separate' || s === 'in-inspector' ? s : undefined),
    V1_DEFAULTS.layersMode
  );
  const diskSides = sidesOf(base.panelSides);
  out.panelSides =
    diskSides ??
    resolve(
      'panelSides',
      undefined,
      (v): v is Record<string, 'left' | 'right'> => !!v,
      'mdcc-panel-sides',
      (s) => sidesOf(jsonOf(s)),
      { ...V1_DEFAULTS.panelSides }
    );

  // v2 homes. `fold` and `seen` are v2-owned: kept if present, otherwise empty — never filled from 1.x.
  const pin0 = isObj(base.pin) ? base.pin : {};
  const w0 = isObj(pin0.widths) ? pin0.widths : {};
  const widths: Obj = { ...w0 };
  const left = resolve('pin.widths.left', w0.left, isNum, 'maude-sb-w', (s) =>
    widthOf(s, PIN_WIDTH_BOUNDS.left)
  );
  const right = resolve('pin.widths.right', w0.right, isNum, 'maude-rp-w', (s) =>
    widthOf(s, PIN_WIDTH_BOUNDS.right)
  );
  if (left !== undefined) widths.left = left;
  if (right !== undefined) widths.right = right;
  out.pin = { ...pin0, on: isBool(pin0.on) ? pin0.on : false, widths };
  out.fold = isObj(base.fold) ? base.fold : {};
  out.seen = isObj(base.seen) ? base.seen : {};

  const canvases0 = isObj(base.canvases) ? base.canvases : {};
  const showHidden = resolve(
    'canvases.showHidden',
    canvases0.showHidden,
    isBool,
    'mdcc-show-hidden',
    bool01
  );
  if (showHidden !== undefined) out.canvases = { ...canvases0, showHidden };
  else if (isObj(base.canvases)) out.canvases = canvases0;

  const panelsHidden = resolve(
    'panelsHidden',
    base.panelsHidden,
    isBool,
    'mdcc-sidebar-open',
    (s) => {
      const open = bool01(s);
      return open === undefined ? undefined : !open;
    }
  );
  if (panelsHidden !== undefined) out.panelsHidden = panelsHidden;

  // An upgrader is anyone with 1.x evidence on either side. A fresh install has none.
  const diskTouched =
    Object.keys(base).length > 0 &&
    !Object.keys(base).every(
      (k) => k in V1_DEFAULTS && stable(base[k]) === stable((V1_DEFAULTS as Obj)[k])
    );
  if (isPosInt(base.migratedFrom)) out.migratedFrom = base.migratedFrom;
  else if (fromVersion < PREFS_VERSION && (legacyKeys.length > 0 || diskTouched))
    out.migratedFrom = fromVersion;

  out.version = PREFS_VERSION;
  return { disk2: out, report };
}

/** The top-level keys of `after` whose value differs from `before` (order-insensitive deep compare). */
export function diffPrefs(before: unknown, after: unknown): Obj {
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const out: Obj = {};
  for (const k of Object.keys(a)) if (stable(a[k]) !== stable(b[k])) out[k] = a[k];
  return out;
}
