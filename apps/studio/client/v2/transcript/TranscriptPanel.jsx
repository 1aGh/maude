// client/v2/transcript/TranscriptPanel.jsx — S7.11: the Transcript panel (07 · ve-captions, "Strike a word, and
// the clip cuts there.").
//
// An island in the left slot (Q17) that shows what the video SAYS as text. Select words and press ⌫ and the clip
// loses exactly that time — the captions follow because they are derived from the cut. Type over a word to fix
// a misheard one (it becomes a fix in THIS video's captions, Q4). Words cut earlier stay in the text, struck.
// A word with p < 0.5 is underlined so it gets checked; whisper's repetitions say "May be noise, not speech".
//
// The view is pure: `model` (transcript-model.js), the panel's state (`ui`), and the handlers. TranscriptHost
// wires them to the shell. Speech is untrusted text: it is only ever rendered as a React child.

import { useEffect, useRef, useState } from 'react';
import { fixingText } from '../timeline/peers.jsx';
import { NO_ENGINE_TEXT } from './captions-api.js';
import { rangeKeys } from './transcript-model.js';

export const TX_FOOT =
  'Select words and press delete to cut them. Fix a misheard word by typing over it.';
export const TX_NO_CAPTIONS = 'Add captions to fix a misheard word.';

function CaptionsGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <rect x="2" y="3.5" width="12" height="9" rx="2" />
      <path d="M5 7.5h2M9 7.5h2M5 10h4M10.5 10H11" />
    </svg>
  );
}

/** One word. A button-less span: selection is by pointer and keys on the panel, as text is. */
function Word({
  item,
  selected,
  playing,
  editing,
  heldBy,
  onDown,
  onEnter,
  onEdit,
  onCommit,
  onCancel,
}) {
  const state = item.state;
  const title =
    (heldBy ? fixingText(heldBy) : null) ??
    item.note ??
    (item.lowConfidence
      ? 'Not sure about this word — check it.'
      : state === 'hidden'
        ? 'Hidden from the captions'
        : undefined);
  if (editing) {
    return (
      <input
        className="tx-edit"
        data-testid="transcript-edit"
        aria-label="Fix this word"
        // biome-ignore lint/a11y/noAutofocus: the field exists because the person started typing
        autoFocus
        defaultValue={editing.seed}
        size={Math.max(3, (editing.seed ?? item.text).length + 1)}
        onFocus={(e) =>
          editing.select ? e.currentTarget.select() : e.currentTarget.setSelectionRange(99, 99)
        }
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a word is a pointer-select target inside the transcript's focusable list; the list's keydown (arrows, Enter, Delete) is the keyboard path
    <span
      className="tx-w"
      data-testid={`transcript-word-${item.wordId}`}
      data-key={item.key}
      data-state={state}
      data-selected={selected ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      data-low={item.lowConfidence ? 'true' : undefined}
      data-fixed={item.fixed ? 'true' : undefined}
      data-held={heldBy ? 'true' : undefined}
      title={title}
      onMouseDown={(e) => onDown(e, item)}
      onMouseEnter={(e) => onEnter(e, item)}
      onDoubleClick={() => onEdit(item, true)}
    >
      {item.text}
    </span>
  );
}

/**
 * @param {{
 *   model: import('./transcript-model.js').TranscriptModel,
 *   ui: { working: string|null, noEngine: boolean, notice: string|null, selection: string[], anchor: string|null, tip: string|null },
 *   frame: number,
 *   canEdit: boolean,
 *   onSelect: (keys: string[], anchor: string|null) => void,
 *   lockedBy?: (key: string) => string|null,   // S7.17: the teammate fixing this word, or null
 *   onEditing?: (key: string|null) => void,    // S7.17: the word I opened to fix, or null when I left it
 *   onCut: () => void,
 *   onFix: (item: any, text: string) => Promise<any>|void,
 *   onFindSpeech: () => void,
 *   onSetUp: () => void,
 *   onClose: () => void,
 * }} props
 */
export function TranscriptPanel({
  model,
  ui,
  frame,
  canEdit,
  onSelect,
  onCut,
  onFix,
  onFindSpeech,
  onSetUp,
  onClose,
  lockedBy,
  onEditing,
}) {
  const [editing, setEditing] = useState(null); // { key, seed, select }
  // S7.17 — the word I am fixing is published as mine; a word a teammate is fixing does not open for me
  const editingKey = editing?.key ?? null;
  useEffect(() => {
    onEditing?.(editingKey);
  }, [editingKey, onEditing]);
  const [dragging, setDragging] = useState(false);
  const root = useRef(null);
  const items = model.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.items));
  const selected = new Set(ui.selection);
  const one = ui.selection.length === 1 ? items.find((i) => i.key === ui.selection[0]) : null;
  const hasCaptions = !!model.captions;

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const startEdit = (item, selectAll, seed) => {
    if (!canEdit || !hasCaptions || item.state === 'struck') return;
    if (lockedBy?.(item.key)) return;
    onSelect([item.key], item.key);
    setEditing({ key: item.key, seed: seed ?? item.text, select: selectAll });
  };

  const onDown = (e, item) => {
    if (e.button !== 0) return;
    root.current?.focus();
    setDragging(true);
    if (e.shiftKey && ui.anchor) onSelect(rangeKeys(model, ui.anchor, item.key), ui.anchor);
    else onSelect([item.key], item.key);
  };
  const onEnter = (_e, item) => {
    if (dragging && ui.anchor) onSelect(rangeKeys(model, ui.anchor, item.key), ui.anchor);
  };

  const onKeyDown = (e) => {
    if (editing) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (ui.selection.length && canEdit) {
        e.preventDefault();
        onCut();
      }
    } else if (e.key === 'Escape') {
      if (ui.selection.length) onSelect([], null);
      else onClose();
    } else if (e.key === 'Enter' && one) {
      e.preventDefault();
      startEdit(one, true);
    } else if (one && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // typing over a selected word replaces it
      e.preventDefault();
      startEdit(one, false, e.key);
    }
  };

  const empty = !model.hasWords && !ui.working && !ui.noEngine;
  return (
    <section
      ref={root}
      className="island island--pad tx-panel"
      data-testid="transcript-panel"
      data-occludes="left"
      aria-label="Transcript"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the panel takes the keys (⌫ cuts, Enter fixes)
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <p className="tx-head">
        <CaptionsGlyph />
        <span>Transcript</span>
        {model.sections.length === 1 ? (
          <span className="tx-src" data-testid="transcript-source">
            {model.sections[0].name}
          </span>
        ) : null}
        <button
          type="button"
          className="tx-x"
          data-testid="transcript-close"
          aria-label="Close the transcript"
          onClick={onClose}
        >
          ×
        </button>
      </p>

      {ui.working ? (
        <p className="tx-quiet" role="status" data-testid="transcript-working">
          {ui.working}
        </p>
      ) : null}

      {ui.noEngine ? (
        <div className="tx-ask" data-testid="transcript-no-engine">
          <p>{NO_ENGINE_TEXT}</p>
          <button
            type="button"
            className="btn btn--sm"
            data-testid="transcript-set-up"
            onClick={onSetUp}
          >
            Set up…
          </button>
        </div>
      ) : null}

      {model.sections.map((s) => (
        <div className="tx-sec" key={s.src}>
          {model.sections.length > 1 ? <p className="tx-sec-h">{s.name}</p> : null}
          {s.paragraphs.map((p) => (
            <p className="tx-p" key={p.id} data-testid="transcript-paragraph">
              {p.time ? <span className="tx-t">{p.time}</span> : null}
              {p.items.map((it, n) => (
                <span key={it.key}>
                  {n > 0 ? ' ' : null}
                  <Word
                    item={it}
                    selected={selected.has(it.key)}
                    playing={it.f0 !== null && frame >= it.f0 && frame < it.f1}
                    editing={editing?.key === it.key ? editing : null}
                    heldBy={lockedBy?.(it.key) ?? null}
                    onDown={onDown}
                    onEnter={onEnter}
                    onEdit={startEdit}
                    onCommit={(text) => {
                      setEditing(null);
                      onFix(it, text);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </span>
              ))}
            </p>
          ))}
        </div>
      ))}

      {empty ? (
        <div className="tx-ask" data-testid="transcript-empty">
          <p>No words yet.</p>
          {canEdit ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="transcript-find-speech"
              onClick={onFindSpeech}
            >
              Find speech
            </button>
          ) : null}
        </div>
      ) : null}

      {model.missing.length > 0 && model.hasWords && canEdit && !ui.working ? (
        <button
          type="button"
          className="tx-link"
          data-testid="transcript-find-speech"
          onClick={onFindSpeech}
        >
          Find speech in the other {model.missing.length === 1 ? 'clip' : 'clips'}
        </button>
      ) : null}

      {one?.state === 'noise' ? (
        <p className="tx-quiet" data-testid="transcript-noise">
          {one.note}
          {canEdit && hasCaptions ? (
            <button
              type="button"
              className="tx-link"
              data-testid="transcript-keep"
              onClick={() => onFix(one, one.original)}
            >
              It is speech
            </button>
          ) : null}
        </p>
      ) : null}

      {ui.tip ? (
        <span className="tx-tip" role="status" data-testid="transcript-tip">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 8h12M5 4.5c1-1 3.2-1.4 4.5-.6M11 11.5c-1 1-3.2 1.4-4.5.6" />
          </svg>
          {ui.tip}
        </span>
      ) : null}
      {ui.notice ? (
        <p className="tx-quiet" role="status" data-testid="transcript-notice">
          {ui.notice}
        </p>
      ) : null}

      <p className="tx-foot" data-testid="transcript-foot">
        {model.hasWords && !hasCaptions ? `${TX_FOOT.split(' Fix')[0]} ${TX_NO_CAPTIONS}` : TX_FOOT}
      </p>
      <span className="tx-sr" aria-live="polite">
        {ui.selection.length
          ? `${ui.selection.length} ${ui.selection.length === 1 ? 'word' : 'words'} selected`
          : ''}
      </span>
    </section>
  );
}
