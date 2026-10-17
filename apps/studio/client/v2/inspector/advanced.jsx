// client/v2/inspector/advanced.jsx — S2.2 (Gate 0 D18): the inspector's "› Advanced" fold.
//
// Closed, the inspector speaks designer. Open, it adds what the code says: the selector, the element id,
// the tokens the element uses, Copy CSS, the facts the old Inspect tab showed — and UNDER them the v1 raw
// editor exactly as it was (CssKnobs in its Advanced vocabulary: ~33 properties, custom CSS property rows,
// HTML attribute rows, the grid tracks editor, the token popover). An artboard keeps its own editor
// (ArtboardKnobs). Nothing is retyped here: when a control has no designer home yet it is still here.
//
// The Designer/Advanced vocabulary switch is gone (rule 13): the frame is the designer vocabulary, this
// fold is the raw one; the switch "became this fold" (06 Advanced, ad-inspector).

import { useEffect, useRef, useState } from 'react';
import { ArtboardKnobs } from '../../inspector/artboard-knobs.jsx';
import { CssKnobs } from '../../inspector/css-knobs.jsx';
import { InspectComputed } from '../../inspector/inspect-computed.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useFold } from '../fold/use-fold.js';
import { isArtboardSelection } from './kinds/index.js';
import {
  COMPUTED_ID_RE,
  cssTextOf,
  hasUsableId,
  propertyCount,
  takenIds,
  tokensUsed,
  validateElementId,
} from './model.js';

/** What the old Inspect tab showed under the selector: where it is, how big, which tag and class. */
export function InspectFacts({ el }) {
  const b = el?.bounds || null;
  const row = (label, fields) => (
    <div className="st-insp-row">
      <span className="st-insp-label">{label}</span>
      <div className="st-insp-fields">{fields}</div>
    </div>
  );
  const mini = (tag, value, aria) => (
    <span className="st-fmini">
      <span className="st-mtag">{tag}</span>
      <input value={b ? Math.round(value) : '—'} readOnly aria-label={aria} />
    </span>
  );
  return (
    <div className="insp-facts" data-testid="inspector-facts">
      {row(
        'Pos',
        <>
          {mini('X', b?.x, 'x position')}
          {mini('Y', b?.y, 'y position')}
        </>
      )}
      {row(
        'Size',
        <>
          {mini('W', b?.w, 'width')}
          {mini('H', b?.h, 'height')}
        </>
      )}
      {row('Tag', <span className="insp-mono">{el?.tag || '—'}</span>)}
      {el?.classes ? row('Class', <span className="insp-mono">{el.classes}</span>) : null}
      <InspectComputed el={el} />
    </div>
  );
}

/** Copy to the clipboard; resolves true when it worked (a browser tab without the permission says no). */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ testid, label, text, done = 'Copied' }) {
  const [state, setState] = useState('idle');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="btn btn--sm insp-btn"
      data-testid={testid}
      onClick={async () => {
        const ok = await copyText(typeof text === 'function' ? text() : text);
        setState(ok ? 'done' : 'failed');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1600);
      }}
    >
      {state === 'done' ? done : state === 'failed' ? 'Not copied' : label}
    </button>
  );
}

/** The element id (V2-1.4 §5.5): rename it, and the writer rewrites every durable reference to it. */
function ElementId({ el, layersTree, canvasFile, onRename }) {
  const usable = hasUsableId(el);
  const shown = usable ? el.id : '';
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // a different element (or the same one after a rename landed): start from what the file says
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on a fresh id only.
  useEffect(() => {
    setDraft(shown);
    setError('');
  }, [el.id, el.index]);

  const commit = async () => {
    if (!onRename || busy) return;
    const verdict = validateElementId(draft, usable ? el.id : '', takenIds(layersTree, el.id));
    if (!verdict.ok) {
      if (verdict.code === 'same') {
        setError('');
        return;
      }
      setError(verdict.message);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await onRename({
        from: el.id,
        to: verdict.id,
        index: el.index,
        artboardId: el.artboardId ?? layersTree?.artboardId,
        canvas: canvasFile,
      });
      if (r && r.ok === false) setError(r.message || 'The id was not changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="insp-adv-block">
      <p className="insp-adv-h">Element id</p>
      <div className="insp-id">
        <input
          className="input insp-mono insp-id-input"
          data-testid="inspector-element-id"
          aria-label="Element id"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'inspector-id-error' : undefined}
          value={draft}
          placeholder={usable ? undefined : el.id}
          readOnly={!onRename}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(shown);
              setError('');
            }
          }}
        />
        {usable ? <CopyButton testid="inspector-copy-id" label="Copy id" text={el.id} /> : null}
      </div>
      {error ? (
        <p
          id="inspector-id-error"
          className="insp-err"
          role="alert"
          data-testid="inspector-id-error"
        >
          {error}
        </p>
      ) : null}
      {!usable && COMPUTED_ID_RE.test(el.id || '') ? (
        <p className="insp-note">Not named yet. Type a name and it becomes this element’s id.</p>
      ) : null}
    </div>
  );
}

function SelectionLine({ el }) {
  const path = Array.isArray(el.dom_path) ? el.dom_path.join(' > ') : el.selector;
  return (
    <p className="insp-code" data-testid="inspector-selection" title={path || undefined}>
      {el.selector || el.tag || 'element'}
      {el.text ? (
        <span className="insp-code-text" data-testid="inspector-selection-text">
          {' '}
          — “{String(el.text).slice(0, 60)}”
        </span>
      ) : null}
    </p>
  );
}

function TokensUsed({ el }) {
  const tokens = tokensUsed(el);
  if (!tokens.length) return null;
  return (
    <div className="insp-adv-block">
      <p className="insp-adv-h">Tokens it uses</p>
      <ul className="insp-toks" data-testid="inspector-tokens-used">
        {tokens.map((t) => (
          <li key={t.name} className="insp-tok" title={t.name}>
            {t.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The fold. `open` / `onToggle` are the frame's (it starts open while no section has a body yet, because
 * until S2.3 lands this fold IS the editor).
 */
export function InspectorAdvanced({
  selected,
  el,
  layersTree,
  cfg,
  canvasFile,
  open,
  onToggle,
  onRenameElementId,
  edit,
  artboard,
}) {
  const many = Array.isArray(selected) && selected.length > 1;
  const isArtboard = !many && isArtboardSelection(el);
  const hint = many ? 'Mixed' : isArtboard ? undefined : `${propertyCount(el)} properties`;
  return (
    <AdvancedFold panel="inspector" hint={hint} open={open} onToggle={onToggle}>
      {isArtboard ? (
        <ArtboardKnobs el={el} cfg={cfg} {...artboard} />
      ) : (
        <div className="insp-adv">
          {many ? null : (
            <>
              <SelectionLine el={el} />
              <ElementId
                el={el}
                layersTree={layersTree}
                canvasFile={canvasFile}
                onRename={onRenameElementId}
              />
              <TokensUsed el={el} />
              <div className="insp-adv-acts">
                <CopyButton
                  testid="inspector-copy-css"
                  label="Copy CSS"
                  text={() => cssTextOf(el)}
                />
              </div>
              <InspectFacts el={el} />
            </>
          )}
          {/* the unchanged v1 raw editor; no onSetMode = no Designer/Advanced switch (rule 13) */}
          <CssKnobs el={el} cfg={cfg} mode="advanced" {...edit} />
        </div>
      )}
    </AdvancedFold>
  );
}

/** Open/closed for the frame: remembered per Mac, but starts open while it is the only editor. */
export function useAdvancedOpen(hasSections) {
  const [stored, setStored] = useFold('inspector');
  const [chosen, setChosen] = useState(null);
  const open = chosen ?? (stored || !hasSections);
  return [
    open,
    () => {
      setChosen(!open);
      setStored(!open);
    },
  ];
}
