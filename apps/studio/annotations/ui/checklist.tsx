/**
 * @file       annotations/ui/checklist.tsx — a checklist drawn inside its sticky (#113, contract 113-checklist §5.4–§5.6)
 * @scope      apps/studio/annotations/ui/checklist.tsx
 * @purpose    The rows under a sticky's title: a 16 px box drawn in SVG (never a font glyph, so exports match), the
 *             entry's words (done = a tick and a strike in a quieter ink), the "3/5" chip, "+ Add an item".
 *
 *             The layer owns every write and every key: it provides `ChecklistContext` (the entries of each list,
 *             whether rows take input, and the gestures — each one op batch, one ⌘Z) and answers the registry keys
 *             (`checklist.*`, `useCanvasKeys` under the `checkItemFocused` fact). This file adds NO key handler; it
 *             only draws, reports which row has focus (roving tabIndex, one tab stop per list) and turns a click into
 *             a gesture.
 *
 *             Not interactive (Edit's quiet posture, Present, Can view / Can comment, an export): drawn, inert, no
 *             tab stop, no "+ Add an item". The AI's ticks wear the spark (`done.by === 'AI'`). Reduced motion: no
 *             tick animation ever (there is none to switch off).
 */

import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

import { progressOf } from '../elements/checkitem.model.ts';
import type { AnnotationElement } from '../types.ts';
import { AI_SPARK } from './ai-marks.tsx';
import { CHECKLIST_ATTR } from './checklist-wire.ts';
import { contrast, OBJECT_INK, TEXT_FLOOR } from './posture.ts';
import { UI_FONT } from './text-style.ts';

/** An entry being typed in: which one, and where the caret starts (`'end'` by default). */
export interface CheckEdit {
  id: string;
  caret?: number | 'end';
}

export interface ChecklistApi {
  /** Every list's genuine entries, in order (`itemsByList`). Identity changes only when an entry does. */
  byList: ReadonlyMap<string, readonly AnnotationElement[]>;
  /** Rows take input: Preview, Can edit (posture `drawn`). */
  interactive: boolean;
  /** The entry open for typing, if any. */
  editing: CheckEdit | null;
  /** A row to focus once it is drawn (after a move, a removal, an add). Consumed by `focused`. */
  focusRequest: CheckEdit | null;
  /** The person's own last tick, for the polite live line ("3 of 5 done"). */
  announce: { list: string; text: string } | null;
  toggle: (itemId: string) => void;
  startEdit: (itemId: string, caret?: number | 'end') => void;
  /** An entry's words leave the field (blur / esc): one reword, if they changed. */
  commitText: (itemId: string, text: string) => void;
  /** "+ Add an item": a new empty entry at the end, open for typing. */
  addAtEnd: (listId: string) => void;
  /** A row took focus (the layer selects its sticky so the row's keys have their scope). */
  focused: (itemId: string) => void;
}

export const ChecklistContext = createContext<ChecklistApi | null>(null);

/** The entries of a sticky (empty when it is not a checklist or no provider is mounted). */
export function useChecklistItems(stickyId: string): readonly AnnotationElement[] {
  return useContext(ChecklistContext)?.byList.get(stickyId) ?? EMPTY;
}
const EMPTY: readonly AnnotationElement[] = [];

/** What an empty entry shows (and is called, for a screen reader: "Empty item"). */
export const CHECK_PLACEHOLDER = 'To do';

/** The ink of a ticked entry on `paper`: the object ink mixed toward the paper, never under 4.5:1 (§5.6). */
export function doneInk(paper: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(paper.trim());
  if (!m) return OBJECT_INK;
  const bg = [0, 2, 4].map((i) => Number.parseInt((m[1] as string).slice(i, i + 2), 16));
  const ink = [0, 2, 4].map((i) => Number.parseInt(OBJECT_INK.slice(1 + i, 3 + i), 16));
  for (const k of [0.62, 0.7, 0.78, 0.86]) {
    const mixed = `#${[0, 1, 2]
      .map((i) =>
        Math.round((ink[i] as number) * k + (bg[i] as number) * (1 - k))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;
    if (contrast(mixed, paper) >= TEXT_FLOOR) return mixed;
  }
  return OBJECT_INK;
}

const isDone = (it: AnnotationElement) => it.done !== undefined && it.done !== null;
const doneByAi = (it: AnnotationElement) =>
  !!it.done && typeof it.done === 'object' && (it.done as { by?: unknown }).by === 'AI';
const textOf = (it: AnnotationElement) => (typeof it.text === 'string' ? it.text : '');

/** "3 of 5 done" — the chip's spoken form. */
export function progressWords(items: readonly AnnotationElement[]): string {
  const p = progressOf(items);
  return `${p.done} of ${p.total} done`;
}

/** The 16 px box: an outline, filled with a tick when done. SVG so an export draws it the same. */
function CheckBox({ done, ai, ink }: { done: boolean; ai: boolean; ink: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 16px', marginTop: 2 }}
    >
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="3"
        fill={done ? (ai ? AI_SPARK : ink) : 'none'}
        stroke={ai ? AI_SPARK : ink}
        strokeWidth="1.5"
      />
      {done ? (
        <path
          d="M4.2 8.4 6.8 11l5-5.6"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

export interface ChecklistRowsProps {
  listId: string;
  /** The sticky's title (the group's accessible name). */
  title: string;
  /** The sticky's paper (for the done ink). */
  paper: string;
  fontSize: number;
  /** Keep the rows inert even with a provider (a quiet / read-only / editing sticky). */
  inert?: boolean;
}

/**
 * The entries of one checklist sticky, under its title. One `role="group"` labelled by the title; each row a
 * `role="checkbox"` with `aria-checked` and the entry as its name; one tab stop per list (roving tabIndex).
 */
export function ChecklistRows({ listId, title, paper, fontSize, inert }: ChecklistRowsProps) {
  const api = useContext(ChecklistContext);
  const items = api?.byList.get(listId) ?? EMPTY;
  const live = !!api?.interactive && !inert;
  const [active, setActive] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editing =
    live && api?.editing && items.some((i) => i.id === api.editing?.id) ? api.editing : null;
  const request = live ? api?.focusRequest : null;
  // A row the layer asked for (after a move / removal / add) takes focus once it is drawn.
  useLayoutEffect(() => {
    if (!request || !items.some((i) => i.id === request.id)) return;
    const root = rootRef.current;
    const sel = `[data-item-id="${request.id.replace(/["\\]/g, '')}"]`;
    const row = root?.querySelector<HTMLElement>(sel);
    if (!row) return;
    setActive(request.id);
    if (editing?.id !== request.id) row.focus({ preventScroll: true });
  }, [request, items, editing]);
  // The open entry's field takes focus with its caret where it was asked.
  useLayoutEffect(() => {
    if (!editing) return;
    const input = rootRef.current?.querySelector<HTMLInputElement>('input[data-an-check-input]');
    if (!input) return;
    input.focus({ preventScroll: true });
    const at =
      editing.caret === undefined || editing.caret === 'end' ? input.value.length : editing.caret;
    try {
      input.setSelectionRange(at, at);
    } catch {
      /* happy-dom / a detached field */
    }
  }, [editing]);
  if (!items.length) return null;
  const ink = OBJECT_INK;
  const quiet = doneInk(paper);
  const tabStop = active && items.some((i) => i.id === active) ? active : (items[0]?.id ?? null);
  const label = title.trim() || 'Checklist';
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> draws a border and wants a <legend>; the title above names it
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      className="dc-annot-checklist"
      data-testid={`checklist-${listId}`}
      {...(live ? { [CHECKLIST_ATTR]: '1' } : {})}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        marginTop: 4,
        // `.dc-annot-el` takes no pointer (a sticky is hit through its paper); live rows take their own presses
        pointerEvents: live ? 'auto' : undefined,
      }}
    >
      {items.map((it) => {
        const done = isDone(it);
        const words = textOf(it);
        const name = words.trim() ? words : 'Empty item';
        const open = editing?.id === it.id;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a row holds the box AND an editable entry; a native checkbox cannot
          <div
            key={it.id}
            role="checkbox"
            aria-checked={done}
            aria-label={name}
            aria-disabled={live ? undefined : true}
            tabIndex={live ? (it.id === tabStop ? 0 : -1) : undefined}
            data-testid={`checklist-row-${it.id}`}
            data-item-id={it.id}
            data-an-check-row="1"
            {...(done ? { 'data-done': '1' } : {})}
            {...(doneByAi(it) ? { 'data-by': 'ai' } : {})}
            onFocus={
              live
                ? (e) => {
                    if (e.target !== e.currentTarget && !open) return;
                    setActive(it.id);
                    api?.focused(it.id);
                  }
                : undefined
            }
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              minHeight: 24, // WCAG 2.5.8 — the row is the target, not only the box
              padding: '2px 0',
              boxSizing: 'border-box',
              outlineOffset: 1,
              cursor: live ? 'default' : undefined,
            }}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the row is the checkbox; its key is the registry's Space (checklist.toggle) */}
            <span
              data-an-check-box="1"
              onClick={live ? () => api?.toggle(it.id) : undefined}
              style={{
                display: 'grid',
                placeItems: 'start center',
                width: 20,
                minHeight: 20,
                flex: '0 0 20px',
                cursor: live ? 'pointer' : undefined,
              }}
            >
              <CheckBox done={done} ai={doneByAi(it)} ink={ink} />
            </span>
            {open ? (
              <input
                data-an-check-input="1"
                aria-label={`Edit item${words.trim() ? ` “${words}”` : ''}`}
                defaultValue={words}
                maxLength={2000}
                onBlur={(e) => api?.commitText(it.id, e.currentTarget.value.replace(/\n/g, ' '))}
                onKeyDown={(e) => {
                  // Esc keeps the typed words (#163 D1) and leaves the field; the row keeps focus.
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const row = e.currentTarget.closest<HTMLElement>('[data-an-check-row]');
                  e.currentTarget.blur();
                  row?.focus({ preventScroll: true });
                }}
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  font: 'inherit',
                  fontSize,
                  color: 'inherit',
                  background: 'transparent',
                  border: 0,
                  outline: 'none',
                  padding: 0,
                  margin: 0,
                }}
              />
            ) : (
              // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: ↵ on the row opens the entry (checklist.edit, the registry)
              <span
                data-an-check-text="1"
                onClick={live ? () => api?.startEdit(it.id, 'end') : undefined}
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  color: done ? quiet : words.trim() ? ink : quiet,
                  textDecoration: done ? 'line-through' : undefined,
                  fontStyle: words.trim() ? undefined : 'italic',
                  cursor: live ? 'text' : undefined,
                }}
              >
                {words.trim() ? words : CHECK_PLACEHOLDER}
              </span>
            )}
          </div>
        );
      })}
      {live ? (
        <button
          type="button"
          data-testid="checklist-add"
          className="dc-annot-check-add"
          onClick={() => api?.addAtEnd(listId)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 24,
            padding: '2px 0',
            margin: 0,
            border: 0,
            background: 'transparent',
            color: quiet,
            font: 'inherit',
            fontSize,
            fontWeight: 500,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true" style={{ width: 20, textAlign: 'center' }}>
            +
          </span>
          Add an item
        </button>
      ) : null}
    </div>
  );
}

/** The footer chip "3/5" beside the author line; it says "3 of 5 done" after the person's own tick. */
export function ChecklistChip({ listId, paper }: { listId: string; paper: string }) {
  const api = useContext(ChecklistContext);
  const items = api?.byList.get(listId) ?? EMPTY;
  if (!items.length) return null;
  const p = progressOf(items);
  const said = api?.announce?.list === listId ? api.announce.text : '';
  return (
    <span
      className="dc-annot-check-chip"
      data-testid={`checklist-progress-${listId}`}
      title={progressWords(items)}
      style={{
        position: 'absolute',
        right: 10,
        bottom: 4,
        padding: '0 6px',
        borderRadius: 8,
        fontFamily: UI_FONT,
        fontSize: 'var(--type-xs, 11px)',
        fontWeight: 600,
        lineHeight: 1.5,
        color: doneInk(paper),
        backgroundColor: paper,
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <span aria-hidden="true">
        {p.done}/{p.total}
      </span>
      <span
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {said}
      </span>
    </span>
  );
}
