// actions/keys.ts — chord normalisation shared by the shell, the canvas iframe, the generator and
// the tests (V2-1.3 contract §5.4). One canonical form, so '⌘⇧M', '⌘ ⇧ M', 'Cmd+Shift+M' and
// '⇧⌘M' are the same chord. Pure: no DOM.

import type { Chord } from './types.ts';

/** macOS menu order (CONTRACT §2: ⌥⇧⌘). */
const MOD_ORDER = ['⌃', '⌥', '⇧', '⌘'] as const;

/** Human / DOM spellings → the canonical named key. */
const NAMED: Record<string, string> = {
  Enter: '↵',
  Return: '↵',
  '↩': '↵',
  Escape: 'esc',
  Esc: 'esc',
  esc: 'esc',
  ' ': 'Space',
  Space: 'Space',
  Spacebar: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Backspace: '⌫',
  Delete: '⌦',
  Del: '⌦',
  Tab: 'tab',
  tab: 'tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '-': '−',
  '–': '−',
};

/** Canonical named keys: ⇧ stays significant on them (⇧← is not ←). */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  '↵',
  'esc',
  'Space',
  'tab',
  '⌫',
  '⌦',
  '←',
  '→',
  '↑',
  '↓',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const MOD_WORDS: Record<string, string> = {
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  opt: '⌥',
  option: '⌥',
  shift: '⇧',
};

/**
 * Parse a human spelling ('⌘ ⇧ M', '⌘⇧M', 'Cmd+Shift+M', 'Esc', '⌘ +', '⇧ ⌘ E') into the
 * canonical chord. Returns null for pointer gestures ('⌘ click', '⌘ hover') — not key bindings.
 */
export function chord(spec: string): Chord | null {
  if (spec === ' ') return 'Space'; // the DOM's e.key for the space bar
  let s = String(spec).trim();
  if (!s || /\b(click|hover|drag|scroll)\b/i.test(s)) return null;
  const mods = new Set<string>();
  s = s.replace(
    /\b(cmd|command|meta|ctrl|control|alt|opt|option|shift)\s*\+\s*/gi,
    (_m, w: string) => {
      mods.add(MOD_WORDS[w.toLowerCase()]);
      return '';
    }
  );
  // Peel glyph modifiers off the front (any order, spaces allowed). A lone glyph is a key.
  for (;;) {
    s = s.replace(/^\s+/, '');
    const g = MOD_ORDER.find((m) => s.startsWith(m));
    if (!g || s.trim().length === g.length) break;
    mods.add(g);
    s = s.slice(g.length);
  }
  let key = s.trim();
  if (NAMED[key]) key = NAMED[key];
  else if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  if (!key) return null;
  return MOD_ORDER.filter((m) => mods.has(m)).join('') + key;
}

/** `chord()` that throws on a non-chord — for registry literals, where null is a typo. */
export function k(spec: string): Chord {
  const c = chord(spec);
  if (!c) throw new Error(`actions/keys: '${spec}' is not a key chord`);
  return c;
}

const CODE_KEY: Record<string, string> = {
  Minus: '−',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'Space',
};

/** The part of a KeyboardEvent the resolver needs (testable without a DOM). */
export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Canonical chord from a keyboard event (contract §5.4).
 *  - `e.key` when it is a printable ASCII character (layout-aware: what macOS menus show);
 *  - else the key from `e.code` (`KeyP` → `P`, `Digit1` → `1`) — covers ⌥ chords on macOS
 *    (⌥⌘P arrives as `e.key === 'π'`) and non-Latin layouts;
 *  - ⇧ is kept for letters, named keys and F-keys, and dropped where the character already
 *    encodes it ('?', '+', ':') and for digits (Czech QWERTZ types ⌘1 as ⌘⇧ + the '+' key);
 *  - ⌃ folds into ⌘, matching v1's `metaKey || ctrlKey`.
 */
export function chordFromEvent(e: KeyEventLike): Chord {
  const mods = new Set<string>();
  if (e.metaKey || e.ctrlKey) mods.add('⌘');
  if (e.altKey) mods.add('⌥');
  let key = e.key ?? '';
  if (NAMED[key]) key = NAMED[key];
  else if (/^F\d{1,2}$/.test(key)) {
    /* F1…F12 */
  } else if (/^[\x21-\x7e]$/.test(key)) {
    if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  } else if (e.code) {
    const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit(\d)$/.exec(e.code);
    key = m ? m[1] : (CODE_KEY[e.code] ?? key);
  }
  const shiftSignificant = /^[A-Z]$/.test(key) || NAMED_KEYS.has(key) || /^F\d/.test(key);
  if (e.shiftKey && shiftSignificant) mods.add('⇧');
  return MOD_ORDER.filter((m) => mods.has(m)).join('') + key;
}

export function hasCommandMod(c: Chord): boolean {
  return c.includes('⌘') || c.includes('⌃');
}

/** Split a canonical chord into its modifier glyphs and its key. */
export function splitChord(c: Chord): { mods: string[]; key: string } {
  const mods: string[] = [];
  let rest = c;
  for (;;) {
    const g = MOD_ORDER.find((m) => rest.startsWith(m) && rest.length > m.length);
    if (!g) break;
    mods.push(g);
    rest = rest.slice(g.length);
  }
  return { mods, key: rest };
}

/** Display form. Canonical chords are already the macOS display form ('⇧⌘E', 'esc', '?');
 *  `spaced` puts a space between the parts ('⇧ ⌘ E'). */
export function formatChord(c: Chord, opts: { spaced?: boolean } = {}): string {
  if (!opts.spaced) return c;
  const { mods, key } = splitChord(c);
  return [...mods, key].join(' ');
}

/** Chords a focused text field owns natively (C26: the text field wins). Plus every chord without
 *  ⌘/⌃, which the resolver treats the same way. */
export const TEXT_RESERVED: ReadonlySet<Chord> = new Set(
  [
    '⌘Z',
    '⇧⌘Z',
    '⌘Y',
    '⌘A',
    '⌘C',
    '⌘X',
    '⌘V',
    '⇧⌘V',
    '⌥⇧⌘V',
    '⌘B',
    '⌘I',
    '⌘U',
    '⌘←',
    '⌘→',
    '⌘↑',
    '⌘↓',
    '⇧⌘←',
    '⇧⌘→',
    '⌥←',
    '⌥→',
    '⌘⌫',
    '⌥⌫',
  ].map(k)
);

/** Chords Chrome / Safari never deliver to a page (best effort). Bindings on them carry
 *  `when: { shell: ['desktop'] }`; other shells show the menu path instead (Q3). */
export const BROWSER_RESERVED: ReadonlySet<Chord> = new Set(
  ['⌘N', '⇧⌘N', '⌘T', '⌘W', '⌘Q', '⌘L'].map(k)
);

const TAURI_KEY: Record<string, string> = {
  '↵': 'Enter',
  esc: 'Escape',
  Space: 'Space',
  tab: 'Tab',
  '⌫': 'Backspace',
  '⌦': 'Delete',
  '←': 'Left',
  '→': 'Right',
  '↑': 'Up',
  '↓': 'Down',
  '−': '-',
};

/** Tauri / muda accelerator string for a chord: '⇧⌘N' → 'CmdOrCtrl+Shift+N'. */
export function toTauriAccel(c: Chord): string {
  const { mods, key } = splitChord(c);
  const parts: string[] = [];
  if (mods.includes('⌃')) parts.push('Ctrl');
  if (mods.includes('⌥')) parts.push('Alt');
  if (mods.includes('⇧')) parts.push('Shift');
  if (mods.includes('⌘')) parts.unshift('CmdOrCtrl');
  parts.push(TAURI_KEY[key] ?? key);
  return parts.join('+');
}
