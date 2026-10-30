// client/v2/assets/missing-frame.jsx — S8.19c: the shell's half of Relink… on a picture that is not here.
//
//   <AssetAbsentBox>   the Inspector's box for a selected picture that is Waiting (quiet, "Have it here?
//                      Relink…") or Missing (Relink…). 12 Import and Assets, ia-missing / ia-missing-gone.
//   useRelinkSheet     the sheet: pick a copy → import it → run the edit op `asset.relink` → one toast
//                      with Undo. The canvas's Missing frame only ASKS (`asset-relink-request`); the
//                      shell chooses `from` from the studio's own asset-state answer (asset-state-lane.js).
//
// Can view / Can comment get neither the box button nor the sheet (the server refuses the edit op too).
// Words: what happened, what is safe, one verb (CONTRACT §3–§4).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { frameWords } from '../../../asset-placeholder.tsx';
import { notify } from '../../../notifications.tsx';
import { useLinkDialogFocus } from '../share/link-dialog.js';
import {
  assetAnswersVersion,
  assetItemForSrc,
  assetItemsFor,
  subscribeAssetAnswers,
} from './asset-state-lane.js';
import { relinkWithFile, undoRelink } from './relink.js';

/** The file name a rel ends in: `assets/c1658844.png` → `c1658844.png`. */
const nameOf = (rel) => rel.split('/').pop() || rel;

/** Re-render when the studio's answer for any canvas changes. */
function useAnswers() {
  useSyncExternalStore(subscribeAssetAnswers, assetAnswersVersion, assetAnswersVersion);
}

// The sheet's host (useRelinkSheet, mounted once in the app) tells the box whether this session may
// relink and how to open the sheet — the Inspector never learns a role.
let host = { canEdit: false, open: null };
const hostSubs = new Set();
let hostVersion = 0;
function setHost(next) {
  host = next;
  hostVersion += 1;
  for (const fn of hostSubs) fn();
}
const subscribeHost = (fn) => {
  hostSubs.add(fn);
  return () => hostSubs.delete(fn);
};
const hostSnapshot = () => hostVersion;

/** The Inspector's box for one selected element. Draws nothing unless its picture is waiting or missing. */
export function AssetAbsentBox({ el, canvas, onReplace }) {
  useAnswers();
  useSyncExternalStore(subscribeHost, hostSnapshot, hostSnapshot);
  const { canEdit, open: onRelink } = host;
  const item = assetItemForSrc(canvas, el?.attrs?.src ?? el?.src);
  const words = item ? frameWords(item) : null;
  if (!item || !words) return null;
  const missing = words.state === 'missing';
  return (
    <div className="asset-absent" data-testid="asset-absent-box" data-state={words.state}>
      <p className="asset-absent-t">
        <strong data-testid="asset-absent-word">{missing ? 'Missing' : words.line}</strong>
      </p>
      <p className="asset-absent-d">
        {missing
          ? 'No device has this file now. The rest of the design is safe.'
          : 'Not synced yet. Your design is safe — the picture fills in by itself.'}
      </p>
      {canEdit ? (
        <p className="asset-absent-a">
          {missing ? null : <span>Have it here?</span>}
          <button
            type="button"
            className={`btn btn--sm${missing ? ' btn--primary' : ''}`}
            data-testid="asset-absent-relink"
            onClick={() => onRelink?.(item.rel, canvas)}
          >
            Relink…
          </button>
          {/* ia-missing-gone: Relink… points at a copy, Replace… picks another picture for this frame (the asset picker) */}
          {missing && typeof onReplace === 'function' ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="asset-absent-replace"
              onClick={() => onReplace(el)}
            >
              Replace…
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** The sheet itself. Exported for tests; the app mounts it through `useRelinkSheet`. */
export function RelinkSheet({ from, canvas, onClose, relink = relinkWithFile, undo = undoRelink }) {
  const ref = useLinkDialogFocus(onClose);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const name = nameOf(from);
  const run = async (file) => {
    if (!file || busy) return;
    setBusy(true);
    setMessage('');
    const r = await relink({ canvas, from, file });
    if (r.ok) {
      notify({
        title: `Relinked ${name}`,
        description: 'Every place it was used points at the new file.',
        kind: 'success',
        action: {
          label: 'Undo',
          onClick: () => {
            void undo({ canvas, writeId: r.writeId }).then((ok) => {
              if (!ok)
                notify({ title: 'Undo skipped', description: 'Someone changed this since.' });
            });
          },
        },
      });
      onClose();
      return;
    }
    setBusy(false);
    setMessage(r.message);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim closes the sheet on a press outside it; the Cancel button is the keyboard path
    <div
      className="sh-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="sh-dialog asset-relink"
        role="dialog"
        aria-modal="true"
        aria-label={`Relink ${name}`}
        data-testid="asset-relink-sheet"
      >
        <div className="sh-dialog-hd">
          <span className="sh-dialog-title">Relink {name}</span>
        </div>
        <div className="sh-dialog-bd">
          <p>
            Pick a copy of it from this Mac. Everywhere {name} is used will point at the copy, as
            one undo step.
          </p>
          {message ? (
            <p className="asset-relink-err" role="alert" data-testid="asset-relink-error">
              {message}
            </p>
          ) : null}
          <input
            ref={input}
            type="file"
            hidden
            data-testid="asset-relink-input"
            accept="image/*,video/*,audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void run(f);
            }}
          />
        </div>
        <div className="sh-dialog-ft">
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="asset-relink-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="asset-relink-choose"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Relinking…' : 'Choose a file…'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The shell's one relink mount. `onRelink(rel, canvas)` opens the sheet — for a rel the studio's own
 * answer names for that canvas (anything else is dropped here, whoever asks); a person who cannot
 * edit opens nothing.
 */
export function useRelinkSheet({ canEdit }) {
  const [open, setOpen] = useState(null);
  const onRelink = (rel, canvas) => {
    if (!canEdit) return;
    const item = assetItemsFor(canvas).get(rel);
    if (!item || (item.state !== 'missing' && item.state !== 'waiting')) return;
    setOpen({ from: item.rel, canvas });
  };
  const live = useRef(onRelink);
  live.current = onRelink;
  useEffect(() => {
    setHost({ canEdit: !!canEdit, open: (rel, canvas) => live.current(rel, canvas) });
    return () => setHost({ canEdit: false, open: null });
  }, [canEdit]);
  const sheet = open ? (
    <RelinkSheet from={open.from} canvas={open.canvas} onClose={() => setOpen(null)} />
  ) : null;
  return { onRelink, sheet };
}
