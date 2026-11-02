// client/v2/annotations/templates-panel.jsx — S4.4: the Templates panel (canvas 15, artboard 11 "Start from a template").
//
// A popover above the canvas toolbar (shell-rendered; PANEL_HOSTS.templates), opened by `tool-panel-open
// {panel:'templates'}` — the Section tool's "Templates" slot — or ⌘K "Templates".
//
//   Templates · "or drag on the canvas for a blank one"
//   8 tiles (title + one line + thumbnail) from annotations/templates.ts — the SAME list `annotate --board`
//   takes, so a pick here and the verb produce the same elements (rule 14)
//   an Ask field: describe the board and AI builds it with your items
//
// The panel only EMITS: `onPick({id})` for a tile (app.jsx relays it down as dgn `insert-template
// {id, follow:true}`; placing it where the person clicks is S4.13) and `onDescribe(text)` for the Ask field.
// "Describe it" FILLS the AI chat composer through the ⌘K Ask-AI path and never sends — the person still
// presses send (the S5 run entry that sends in the same gesture is S4-S5-ai-annotations.md, not built yet).
//
// Keys: arrows move the highlighted tile, Enter picks it, Escape closes. Tokens only (templates-panel.css).

import { useEffect, useRef, useState } from 'react';
import { TEMPLATES } from '../../../annotations/templates.ts';
import { v2Scope } from './v2-scope.js';
import { reasonProps } from '../access/disabled-reason.js';

/** The columns of the tile grid (canvas 15 `.an-tpl-g`). */
export const TEMPLATE_COLUMNS = 4;

/** What "describe it" puts in front of the person's words so the AI knows to build a board. */
export const DESCRIBE_PREFIX = 'Build this on the canvas: ';

/** What the field says where AI chat does not exist (a browser tab — the chat panel is native-only). */
export const NO_CHAT = 'AI chat is in the Maude desktop app.';

/** The composer text for a description; empty text gives null (nothing to fill). */
export function describeText(text) {
  const t = String(text ?? '').trim();
  return t ? `${DESCRIBE_PREFIX}${t}` : null;
}

/** The tile an arrow key moves to from `i` (stays put at an edge). */
export function moveTile(i, key, count = TEMPLATES.length, cols = TEMPLATE_COLUMNS) {
  const next =
    key === 'ArrowRight'
      ? i + 1
      : key === 'ArrowLeft'
        ? i - 1
        : key === 'ArrowDown'
          ? i + cols
          : key === 'ArrowUp'
            ? i - cols
            : i;
  return next >= 0 && next < count ? next : i;
}

function SparkIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4L8 2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** `placePanel`'s output → fixed-position CSS. */
function anchoredStyle(a) {
  const st = { left: a.left, width: a.width, maxHeight: a.maxHeight };
  if (a.top != null) st.top = a.top;
  if (a.bottom != null) st.bottom = a.bottom;
  return st;
}

/**
 * @param props.onPick ({id}) => void — a tile was picked
 * @param props.onDescribe (text) => void — the composer text to fill (already prefixed)
 * @param props.canAsk boolean — false where AI chat does not exist (browser tabs); the field is then off
 * @param props.onClose () => void
 * @param props.anchor `placePanel` output or null (centred dialog)
 */
export default function TemplatesPanel({
  onPick,
  onDescribe,
  onClose,
  anchor = null,
  canAsk = true,
}) {
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState('');
  const gridRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The panel takes the keyboard when it opens (arrows move the tile, ↵ picks it — the header says so); with the
  // focus left in the canvas those keys went to the canvas instead.
  useEffect(() => {
    gridRef.current?.querySelector('button')?.focus();
  }, []);

  // Pinned to the toolbar there is no scrim — the panel says "or drag on the canvas for a blank one", and a scrim
  // swallowed that first drag (it closed the panel and drew nothing). Like the F size picker: a press outside
  // closes it, and so does the focus moving into the canvas iframe (a press there never reaches this document).
  useEffect(() => {
    if (!anchor) return undefined;
    const onDown = (e) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose();
    };
    const onBlur = () => onClose();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [anchor, onClose]);

  const pick = (t) => {
    onPick?.({ id: t.id });
    onClose();
  };
  const send = () => {
    const text = canAsk ? describeText(ask) : null;
    if (!text) return;
    onDescribe?.(text);
    onClose();
  };
  const onGridKey = (e) => {
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const next = moveTile(active, e.key);
      setActive(next);
      gridRef.current?.querySelectorAll('button')[next]?.focus();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a click-outside surface; Escape (window listener) and the Close button are the keyboard routes
    <div
      className={anchor ? 'sh-scrim sh-scrim--anchored tp-scrim' : 'sh-scrim'}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        {...v2Scope(
          anchor
            ? 'sh-dialog sh-sticker-picker tp sh-sticker-picker--anchored'
            : 'sh-dialog sh-sticker-picker tp'
        )}
        data-testid="tool-panel-templates"
        data-placement={anchor?.placement}
        style={anchor ? anchoredStyle(anchor) : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Templates"
      >
        <div className="sh-dialog-hd">
          <span className="sh-dialog-title">Templates</span>
          <span className="tp-hint">or drag on the canvas for a blank one</span>
        </div>
        <div className="sh-dialog-bd">
          {/* biome-ignore lint/a11y/useSemanticElements: a CSS grid of tile buttons; a fieldset would bring its own border and legend */}
          <div
            className="tp-grid"
            role="group"
            aria-label="Choose a template"
            ref={gridRef}
            data-testid="templates-grid"
            onKeyDown={onGridKey}
          >
            {TEMPLATES.map((t, i) => (
              <button
                key={t.id}
                type="button"
                className="tp-tile"
                data-testid={`templates-tile-${t.id}`}
                data-on={i === active ? 'true' : undefined}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => pick(t)}
              >
                <span className={`tp-th tp-th--${t.thumb}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <strong>{t.title}</strong>
                <em>{t.desc}</em>
              </button>
            ))}
          </div>
          <div className="tp-ask" data-testid="templates-ask">
            <input
              className="tp-ask-in"
              data-testid="templates-ask-input"
              type="text"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={canAsk ? 'Describe it — AI builds it on the canvas' : NO_CHAT}
              disabled={!canAsk}
              aria-label="Describe what to build"
            />
            <button
              type="button"
              className="tp-send"
              data-testid="templates-ask-send"
              aria-label="Ask AI to build it"
              disabled={!canAsk || !ask.trim()}
              {...reasonProps(!canAsk, NO_CHAT)}
              onClick={send}
            >
              <SparkIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
