// client/v2/left-panel/layers-advanced.jsx — S11.9: Layers › Advanced, the one quiet row at the foot of the
// Layers panel (06 · ad-left, "Layers · Advanced open"). One fold per panel (CONTRACT §7): the left panel
// has two tabs with a fold each — `left.canvases` and `left.layers` — and the fold you see follows the tab.
//
//   Show tags and ids      a switch: each layer row prints its tag and id after its name
//   On this canvas         "15 artboards · 214 layers" (the layers of the tree the panel holds)
//   Select by selector     a mono field; ↵ selects every match inside the artboards (capped, scoped on the
//                          canvas side — selector-scope.js). Invalid or over-long is refused HERE, inline.
//   Element id             the selected element's id, mono, with Copy
//
// Everything here is a view or a selection in the person's own window: nothing writes the project.

import { useEffect, useRef, useState } from 'react';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import {
  checkSelector,
  countLayers,
  countsLine,
  SELECTOR_WORDS,
  SELECTOR_MAX_LEN,
} from './advanced-model.js';
import { copyText } from './canvas-file-menu.js';
import { FOCUS_SELECTOR_EVENT, takeFocusSelectorRequest } from './left-panel-bus.js';
import { useViewPref, VIEW_PREF_KEYS } from './view-prefs.js';

/** This panel's fold key in prefs.json `fold`. */
export const LAYERS_FOLD = 'left.layers';

const LP_CLASSES = Object.freeze({
  root: 'lp-adv',
  btn: 'lp-adv-btn',
  ch: 'lp-adv-ch',
  body: 'lp-adv-body',
});

export function LayersAdvanced({
  tree = null,
  artboardCount,
  elementId = null,
  onSelectBySelector,
  toast,
  open,
  onToggle,
}) {
  const [showTags, setShowTags] = useViewPref(VIEW_PREF_KEYS.tags);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  // ⌘K "Select by selector": the field takes the focus when it mounts (or at once, if it is already there)
  useEffect(() => {
    const take = () => {
      if (takeFocusSelectorRequest()) inputRef.current?.focus();
    };
    take();
    window.addEventListener(FOCUS_SELECTOR_EVENT, take);
    return () => window.removeEventListener(FOCUS_SELECTOR_EVENT, take);
  }, []);

  const submit = () => {
    const verdict = checkSelector(draft);
    if (verdict.kind === 'empty') {
      setError('');
      return;
    }
    if (verdict.kind === 'error') {
      setError(verdict.error);
      inputRef.current?.focus();
      return;
    }
    setError('');
    onSelectBySelector?.(verdict.selector);
  };

  const copyId = async () => {
    const ok = await copyText(elementId);
    toast?.(ok ? 'Element id copied.' : 'Couldn’t copy the element id.');
  };

  const line = countsLine({ artboards: artboardCount, layers: countLayers(tree) });

  return (
    <AdvancedFold
      panel={LAYERS_FOLD}
      classes={LP_CLASSES}
      testid="layers-advanced-fold"
      buttonTestid="layers-advanced"
      open={open}
      onToggle={onToggle}
    >
      <div className="lp-adv-row">
        <span className="lp-adv-k" id="lp-tags-k">
          Show tags and ids
        </span>
        <button
          type="button"
          role="switch"
          className="lp-switch"
          data-testid="layers-show-tags"
          aria-checked={!!showTags}
          aria-labelledby="lp-tags-k"
          onClick={() => setShowTags((v) => !v)}
        />
      </div>
      {line ? (
        <div className="lp-adv-row">
          <span className="lp-adv-k">On this canvas</span>
          <span className="lp-adv-v" data-testid="layers-counts">
            {line}
          </span>
        </div>
      ) : null}
      <div className="lp-adv-row lp-adv-stack">
        <label className="lp-adv-k" htmlFor="lp-selector">
          Select by selector
        </label>
        <input
          id="lp-selector"
          ref={inputRef}
          type="text"
          className="lp-selector"
          data-testid="layers-selector"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          maxLength={SELECTOR_MAX_LEN + 20}
          placeholder={SELECTOR_WORDS.placeholder}
          value={draft}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'lp-selector-err' : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape' && draft) {
              e.preventDefault();
              e.stopPropagation();
              setDraft('');
              setError('');
            }
          }}
        />
        {error ? (
          <span
            id="lp-selector-err"
            className="lp-selector-err"
            role="alert"
            data-testid="layers-selector-error"
          >
            {error}
          </span>
        ) : null}
      </div>
      {elementId ? (
        <div className="lp-adv-row">
          <span className="lp-adv-k">Element id</span>
          <span className="lp-adv-v">
            <span className="lp-adv-mono" data-testid="layers-element-id">
              {elementId}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="layers-element-id-copy"
              aria-label="Copy element id"
              onClick={copyId}
            >
              Copy
            </button>
          </span>
        </div>
      ) : null}
    </AdvancedFold>
  );
}
