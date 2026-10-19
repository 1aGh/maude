// actions/ctx.ts — who computes `KeyCtx` (V2-1.3 contract §5.3). Pure: the DOM-reading callers
// pass in what they see, so the mapping is testable without a browser.
//
// During V2-2.4 both functions reproduce v1 exactly (§5.3: "computeFocus reproduces v1"): the
// shell has no 'modal' focus (v1's global keys ran with dialogs open) and its 'timeline' focus is
// "timeline open with a comp, focus in the shell" (v1's transport listened on window); S7
// tightens it to focus-within the timeline island (C26).

import type { Fact, KeyCtx, Mode, SelKind } from './types.ts';

/** What the shell sees of `document.activeElement`. */
export interface FocusProbe {
  tag?: string;
  type?: string;
  /** `isContentEditable` */
  editable?: boolean;
}

export interface ShellKeyState {
  /** A canvas tab is active (not the design-system tab). */
  canvasOpen: boolean;
  /** The Timeline is open AND the active canvas announced a comp (v1 transport's gate). */
  timelineVisible: boolean;
  presenting: boolean;
  native: boolean;
  readOnly: boolean;
  /** A timeline clip is selected. */
  clipSelected: boolean;
  /** Exactly one artboard (and no element) is selected. */
  artboardSelected: boolean;
  /** A comment pin is focused. */
  commentFocused: boolean;
  /** V2-4.5b — the shell's canvas mode (V2-1.2), when it has one; Present wins while presenting. */
  mode?: Mode;
  /** V2-4 gate — the "Single-key shortcuts" switch (KeyCtx.singleKeys); absent = on. */
  singleKeys?: boolean;
}

/** The shell document's KeyCtx for a keydown it received. */
export function shellKeyCtx(probe: FocusProbe, s: ShellKeyState): KeyCtx {
  const tag = (probe.tag ?? '').toUpperCase();
  const range = tag === 'INPUT' && (probe.type ?? '').toLowerCase() === 'range';
  // v1's three listeners agree on these as "typing"; they disagree on <select> and range sliders,
  // which are facts instead (types.ts › Fact).
  const typing = (tag === 'INPUT' && !range) || tag === 'TEXTAREA' || !!probe.editable;
  const facts = new Set<Fact>();
  if (s.canvasOpen) facts.add('canvasOpen');
  if (s.timelineVisible) facts.add('timelineVisible');
  if (s.presenting) facts.add('presenting');
  if (s.native) facts.add('native');
  if (s.commentFocused) facts.add('commentFocused');
  if (tag === 'SELECT') facts.add('selectFocused');
  if (range) facts.add('rangeFocused');
  const selection: SelKind = s.clipSelected ? 'clip' : s.artboardSelected ? 'artboard' : 'none';
  return {
    role: s.readOnly ? 'comment' : 'owner',
    shell: s.native ? 'desktop' : 'browser',
    mode: s.presenting ? 'present' : (s.mode ?? 'edit'),
    focus: typing ? 'text' : s.timelineVisible ? 'timeline' : 'chrome',
    selection,
    facts,
    ...(s.singleKeys === false ? { singleKeys: false } : {}),
  };
}

export interface CanvasKeyState {
  /** v1 `isEditableTarget(e.target)` (covers contenteditable="plaintext-only"). */
  typing: boolean;
  readOnly: boolean;
  selection?: SelKind;
  /** V2-4.5b — the governed mode (bridge/canvas-mode-store.ts); v1's 'edit' when the shell has not
   *  spoken (a standalone canvas). The tool letters are bound per mode (defs/tool.ts). */
  mode?: Mode;
  /** V2-4 gate — the shell's "Single-key shortcuts" switch, as the bridge's `key-prefs` delivered it. */
  singleKeys?: boolean;
  /** S2.21 — F · R · T (a create tool) is armed: ↵ adds one at its default size (`tool.create-default`). */
  toolArmed?: boolean;
}

/** The canvas iframe's KeyCtx for a keydown it received. */
export function canvasKeyCtx(s: CanvasKeyState): KeyCtx {
  return {
    role: s.readOnly ? 'comment' : 'owner',
    shell: 'browser',
    mode: s.mode ?? 'edit',
    focus: s.typing ? 'text' : 'canvas',
    selection: s.selection ?? 'none',
    facts: new Set<Fact>(s.toolArmed ? ['toolArmed'] : []),
    ...(s.singleKeys === false ? { singleKeys: false } : {}),
  };
}
