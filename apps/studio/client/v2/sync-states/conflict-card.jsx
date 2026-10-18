// client/v2/sync-states/conflict-card.jsx — S9.24: "Two versions, side by side, nothing lost."
// (10 · co-sync-back's "2 versions" mark, co-conflict's card).
//
// The project kept the version that reached it first; THIS Mac's version of the sticky was kept aside
// in the same action (Version history · this sticky lists it). Until someone picks, the returning Mac
// shows its own version marked as conflicting (lead decision `v2-S9.24-hold-theirs-aside-mine`): the
// mark names both, and the card draws yours beside theirs with Keep yours · Keep <name>'s · Keep both.
// Each pick is ONE lane edit on the server (`POST /_api/sync/conflicts/resolve`) — one undo step.
//
// The card is a shell island over the viewport, not a canvas element: the canvas iframe is another
// origin, and the record lives on this Mac (`_state/conflicts/`, `GET /_api/sync/conflicts`).
//
// SyncStatesHost is the one mount (app.jsx): it derives the status kind the Share cluster shows
// (save-status.js), feeds the offline foot and the back-online toast, and reads the conflicts.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { syncPresentation } from '../../../sync/presentation.ts';
import { initialsOf } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { outboxPending, saveStatus } from '../shell/save-status.js';
import { useBackOnline } from './back-online.jsx';
import { useOfflineFoot } from './offline-foot.jsx';
import { conflictCard, conflictsFor } from './sync-states-model.js';

/** The shell opens the card from anywhere (the toast's Show, the mark, ⌘K-less row actions). */
export const OPEN_EVENT = 'maude:sync-conflicts-open';
export const openConflictCard = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
};

/** The registry actions the three buttons run (actions/defs/sync.ts) → the route's `choice`. */
export const PICK = Object.freeze({
  'sync.conflict.keep-mine': 'mine',
  'sync.conflict.keep-theirs': 'theirs',
  'sync.conflict.keep-both': 'both',
});

export async function readConflicts(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/_api/sync/conflicts', { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.conflicts) ? j.conflicts : null;
  } catch {
    return null;
  }
}

export async function resolveConflict({ slug, id }, actionId, fetchImpl = fetch) {
  const choice = PICK[actionId];
  if (!choice) return { ok: false, reason: 'unknown' };
  try {
    const r = await fetchImpl('/_api/sync/conflicts/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, id, choice }),
    });
    const j = await r.json().catch(() => null);
    return r.ok && j?.ok ? j : { ok: false, reason: j?.reason ?? 'unreachable', status: r.status };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** "2 versions" beside the sticky's canvas: this Mac's version is shown, marked, until the pick. */
export function ConflictMark({ count, me, onOpen }) {
  if (!count) return null;
  return (
    <button
      type="button"
      className="island sy-mark"
      data-testid="sync-conflict-mark"
      data-occludes=""
      onClick={onOpen}
    >
      <span className="sy-face" aria-hidden="true">
        {initialsOf(me || 'you')}
      </span>
      {count === 1 ? '2 versions' : `${count} stickies · 2 versions each`}
    </button>
  );
}

/** The card for one canvas's held conflicts (the first one drawn; a count says how many wait). */
export function ConflictCard({
  conflicts,
  me = '',
  busy = false,
  canEdit = true,
  onPick,
  onClose,
}) {
  const c = conflicts[0];
  if (!c) return null;
  const card = conflictCard(c, { me });
  const btn = (actionId, label, testid, extra = '') =>
    label ? (
      <button
        type="button"
        className={`btn btn--sm${extra}`}
        data-testid={testid}
        data-action={actionId}
        disabled={busy || !canEdit}
        onClick={() => onPick?.(c, actionId)}
      >
        {label}
      </button>
    ) : null;
  return (
    <section
      className="island sy-card"
      data-testid="sync-conflict-card"
      data-conflict={card.key}
      data-occludes=""
      aria-label={card.title}
    >
      <header className="sy-card-head">
        <strong>{card.title}</strong>
        <span>{card.sub}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm sy-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="sy-pair">
        <div className="sy-one" data-testid="sync-conflict-mine">
          <span className="sy-who">{card.mine.who}</span>
          <p className="sy-sticky">{card.mine.text}</p>
          {btn('sync.conflict.keep-mine', card.keepMine, 'sync-conflict-keep-mine')}
        </div>
        <span className="sy-vs">or</span>
        <div className="sy-one" data-testid="sync-conflict-theirs">
          <span className="sy-who">{card.theirs.who}</span>
          <p className="sy-sticky">{card.theirs.text}</p>
          {btn('sync.conflict.keep-theirs', card.keepTheirs, 'sync-conflict-keep-theirs')}
        </div>
      </div>
      {btn('sync.conflict.keep-both', card.keepBoth, 'sync-conflict-keep-both', ' sy-both')}
      <p className="sy-hint">
        {card.hint}
        {conflicts.length > 1 ? ` ${conflicts.length - 1} more after this one.` : ''}
      </p>
    </section>
  );
}

const subscribeOnline = (fn) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};
const onlineNow = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function SyncStatesHost() {
  const {
    shellCore: { activePath, cfg, cloudLinkedHub, gitUser, project, syncStatus, viewerMode },
  } = useShellStore();
  const online = useSyncExternalStore(subscribeOnline, onlineNow, () => true);
  const linked =
    !!cfg?.cloud || !!cloudLinkedHub?.credentialed || (!!syncStatus && syncStatus.linked !== false);
  const phase = useMemo(
    () =>
      syncPresentation(syncStatus, { project: cfg?.cloud?.projectName || project })?.phase ?? null,
    [syncStatus, cfg?.cloud?.projectName, project]
  );
  const [outbox, setOutbox] = useState(0);
  const [conflicts, setConflicts] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the hub status moving is the re-read cue
  useEffect(() => {
    if (!linked) {
      setOutbox(0);
      setConflicts([]);
      return undefined;
    }
    let live = true;
    const read = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/_api/outbox')
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => live && setOutbox(outboxPending(v)))
        .catch(() => {});
      readConflicts().then((list) => live && list && setConflicts(list));
    };
    read();
    const t = setInterval(read, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [linked, syncStatus?.state, syncStatus?.queuedOps]);

  const pending = (Number(syncStatus?.queuedOps) || 0) + outbox;
  const kind = saveStatus({ linked, online, phase, pending, writeFailed: null }).kind;
  useOfflineFoot({ kind, pending });
  useBackOnline({ kind, conflicts: conflicts.length, onShow: () => setOpen(true) });

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  const here = useMemo(
    () => conflictsFor(conflicts, activePath, cfg?.designRel),
    [conflicts, activePath, cfg?.designRel]
  );
  const onPick = useCallback(async (c, actionId) => {
    setBusy(true);
    const r = await resolveConflict(c, actionId);
    setBusy(false);
    if (!r.ok) {
      shellToast(
        r.reason === 'gone'
          ? 'Already settled — nothing changed.'
          : "Couldn't keep that version — try again."
      );
    }
    const list = await readConflicts();
    if (list) setConflicts(list);
  }, []);

  if (!here.length) return null;
  return open ? (
    <ConflictCard
      conflicts={here}
      me={gitUser}
      busy={busy}
      canEdit={!viewerMode}
      onPick={onPick}
      onClose={() => setOpen(false)}
    />
  ) : (
    <ConflictMark count={here.length} me={gitUser} onOpen={() => setOpen(true)} />
  );
}
