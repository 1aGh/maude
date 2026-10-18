// editing/artboard-commands.tsx — S2.10: what answers ⌘D, the shell's `run-action` for the artboard
// actions, the ⌥-drag drop and the menu's "Custom width…" field (14 Editing: ed-ab-menu).
//
//   ⌘D                          artboard.duplicate over an ARTBOARD selection (registry chord, Edit mode)
//   run-action artboard.*       ⌘K, menus: duplicate · duplicate-at-width {width} · rename · reset-position ·
//                               trash (S2.10c: asks the shell, as ⌫ does — `delete-artboard-request` per board)
//   maude:duplicate-…-on-drop   canvas-lib's drop of an ⌥-drag: a copy lands at the drop, the originals stay
//   "Custom width…"             a small field beside the pointer: a number, ↵ copies, esc closes
//
// The writes are `artboard-actions.ts`'s. Read-only canvases do nothing here (the server refuses anyway).

import { useCallback, useEffect, useRef, useState } from 'react';

import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { Mode, SelKind } from '../actions/types.ts';
import { canvasModeStore, canvasSingleKeys } from '../bridge/canvas-mode-store.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { isEditableTarget } from '../input-router.tsx';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { CUSTOM_WIDTH_EVENT, useArtboardActions } from './artboard-actions.ts';
import { DUPLICATE_ON_DROP_EVENT } from './duplicate-rhythm.ts';

export const ARTBOARD_ACTIONS = [
  'artboard.duplicate',
  'artboard.duplicate-at-width',
  'artboard.rename',
  'artboard.reset-position',
  'artboard.trash',
] as const;
export type ArtboardAction = (typeof ARTBOARD_ACTIONS)[number];
export const isArtboardAction = (id: unknown): id is ArtboardAction =>
  typeof id === 'string' && (ARTBOARD_ACTIONS as readonly string[]).includes(id);

/** The width a custom-width field accepts (what `artboard.duplicate-at-width` clamps to). */
export const WIDTH_MIN = 64;
export const WIDTH_MAX = 8192;
/** A typed width → the number to copy at, or null when it is not one. */
export function parseWidth(text: string): number | null {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || text.trim() === '') return null;
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(n)));
}

const ARTBOARD_KEYS = canvasKeyIndex(['artboard.duplicate']);

export interface ArtboardKeyState {
  typing: boolean;
  mode: Mode;
  selection: SelKind;
  singleKeys?: boolean;
}

/** The artboard action a keydown runs (⌘D on an artboard selection), or null. */
export function resolveArtboardKey(e: KeyEventLike, s: ArtboardKeyState): ArtboardAction | null {
  const r = resolveChord(
    ARTBOARD_KEYS,
    chordFromEvent(e),
    canvasKeyCtx({
      typing: s.typing,
      readOnly: false,
      mode: s.mode,
      selection: s.selection,
      singleKeys: s.singleKeys,
    })
  );
  return (r?.action.id as ArtboardAction | undefined) ?? null;
}

const CSS_TEXT = `
.ed-abw {
  position: fixed; z-index: 8; display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  background: var(--maude-chrome-bg-0, #fff);
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.12)); border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, rgba(0,0,0,0.12));
  font: 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  color: var(--maude-chrome-fg-0, #1a1a1a);
}
.ed-abw input {
  width: 72px; height: 24px; padding: 0 6px; border-radius: 4px; font: inherit; color: inherit;
  font-variant-numeric: tabular-nums; background: transparent;
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.12));
}
.ed-abw input:focus-visible { outline: 2px solid var(--maude-hud-accent); outline-offset: 1px; }
.ed-abw-hint { opacity: 0.6; }
`;

interface WidthField {
  ids: string[];
  x: number;
  y: number;
}

export function ArtboardCommands({ readOnly = false }: { readOnly?: boolean }) {
  const selSet = useSelectionSet();
  const actions = useArtboardActions();
  const tool = useToolModeOptional()?.tool;
  const live = useRef({ selSet, actions, tool, readOnly });
  live.current = { selSet, actions, tool, readOnly };
  const [field, setField] = useState<WidthField | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'run-action' || !isArtboardAction(m.id) || live.current.readOnly) return;
      const a = live.current.actions;
      const p = (m.params ?? {}) as { width?: unknown; artboard?: unknown };
      const ids = typeof p.artboard === 'string' ? [p.artboard] : undefined;
      if (m.id === 'artboard.trash') {
        // The write is the shell's (main origin only, DDR-054): the same ask ⌫ posts.
        const boards =
          ids ??
          live.current.selSet.selected
            .filter((s) => !s.id && s.artboardId)
            .map((s) => s.artboardId as string);
        for (const artboardId of boards)
          window.parent.postMessage({ dgn: 'delete-artboard-request', artboardId }, '*');
      } else if (m.id === 'artboard.duplicate') void a.duplicate(ids);
      else if (m.id === 'artboard.rename') a.rename(ids?.[0]);
      else if (m.id === 'artboard.reset-position') a.resetPosition(ids);
      else if (typeof p.width === 'number') void a.duplicateAtWidth(ids, p.width);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ⌘D on an artboard selection
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const { selSet: sel, actions: a, tool: t, readOnly: ro } = live.current;
      if (e.defaultPrevented || ro || t === 'browse') return;
      const boards = sel.selected.filter((s) => !s.id && s.artboardId);
      if (boards.length === 0 || boards.length !== sel.selected.length) return;
      const action = resolveArtboardKey(e, {
        typing: isEditableTarget(e.target),
        mode: canvasModeStore(window).get().mode ?? 'edit',
        selection: 'artboard',
        singleKeys: canvasSingleKeys(),
      });
      if (action !== 'artboard.duplicate') return;
      e.preventDefault();
      void a.duplicate();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ⌥-drag: the drop becomes a copy (cancelled = taken; canvas-lib then does not move the originals)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onDrop = (e: Event) => {
      const moved = (e as CustomEvent<{ moved?: Array<{ id: string; x: number; y: number }> }>)
        .detail?.moved;
      if (live.current.readOnly || !moved?.length) return;
      e.preventDefault();
      void live.current.actions.duplicateOnDrop(moved);
    };
    window.addEventListener(DUPLICATE_ON_DROP_EVENT, onDrop);
    return () => window.removeEventListener(DUPLICATE_ON_DROP_EVENT, onDrop);
  }, []);

  // "Custom width…" from the menu
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<WidthField>).detail;
      if (live.current.readOnly || !d?.ids?.length) return;
      setDraft('');
      setField({ ids: d.ids, x: d.x, y: d.y });
    };
    window.addEventListener(CUSTOM_WIDTH_EVENT, onOpen);
    return () => window.removeEventListener(CUSTOM_WIDTH_EVENT, onOpen);
  }, []);

  const submit = useCallback(() => {
    if (!field) return;
    const w = parseWidth(draft);
    if (w === null) return;
    setField(null);
    void live.current.actions.duplicateAtWidth(field.ids, w);
  }, [field, draft]);

  if (!field) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <form
        className="ed-abw"
        data-testid="ab-custom-width"
        style={{ left: field.x, top: field.y }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="ab-custom-width-input">Width</label>
        <input
          id="ab-custom-width-input"
          data-testid="ab-custom-width-input"
          inputMode="numeric"
          value={draft}
          placeholder="1440"
          // biome-ignore lint/a11y/noAutofocus: the field opens on the designer's own menu choice
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setField(null);
          }}
          onBlur={() => setField(null)}
        />
        <span className="ed-abw-hint">↵ copy · esc</span>
      </form>
    </>
  );
}
