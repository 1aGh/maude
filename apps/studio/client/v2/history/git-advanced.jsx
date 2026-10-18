// client/v2/history/git-advanced.jsx — S1.15: the body of Version history › Advanced.
//
// Today's git body (branch, commits, discard — the v1 Git panel, unchanged) plus "Compare pictures": the
// DiffView full panel (before / after as `?sha=` panes, side by side or overlay wipe, one locked zoom). S11.10
// re-words the git half in place (contract S11-slices §2.2: S11 owns this file's body; S1.15 owns the picture
// compare and never lets a second one open). Until then `children` is the Git panel as it was.
//
// Props follow the contract: { canvas, version, role?, shell?, onCompare?(a, b), onRestored? } — this stub uses
// `canvas`, `version` (the version being looked at, `r<n>`) and `onComparePictures`.

import { COMPARE_PICTURES_WORDS as W } from './compare-words.js';

/**
 * @param p.canvas             the open canvas (repo-relative path); null = none
 * @param p.version            the version being looked at (`r<n>`) or null
 * @param p.onComparePictures  ({ file, beforeSha }) — opens DiffView; absent = no button
 * @param p.children           today's git body
 */
export function HistoryAdvanced({ canvas, version, onComparePictures, canView, children }) {
  return (
    <div className="vh-adv" data-testid="vh-advanced">
      {onComparePictures ? (
        <div className="vh-adv-row">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="vh-compare-pictures"
            disabled={!canvas || !canView}
            onClick={() => onComparePictures({ file: canvas, beforeSha: version || 'HEAD' })}
          >
            {W.button}
          </button>
          <span className="vh-adv-note">{version ? W.noteVersion : W.noteSaved}</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
