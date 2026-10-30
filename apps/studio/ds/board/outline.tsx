// A section that has not been drawn yet is a quiet outline (S10.16b, 13 · ds-make-filling).
//
// While a system is being made (`model.making`) the sections fill in one by one. Two facts decide how a section
// looks, and neither is stored on the canvas (S10 Q7):
//   · its content — a section with nothing of its own in the working files yet is an outline ("Colour — next");
//   · the shell's word, pushed in the dgn message `ds-make-states` —`waiting` · `drawing` · `done`, from
//     `GET /_api/ds/make-state` (ds-check per registry group + the artboards a live AI run holds). When it speaks it
//     wins: a section a run holds is `drawing` even before its first token lands, and `done` is never an outline.
// Once the system is made (`making` false) nothing here applies and every section draws as it always did.
//
// The canvas is untrusted and may not be written to by anyone but its parent: only the studio shell that framed it
// can set the states (same rule as the theme preview).

import { useSyncExternalStore } from 'react';
import { acceptFromShell } from '../../bridge/dgn-protocol.ts';
import type { BoardModel } from './types.ts';
import { SECTIONS, type SectionKind } from './types.ts';

export type OutlineState = 'waiting' | 'drawing' | 'done';

let pushed: Partial<Record<SectionKind, OutlineState>> | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

const KINDS = new Set<string>(SECTIONS.map((s) => s.kind));
const STATES = new Set<string>(['waiting', 'drawing', 'done']);

/** A message from the shell → clean states: known sections and known words only. */
export function cleanOutlineStates(
  raw: unknown
): Partial<Record<SectionKind, OutlineState>> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Partial<Record<SectionKind, OutlineState>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (KINDS.has(k) && typeof v === 'string' && STATES.has(v))
      out[k as SectionKind] = v as OutlineState;
  return Object.keys(out).length ? out : null;
}

export function setOutlineStates(next: unknown): void {
  const clean = cleanOutlineStates(next);
  if (JSON.stringify(clean) === JSON.stringify(pushed)) return;
  pushed = clean;
  emit();
}

export const getOutlineStates = () => pushed;
const useStates = () => useSyncExternalStore(subscribe, getOutlineStates, getOutlineStates);

let listening = false;
/** Wire the parent's `ds-make-states` dgn message (bridge/dgn-protocol.ts) once. Safe without a window. */
export function listenForOutlineStates(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent || !e.data) return;
    const m = acceptFromShell(e, window);
    if (m && m.dgn === 'ds-make-states') setOutlineStates(m.sections);
  });
}

/** test seam */
export function __resetOutlineStates(): void {
  pushed = null;
  emit();
}

/** Does the working system hold anything of this section yet? */
export function hasContent(model: BoardModel, kind: SectionKind): boolean {
  switch (kind) {
    case 'brand':
      return model.logos.length > 0 || model.tokens.some((t) => t.section === 'brand');
    case 'components':
      return model.components.length > 0;
    case 'patterns':
      // patterns are compositions of everything else: they follow the other six
      return false;
    default:
      return model.tokens.some((t) => t.section === kind);
  }
}

/** The state to draw a section in, or null when it draws as it always did. */
export function outlineStateOf(
  model: BoardModel,
  kind: SectionKind,
  states: Partial<Record<SectionKind, OutlineState>> | null
): 'waiting' | 'drawing' | null {
  if (!model.making) return null;
  const said = states?.[kind];
  if (said === 'done') return null;
  if (said) return said;
  return hasContent(model, kind) ? null : 'waiting';
}

export const OUTLINE_WORDS = Object.freeze({
  waiting: (label: string) => `${label} — next`,
  drawing: (label: string) => `${label} — drawing now`,
});

/** The outline a waiting or drawing section draws, or null. A hook: call it before any early return. */
export function useSectionOutline(kind: SectionKind, model: BoardModel | null) {
  listenForOutlineStates();
  const states = useStates();
  if (!model) return null;
  const state = outlineStateOf(model, kind, states);
  if (!state) return null;
  const label = SECTIONS.find((s) => s.kind === kind)?.label ?? kind;
  return (
    <div
      className="ds-board ds-outline"
      data-ds-section={kind}
      data-ds-state={state}
      data-testid={`ds-outline-${kind}`}
    >
      <span>{OUTLINE_WORDS[state](label)}</span>
    </div>
  );
}
