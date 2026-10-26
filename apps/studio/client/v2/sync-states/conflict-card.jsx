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
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { Glyph } from '../share/glyphs.jsx';
import { Person } from '../share/person.jsx';
import { outboxPending, saveStatus } from '../shell/save-status.js';
import { useBackOnline } from './back-online.jsx';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { useOfflineFoot } from './offline-foot.jsx';
import { useOutboxWords } from './row-words.js';
import { conflictCard, conflictsFor, whenWords } from './sync-states-model.js';

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

/**
 * "2 versions" beside the sticky's canvas: this Mac's version is shown, marked, until the pick.
 * 10 co-sync-back `.co-needs`: two faces in their tones (yours, then the other person's) and the
 * words in the warn colour, ringed — a status the eye finds, not a grey chip.
 */
export function ConflictMark({ count, me, other = '', onOpen }) {
  if (!count) return null;
  return (
    <button
      type="button"
      className="island sy-mark"
      data-testid="sync-conflict-mark"
      data-occludes=""
      onClick={onOpen}
    >
      <span className="sy-faces" aria-hidden="true">
        <Person name={me || 'You'} you size="sm" />
        {other ? <Person name={other} size="sm" /> : null}
      </span>
      {count === 1 ? '2 versions' : `${count} stickies · 2 versions each`}
    </button>
  );
}

/** One of the two versions as a sticky: who it is, the yellow note, what keeps it. */
function Version({ side, who, testid, children }) {
  return (
    <div className="sy-one" data-testid={testid}>
      <span className="sy-who">
        <Person name={side.name} you={who === 'mine'} size="sm" />
        {side.who}
      </span>
      <p className="sy-sticky">{side.text}</p>
      {children}
    </div>
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
  // the board's card has no ×: Escape puts it away (the "2 versions" mark stays, one click brings it back)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!c) return null;
  const card = conflictCard(c, { me });
  const btn = (actionId, label, testid, extra = '', glyph = null) =>
    label ? (
      <button
        type="button"
        className={`btn btn--sm${extra}`}
        data-testid={testid}
        data-action={actionId}
        disabled={busy || !canEdit}
        onClick={() => onPick?.(c, actionId)}
      >
        {glyph ? <Glyph name={glyph} size={13} /> : null}
        {label}
      </button>
    ) : null;
  const more = conflicts.length > 1 ? `${conflicts.length - 1} more after this one.` : '';
  return (
    <section
      className="sy-stage"
      data-testid="sync-conflict-card"
      data-conflict={card.key}
      data-occludes=""
      aria-label={card.title}
    >
      <div className="sy-twin">
        {/* 10 co-twin-card: the title and the one line under it; the two versions sit OUTSIDE the island,
            as the stickies they are */}
        <header className="island sy-card">
          <strong>{card.title}</strong>
          <span>{card.sub}</span>
        </header>
        <div className="sy-pair">
          <Version side={card.mine} who="mine" testid="sync-conflict-mine">
            {btn('sync.conflict.keep-mine', card.keepMine, 'sync-conflict-keep-mine')}
          </Version>
          <span className="sy-vs">or</span>
          <Version side={card.theirs} who="theirs" testid="sync-conflict-theirs">
            {btn('sync.conflict.keep-theirs', card.keepTheirs, 'sync-conflict-keep-theirs')}
          </Version>
        </div>
        {btn(
          'sync.conflict.keep-both',
          card.keepBoth,
          'sync-conflict-keep-both',
          ' sy-both',
          'duplicate'
        )}
        {more ? <p className="sy-more">{more}</p> : null}
      </div>
      {/* 10 co-vh: Version history beside the pair, showing what you did not keep (Keep and Restore are
          the same pick here — the history is where the other version stays, whatever you choose) */}
      <aside
        className="island sy-vh"
        data-testid="sync-conflict-history"
        aria-label="Version history"
      >
        <p className="sy-vh-t">
          <Glyph name="history" size={14} />
          Version history<span>this sticky</span>
        </p>
        {[
          ['theirs', card.theirs, card.keepTheirs, 'sync.conflict.keep-theirs'],
          ['mine', card.mine, card.keepMine, 'sync.conflict.keep-mine'],
        ].map(([who, side, , actionId]) => (
          <span className="sy-vh-r" key={who} data-testid={`sync-conflict-history-${who}`}>
            <Person name={side.name} you={who === 'mine'} size="sm" />
            <span className="sy-vh-w">
              <span>
                <strong>{who === 'mine' ? 'You' : side.name || 'Other'}</strong>
                {side.at ? ` · ${whenWords(side.at)}` : ''}
              </span>
              <em>“{side.text}”</em>
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || !canEdit}
              onClick={() => onPick?.(c, actionId)}
            >
              Restore
            </button>
          </span>
        ))}
        <p className="sy-vh-f">
          {card.hint}
          <kbd className="kbd">{card.historyKeys}</kbd>
        </p>
      </aside>
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
  // the one outbox answer: the count feeds the status word + foot, `content.byDoc` / `.comments` the row
  // words and the "Queued" comment (round 11)
  const [outboxView, setOutboxView] = useState(null);
  const outbox = outboxPending(outboxView);
  const [conflicts, setConflicts] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the hub status moving, and this Mac coming back online (round 11: the rows say "sending" at once), are the re-read cues
  useEffect(() => {
    if (!linked) {
      setOutboxView(null);
      setConflicts([]);
      return undefined;
    }
    let live = true;
    const read = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/_api/outbox')
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => live && setOutboxView(v))
        .catch(() => {});
      readConflicts().then((list) => live && list && setConflicts(list));
    };
    read();
    const t = setInterval(read, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [linked, online, syncStatus?.state, syncStatus?.queuedOps]);

  const pending = (Number(syncStatus?.queuedOps) || 0) + outbox;
  const kind = saveStatus({ linked, online, phase, pending, writeFailed: null }).kind;
  useOfflineFoot({ kind, pending });
  // round 11 (co-sync-offline / co-sync-back): "not sent" / "sending" on the rows, "Queued" on a comment
  const indexSnapshot = useCanvasIndex({ stamp: kind });
  useOutboxWords({ kind, view: outboxView, canvases: indexSnapshot?.canvases });
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
    <ConflictMark
      count={here.length}
      me={gitUser}
      other={conflictCard(here[0], { me: gitUser }).theirs.name}
      onOpen={() => setOpen(true)}
    />
  );
}
