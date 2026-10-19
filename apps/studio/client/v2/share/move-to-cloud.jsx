// client/v2/share/move-to-cloud.jsx — S9.20: a local project's Share (02 ob-local-share ·
// ob-local-moved; 10 co-local-cloud).
//
//   Move “Portfolio 2026” to the cloud?
//   Sharing needs the cloud. People you invite can open it there, and so can your other Macs.
//   It stays on this Mac too.                               [Cancel] [Move to cloud]
//   Only need a file? Menu › Export… ⇧⌘E
//
// The ONE place a local project is offered the cloud (CONTRACT §6). Move to cloud is
// `POST /_api/cloud/move` (S6-S9 §5.5) sent by THIS window's own fetch: the route answers only a
// same-origin browser request (decision v2-lead-cloud-move-window-only), so the AI cannot start it
// (it bills the person's account and uploads the project). The sheet then follows the move
// (`GET /_api/cloud/move`) and opens on Invite once the project is linked.

import { useState } from 'react';

import { moveWords } from './share-model.js';

export function MoveToCloud({ project, api, onCancel, onMoving }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const name = project || 'this project';
  const move = async () => {
    setBusy(true);
    setError(null);
    const r = await api.moveToCloud();
    setBusy(false);
    const words = moveWords(r.status, r.body);
    if (words) setError(words);
    else onMoving?.(r.body);
  };
  return (
    <div className="v2sh-move" data-testid="share-move">
      <p className="v2sh-move-t">{`Move “${name}” to the cloud?`}</p>
      <p className="v2sh-hint" data-testid="share-local-note">
        Sharing needs the cloud. People you invite can open it there, and so can your other Macs. It
        stays on this Mac too.
      </p>
      {error && (
        <p className="v2sh-err" role="alert" data-testid="share-move-error">
          {error}
        </p>
      )}
      <div className="v2sh-confirm-b">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="share-move-confirm"
          disabled={busy}
          onClick={move}
        >
          {busy ? 'Moving…' : 'Move to cloud'}
        </button>
      </div>
      <p className="v2sh-move-foot">
        Only need a file? Menu › Export… <kbd className="kbd">⇧⌘E</kbd>
      </p>
    </div>
  );
}

/** The words while a move runs, from `GET /_api/cloud/move` (null = nothing to say). */
export function movingWords(state) {
  if (state === 'ready') return 'Moved to the cloud — your canvases are going up now.';
  if (state === 'provisioning' || state === 'linking')
    return 'Setting up the cloud project… You can invite people as soon as it is there.';
  if (state === 'uploading') return 'Moved to the cloud — your canvases are going up now.';
  return null;
}
