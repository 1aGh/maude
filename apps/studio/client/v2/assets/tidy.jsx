// client/v2/assets/tidy.jsx — Not used, and moving what nothing needs to the trash (S8.13; 12 · ia-assets-tidy).
//
// "Not used" lists only what no canvas uses TODAY. A picture a retained older version still shows, and today's AI takes nobody
// placed yet, are left out and SAID ("Not counted: 12 kept only by older versions, 3 AI takes from today"), so Move to the
// trash can't break Version history. While the older versions are still being read nothing is listed and nothing can be moved
// (the index's verdict is 'checking'; a wrong "not used" would invite deleting a picture a version still shows).
// The studio refuses the same pictures again at `POST /_api/assets/trash` — this view only does not offer them.

import { useEffect, useRef } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { restoreFocus, trapTab } from '../shell/modal-focus.js';
import { sizeWords } from './tile.jsx';

/**
 * What the Not used view lists and says.
 * @param {Array<object>} rows the index rows (use-assets.js)
 * @param {string} [history] the scan state: 'idle' | 'checking' | 'ready'
 */
export function tidyModel(rows, history = 'idle') {
  const list = [];
  let keptByVersions = 0;
  let recentTakes = 0;
  let checking = history === 'checking';
  for (const r of rows || []) {
    const free = (r.usedIn?.length ?? 0) === 0 && !r.usedElsewhere && r.usedIn != null;
    if (r.notUsed === 'checking') checking = true;
    if (r.notUsed === true) list.push(r);
    else if (free && r.recentTake) recentTakes++;
    else if (free && r.olderVersions === true) keptByVersions++;
  }
  const bytes = list.reduce((n, r) => n + (Number(r.size) || 0), 0);
  return { list, count: list.length, bytes, keptByVersions, recentTakes, checking };
}

/** "31 assets · 212 MB" */
export const tidyTotalWords = (m) =>
  `${m.count} ${m.count === 1 ? 'asset' : 'assets'} · ${sizeWords(m.bytes)}`;

/** "Move 31 to the trash…" */
export const tidyButtonWords = (n) => `Move ${n} to the trash…`;

/** The line over the list: what was left out and why, or that older versions are still being read. */
export function notCountedWords(m) {
  if (m.checking) return 'Checking older versions…';
  const parts = [];
  if (m.keptByVersions) parts.push(`${m.keptByVersions} kept only by older versions`);
  if (m.recentTakes)
    parts.push(`${m.recentTakes} AI ${m.recentTakes === 1 ? 'take' : 'takes'} from today`);
  return parts.length ? `Not counted: ${parts.join(', ')}.` : '';
}

export function NotCountedNote({ model }) {
  const words = notCountedWords(model);
  if (!words) return null;
  return (
    <p className="lp-notcounted" role="status" data-testid="assets-notcounted">
      <StIcon name="history" size={12} />
      <span>{words}</span>
    </p>
  );
}

/** The foot of the Not used view: how many, how big, and the one button. A viewer sees the numbers only. */
export function TidyFoot({ model, canTrash, busy, onAsk }) {
  if (model.count === 0) return null;
  return (
    <div className="lp-tidy-foot" data-testid="assets-tidy-foot">
      <span>{tidyTotalWords(model)}</span>
      {canTrash ? (
        <button
          type="button"
          className="btn btn--sm"
          data-testid="assets-tidy-trash"
          disabled={busy || model.checking}
          onClick={onAsk}
        >
          {tidyButtonWords(model.count)}
        </button>
      ) : null}
    </div>
  );
}

/** "Move 31 assets to the trash?" — the title asks with the verb the primary button says. */
export function ConfirmTrash({ count, bytes, onCancel, onConfirm }) {
  const ref = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus(); // the safe answer first: Enter on open must not move anything
    return () => restoreFocus(opener);
  }, []);
  const title = `Move ${count} ${count === 1 ? 'asset' : 'assets'} to the trash?`;
  return (
    <div
      className="gi-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lp-trash-t"
      data-testid="assets-trash-dialog"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else trapTab(e, ref.current);
      }}
    >
      <div className="gi-scrim" aria-hidden="true" onClick={onCancel} />
      <div className="gi-dialog v2s-confirm-dialog">
        <h2 id="lp-trash-t" className="v2s-confirm-t">
          {title}
        </h2>
        <p className="v2s-confirm-d">
          {sizeWords(bytes)} that no canvas uses today. The Trash keeps them, with their edits,
          until you clear it out.
        </p>
        <div className="v2s-confirm-foot">
          <button
            type="button"
            className="btn"
            ref={cancelRef}
            data-testid="assets-trash-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="assets-trash-confirm"
            onClick={onConfirm}
          >
            Move to trash
          </button>
        </div>
      </div>
    </div>
  );
}
