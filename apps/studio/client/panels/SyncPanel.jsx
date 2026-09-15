// feature-sync-progress-modal — the per-file Sync panel (right dock).
//
// Pure surfacing of the `sync:status` payload: the DDR-102 per-document
// `items` list plus the DDR-217 asset lane's live progress. No new sync
// semantics and NO new sync words — the header sentence comes from
// `syncPresentation` (the one rule the status-bar chip and the cloud rail
// already share), and rows map DocSyncState onto that same vocabulary:
// pending → syncing, connected → synced, auth-rejected → refused.
//
// DDR-054 — slugs are local canvas identifiers and asset keys are local
// paths, but everything renders through safeName anyway: this payload is
// read back off disk (`_sync.json`), and a bounded text-only row is free.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { safeDetail, safeName, syncPresentation } from '../../sync/presentation.ts';
import { TeamProjectsDialog } from './TeamProjects.jsx';
import SourceConflictPanel from './SourceConflictPanel.jsx';
import { isNativeApp } from '../github.js';

/**
 * How long Resync stays disabled after a cycle finishes.
 *
 * A resync is `syncControl.restart()`: it tears every provider down and
 * re-authenticates EVERY document — 76 WS auths on the project this was built
 * for, since auth fires once per document. The valid-token bucket is 600/min
 * per label (DDR-102), so roughly eight presses inside a minute would pin the
 * very bucket the incident behind this feature was about. Ten seconds caps an
 * impatient person at six presses a minute and keeps them well under it. The
 * hub's own 429 remains the real backstop — this is politeness, not security.
 */
const RESYNC_COOLDOWN_MS = 10_000;

/** DocSyncState → the presentation vocabulary (never invent a new word). */
const STATE_WORD = {
  pending: 'syncing',
  connected: 'synced',
  'auth-rejected': 'refused',
};

/** AuthFailureClass → plain words for the refused-row detail. */
const REASON_WORD = {
  'rate-limit': 'rate limited',
  'not-authorized': 'not authorized',
  'invalid-token': 'sign-in expired',
  generic: 'refused by the hub',
};

function Row({ item }) {
  const name = safeName(item.slug, '(unnamed)');
  const state = STATE_WORD[item.state] || 'syncing';
  const reason = item.state === 'auth-rejected' ? REASON_WORD[item.reason] || REASON_WORD.generic : null;
  return (
    <li className={'sp-row is-' + item.state} data-testid={'sync-row-' + item.slug}>
      <span className="sp-row-dot" aria-hidden="true" />
      <span className="sp-row-name" title={name}>
        {name}
      </span>
      <span className="sp-row-state">{reason ? `refused — ${reason}` : state}</span>
    </li>
  );
}

/** Which declared canvas group a slug belongs to (slugs collapse '/' → '-'). */
function groupOf(slug, groupPaths) {
  for (const p of groupPaths) {
    const g = p.replace(/\//g, '-');
    if (slug === g || slug.startsWith(g + '-')) return p;
  }
  return null;
}

// FAIL CLOSED, like presentation.ts `readCounts`: this payload is JSON.parse
// of `_sync.json` with no schema, so a partial write / older producer must
// degrade to "nothing to show", never crash the render or print NaN.

const isCount = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** The per-doc rows, or [] when the shape can't be trusted. */
function readItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((i) => i && typeof i.slug === 'string' && typeof i.state === 'string');
}

/** The asset lane, or null when any count is unreadable. */
function readAssets(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.total, raw.done, raw.pushed, raw.skipped, raw.failedCount].every(isCount)) return null;
  const failures = Array.isArray(raw.failures)
    ? raw.failures.filter((f) => f && typeof f.key === 'string')
    : [];
  return { ...raw, failures };
}

/** The file plane (feature-sync-file-plane), or null when unreadable/absent —
 *  absent is the norm: the payload carries `files` only once a flag-on pull
 *  has run this boot. */
function readFiles(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.synced, raw.pulled, raw.conflicts].every(isCount)) return null;
  return raw;
}

/**
 * The seed progress model, or null when absent/untrustworthy.
 *
 * Absent is the norm on an older dev-server, and this panel must render
 * exactly as it did before when it is — every field here is additive.
 */
function readProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![raw.tracked, raw.delivered, raw.remaining].every(isCount)) return null;
  if (typeof raw.phase !== 'string') return null;
  const blocked = Array.isArray(raw.blocked)
    ? raw.blocked.filter((b) => b && typeof b.class === 'string' && isCount(b.count))
    : [];
  return { ...raw, blocked };
}

/** One sentence per phase, in the user's terms — never the machine's. */
const PHASE_TEXT = {
  scanning: 'Looking through the project…',
  seeding: null, // the counts say it better than a sentence would
  paused: 'Paused — nothing is lost; this resumes by itself.',
  blocked: 'Nothing is moving on its own — the files below need a decision.',
  converged: 'Everything is up to date.',
};

/** What each wall means, and what a person can do about it. */
const BLOCKED_TEXT = {
  'too-large': 'too big for this workspace',
  quota: "this hour's upload allowance is used up",
  unreachable: 'the workspace could not be reached',
  refused: 'the workspace would not take them',
};

/** Consent-class notices (feature-before-first-external-users Task 1), or []
 *  when the shape can't be trusted. Absent is the norm — the payload carries
 *  `notices` only when a boot raised one (shared-doc ON, TSX bodies). */
function readNotices(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string');
}

/** DeliveryState → plain words for the doručenka rows (file-ledger.ts owns the
 *  union; unknown states render verbatim so a NEWER producer stays readable). */
const DELIVERY_WORD = {
  conflict: 'conflict — older copy in Trash below',
  stuck: 'stuck',
  'referenced-but-unoffered': 'referenced, never received',
  'local-only': 'only on this machine',
  pushing: 'uploading…',
  'on-hub': 'on the workspace',
  durable: 'backed up',
  'at-peer': 'reached a teammate',
  'ui-healed': 'healed',
  everywhere: 'everywhere',
};

/** States where a person has to look — always-visible rows; the rest folds. */
const DELIVERY_ATTENTION = new Set(['conflict', 'stuck', 'referenced-but-unoffered', 'local-only']);

/** The per-file doručenka map split into attention/fine [rel, state] lists,
 *  fail-closed like every other reader here. */
function readDelivery(raw) {
  const attention = [];
  const fine = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [rel, state] of Object.entries(raw)) {
      if (typeof rel !== 'string' || typeof state !== 'string') continue;
      (DELIVERY_ATTENTION.has(state) ? attention : fine).push([rel, state]);
    }
    attention.sort((a, b) => a[0].localeCompare(b[0]));
    fine.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return { attention, fine };
}

/** TrashEntry.reason → plain words. */
const TRASH_REASON_WORD = {
  conflict: 'conflict loser',
  removed: 'removed by sync',
  moved: 'moved elsewhere',
  deleted: 'deleted',
  migration: 'migration backup',
  unknown: 'parked',
};

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtAge(at) {
  if (!Number.isFinite(at) || at <= 0) return 'unknown age';
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} d ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

/** Display host of a hub url ('workspace' when unparseable). */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'workspace';
  }
}

/** safeDetail's sanitation with a paragraph-sized cap — a consent notice is a
 *  full explanation by design and `MAX_DETAIL_LEN`'s 160 chars would cut it
 *  mid-sentence. Still bounded: the payload is read back off `_sync.json`. */
function safeNoticeText(raw) {
  const s = String(raw ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

/**
 * Machine-local dismiss ack, keyed per (hub url) → list of dismissed notice
 * ids — the `mdcc-whatsnew-seen` convention. Per-hub on purpose: dismissing
 * "shared-doc is ON for hub A" must not silence the same notice when the
 * project is re-linked to hub B; what leaves this machine changed again.
 */
const NOTICE_ACK_KEY = 'maude-sync-notice-ack';
function readNoticeAcks(url) {
  try {
    const all = JSON.parse(localStorage.getItem(NOTICE_ACK_KEY) || '{}');
    const ids = all[url];
    return Array.isArray(ids) ? ids.filter((i) => typeof i === 'string') : [];
  } catch {
    return [];
  }
}
function writeNoticeAck(url, id) {
  try {
    const all = JSON.parse(localStorage.getItem(NOTICE_ACK_KEY) || '{}');
    const ids = Array.isArray(all[url]) ? all[url] : [];
    if (!ids.includes(id)) ids.push(id);
    all[url] = ids;
    localStorage.setItem(NOTICE_ACK_KEY, JSON.stringify(all));
  } catch {
    /* private mode etc. — the notice simply reappears next boot */
  }
}

export default function SyncPanel({
  status, // the live `sync:status` payload (never null while mounted)
  project, // display name for the header sentence (hub-supplied → safeName'd)
  groupPaths = [], // declared canvas-group paths, for row grouping
  // Present exactly when the hub runs this studio (`/_config`'s `cloud` block);
  // null on the desktop. Decides whether Resync is offered at all — see below.
  cloud = null,
  resizing,
  onClose,
}) {
  const p = syncPresentation(status, { project });
  // Plan T20/T22 — a refused workspace on the desktop is usually a sign-in that
  // ran out. Signing in again re-mints the credential and reopens the same copy.
  const [signInAgain, setSignInAgain] = useState(false);
  // Plan T19 — "Download everything for offline".
  const [offline, setOffline] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);
  async function prepareOffline() {
    setOfflineBusy(true);
    setOffline('');
    try {
      const r = await fetch('/_api/sync/offline', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) setOffline(j.error || 'Could not download the project right now.');
      else if (j.complete) setOffline(`Everything is on this device${j.pulled ? ` — ${j.pulled} file${j.pulled === 1 ? '' : 's'} came down` : ''}.`);
      else setOffline(`${j.pulled} file${j.pulled === 1 ? '' : 's'} came down; ${j.failed} still to come — Maude keeps trying.`);
    } catch {
      setOffline('Maude isn’t reachable right now.');
    } finally {
      setOfflineBusy(false);
    }
  }
  // Plan T28 — the conflict being resolved (a canvas slug), or null.
  const [resolving, setResolving] = useState(null);
  // Plan T16 — the person's decision on an unfinished AI edit.
  const [aiBusy, setAiBusy] = useState('');
  const [aiNote, setAiNote] = useState('');
  const aiHeld = status?.aiAction?.state === 'held' ? status.aiAction : null;
  async function resolveAi(choice) {
    setAiBusy(choice);
    setAiNote('');
    try {
      const r = await fetch('/_api/project/ai-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) setAiNote(j.error || (j.code ? `The project refused it (${j.code}).` : 'That did not work.'));
    } catch {
      setAiNote('Maude isn’t reachable right now.');
    } finally {
      setAiBusy('');
    }
  }
  const [resyncing, setResyncing] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [note, setNote] = useState('');
  const timers = useRef([]);

  // Timers outlive an unmount otherwise — closing the panel mid-cooldown would
  // set state on a gone component.
  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    },
    []
  );

  const resync = useCallback(async () => {
    if (resyncing || cooling) return;
    setResyncing(true);
    setNote('');
    let res = null;
    let json = {};
    try {
      res = await fetch('/_api/sync/resync', { method: 'POST' });
      json = await res.json().catch(() => ({}));
    } catch {
      /* the server went away — say so below rather than throwing into render */
    }
    setResyncing(false);
    if (!res) setNote('Maude could not reach the sync service.');
    else if (res.status === 409) setNote('Already restarting — give it a moment.');
    else if (!res.ok || !json.ok) setNote(json.detail || 'Resync could not start.');
    // A restart that declined is not an error, but it IS the only thing worth
    // saying — the panel's own header keeps reporting the live state.
    else if (json.sync && !json.sync.syncing) setNote(json.sync.detail || '');
    setCooling(true);
    timers.current.push(setTimeout(() => setCooling(false), RESYNC_COOLDOWN_MS));
  }, [resyncing, cooling]);

  const cancelAssets = useCallback(async () => {
    try {
      await fetch('/_api/sync/cancel-assets', { method: 'POST' });
    } catch {
      /* the sweep ends with the server either way */
    }
  }, []);

  const items = readItems(status?.items);
  const truncated = isCount(status?.itemsTruncated) ? status.itemsTruncated : 0;
  const assets = readAssets(status?.assets);
  const assetFailures = assets?.failures || [];
  const files = readFiles(status?.files);

  const delivery = useMemo(() => readDelivery(status?.files?.delivery), [status?.files?.delivery]);
  const progress = useMemo(() => readProgress(status?.files?.progress), [status?.files?.progress]);

  // Sync settings (Task 2) — fetched once on mount; `settings` stays null when
  // no hub is linked, which is also the render gate for the whole section.
  const [settings, setSettings] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsNote, setSettingsNote] = useState('');
  useEffect(() => {
    let gone = false;
    fetch('/_api/sync/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!gone && j && typeof j === 'object') setSettings(j.settings ?? null);
      })
      .catch(() => {
        /* no server / old server — the section simply doesn't render */
      });
    return () => {
      gone = true;
    };
  }, []);
  const changeSetting = useCallback(async (patch) => {
    setSettingsBusy(true);
    setSettingsNote('');
    let json = null;
    try {
      const res = await fetch('/_api/sync/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      json = await res.json().catch(() => null);
    } catch {
      /* said below */
    }
    setSettingsBusy(false);
    if (!json || json.ok !== true) {
      setSettingsNote(safeDetail(json?.detail, 'The setting could not be saved.'));
      return;
    }
    setSettings(json.settings);
    // Saved is a fact; whether it took effect NOW depends on the supervisor —
    // say which of the two happened rather than letting "saved" imply "live".
    setSettingsNote(json.applied ? 'Saved — sync is restarting with the new setting.' : 'Saved — applies the next time sync restarts.');
  }, []);

  // Ownership (Task 2) — repo-owned vs hub-owned, previously CLI-only against
  // DDR-177's own posture. Mutations go through an explicit two-step confirm:
  // the confirm row IS the asking B11 found missing in non-TTY settleOwnership.
  const [ownership, setOwnership] = useState(null);
  const [ownershipConfirm, setOwnershipConfirm] = useState(null); // 'adopt' | 'detach' | null
  const [ownershipBusy, setOwnershipBusy] = useState(false);
  const [ownershipNote, setOwnershipNote] = useState('');
  useEffect(() => {
    let gone = false;
    fetch('/_api/sync/ownership')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!gone && j && typeof j.mode === 'string') setOwnership(j);
      })
      .catch(() => {
        /* old server — the section doesn't render */
      });
    return () => {
      gone = true;
    };
  }, []);
  const changeOwnership = useCallback(async (action) => {
    setOwnershipBusy(true);
    setOwnershipNote('');
    let json = null;
    try {
      const res = await fetch('/_api/sync/ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      json = await res.json().catch(() => null);
    } catch {
      /* said below */
    }
    setOwnershipBusy(false);
    setOwnershipConfirm(null);
    if (!json || json.ok !== true) {
      setOwnershipNote(safeDetail(json?.detail, 'The ownership change did not complete.'));
      return;
    }
    setOwnershipNote(
      action === 'adopt'
        ? `Done — .design/ is workspace-owned now. ${json.untracked ?? 0} file(s) untracked (still on disk, staged as deletions — commit when ready).`
        : 'Done — unlinked and repo-owned again. Commit .design/ when you are ready.'
    );
    // Re-read rather than guess — the server is the source for mode.
    try {
      const r = await fetch('/_api/sync/ownership');
      const j = r.ok ? await r.json() : null;
      if (j && typeof j.mode === 'string') setOwnership(j);
    } catch {
      /* keep the stale mode; the note already said what happened */
    }
  }, []);

  // Trash (Task 3, F-6) — quarantine-not-delete is only safe if a person can
  // FIND the quarantine. Until this section, the product's copy pointed at a
  // hidden gitignored folder.
  const [trash, setTrash] = useState(null); // { entries, total, bytes } | null
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashNote, setTrashNote] = useState('');
  const [pruneConfirm, setPruneConfirm] = useState(false);
  const refreshTrash = useCallback(async () => {
    try {
      const r = await fetch('/_api/sync/trash');
      const j = r.ok ? await r.json() : null;
      if (j && Array.isArray(j.entries)) setTrash(j);
    } catch {
      /* old server — the section doesn't render */
    }
  }, []);
  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);
  const trashAction = useCallback(
    async (body, doneNote) => {
      setTrashBusy(true);
      setTrashNote('');
      let json = null;
      try {
        const res = await fetch('/_api/sync/trash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        json = await res.json().catch(() => null);
      } catch {
        /* said below */
      }
      setTrashBusy(false);
      setPruneConfirm(false);
      if (!json || json.ok !== true) {
        setTrashNote(safeDetail(json?.detail, 'That did not complete.'));
      } else {
        setTrashNote(doneNote(json));
      }
      refreshTrash();
    },
    [refreshTrash]
  );

  // Consent notices minus this machine's dismissals. `ackTick` only forces the
  // re-read after a dismiss — the acks themselves live in localStorage.
  const hubUrl = typeof status?.url === 'string' ? status.url : '';
  const [ackTick, setAckTick] = useState(0);
  const notices = useMemo(() => {
    const acked = readNoticeAcks(hubUrl);
    return readNotices(status?.notices).filter((n) => !acked.includes(n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ackTick invalidates the localStorage read
  }, [status?.notices, hubUrl, ackTick]);
  const dismissNotice = useCallback(
    (id) => {
      writeNoticeAck(hubUrl, id);
      setAckTick((t) => t + 1);
    },
    [hubUrl]
  );

  const { attention, byGroup } = useMemo(() => {
    const attention = items.filter((i) => i.state === 'auth-rejected');
    const rest = items.filter((i) => i.state !== 'auth-rejected');
    const byGroup = new Map();
    for (const item of rest) {
      const g = groupOf(item.slug, groupPaths) ?? 'canvases';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(item);
    }
    return { attention, byGroup };
  }, [items, groupPaths]);

  // Same fail-closed rule for the header chip — readCounts-shaped, so the
  // chip can never say "NaN synced" while the note below fails closed.
  const rawDocs = status?.docs;
  const docs =
    rawDocs && [rawDocs.synced, rawDocs.pending, rawDocs.rejected].every(isCount)
      ? rawDocs
      : null;
  const counts =
    docs &&
    [
      `${docs.synced} synced`,
      docs.pending > 0 ? `${docs.pending} syncing` : null,
      docs.rejected > 0 ? `${docs.rejected} refused` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <aside
      className={'st-rpanel sp-panel' + (resizing ? ' is-resizing' : '')}
      aria-label="Sync"
      data-testid="sync-panel"
    >
      <div className="gp-head">
        <div className="gp-panel-hd">
          <span className="gp-panel-title">Sync</span>
          {counts && <span className="gp-count">{counts}</span>}
          <span className="gp-spacer" />
          {/* Resync re-runs the WHOLE sync — every canvas and every asset — so
              it lives in the header, not inside the assets section. It is
              `syncControl.restart()`, the same cycle Connect performs.

              NOT IN THE CLOUD. On a cell the sync runtime belongs to the process
              serving the project to EVERYONE, so restarting it is an operator
              action, not a member's — the hub refuses the route there on
              purpose (v0.60.2). Rendering the button anyway meant a cloud member
              could press a control that cannot work by design and be handed an
              error for it; the honest surface is its absence. Discovery is
              continuous now, so nobody needs this button to pick up a new
              canvas — it is a repair tool, and repairing a cell is the hub's
              job. See `.ai/logs/rca/issue-cloud-assets-open-findings.md` §5. */}
          {!cloud && status?.files && (
            <button
              type="button"
              className="sp-resync"
              data-testid="sync-offline"
              onClick={prepareOffline}
              disabled={offlineBusy}
              title="Download every file of the project to this device now, to work offline"
            >
              {offlineBusy ? 'Downloading…' : 'Download all'}
            </button>
          )}
          {!cloud && (
            <button
              type="button"
              className="sp-resync"
              data-testid="sync-resync"
              onClick={resync}
              disabled={resyncing || cooling}
              title="Re-check every canvas and asset against the workspace"
            >
              {resyncing ? 'Resyncing…' : 'Resync'}
            </button>
          )}
          <button type="button" className="gp-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {note && (
          <div className="sp-resync-note" role="status" aria-live="polite">
            {safeDetail(note, '')}
          </div>
        )}
        {offline && (
          <div className="sp-resync-note" role="status" aria-live="polite" data-testid="sync-offline-note">
            {safeDetail(offline, '')}
          </div>
        )}
        {/* The one-rule sentence, live — same aria pattern as the rail note:
            a polite announcement when the phase changes, never a focus steal. */}
        {p && (
          <div className="sp-note" role="status" aria-live="polite">
            <span className={'sp-note-dot is-' + p.phase} aria-hidden="true" />
            <span>
              {p.title}
              {p.next ? ` ${p.next}` : ''}
            </span>
            {p.phase === 'refused' && !cloud && isNativeApp() && (
              <button
                type="button"
                className="btn btn--sm"
                data-testid="sync-signin-again"
                onClick={() => setSignInAgain(true)}
              >
                Sign in again
              </button>
            )}
          </div>
        )}
        {resolving && <SourceConflictPanel slug={resolving} onClose={() => setResolving(null)} />}
        {signInAgain && (
          <TeamProjectsDialog
            title="Sign in again"
            initialServer={typeof status?.url === 'string' ? status.url : ''}
            onClose={() => setSignInAgain(false)}
          />
        )}
      </div>

      <div className="sp-body">
        {/* Consent-class notices come FIRST: they say what leaves this machine
            (shared-doc buffer, TSX bodies) and used to live only in a
            console.warn a desktop user never sees. Dismiss is per (notice,
            hub) on this machine — a new hub resurfaces them by design. */}
        {aiHeld && (
          <section aria-label="Unfinished AI edit" className="sp-notice sp-ai-held" data-testid="sync-ai-held">
            <p className="sp-notice-text">
              <b>An unfinished AI edit is kept on this device.</b>{' '}
              {safeDetail(aiHeld.label, 'AI edit')} changed{' '}
              {Array.isArray(aiHeld.canvases) ? aiHeld.canvases.length : 0} canvas
              {Array.isArray(aiHeld.canvases) && aiHeld.canvases.length === 1 ? '' : 'es'} and did not finish,
              so nothing of it is shared yet. Publish it as it stands, or discard it — the
              discarded bytes stay in recovery.
            </p>
            <div className="sp-ai-actions">
              <button type="button" className="btn btn--sm btn--primary" disabled={!!aiBusy} onClick={() => resolveAi('publish')} data-testid="sync-ai-publish">
                {aiBusy === 'publish' ? 'Publishing…' : 'Publish'}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" disabled={!!aiBusy} onClick={() => resolveAi('discard')} data-testid="sync-ai-discard">
                {aiBusy === 'discard' ? 'Discarding…' : 'Discard'}
              </button>
            </div>
            {aiNote && <p className="sp-notice-text" role="alert">{safeDetail(aiNote, '')}</p>}
          </section>
        )}
        {notices.length > 0 && (
          <section aria-label="Notices" data-testid="sync-notices">
            {notices.map((n) => (
              <div key={n.id} className="sp-notice" data-testid={`sync-notice-${n.id}`}>
                <p className="sp-notice-text">{safeNoticeText(n.text)}</p>
                {n.id.startsWith('source-conflict-') && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    data-testid={`sync-resolve-${n.id.slice('source-conflict-'.length)}`}
                    onClick={() => setResolving(n.id.slice('source-conflict-'.length))}
                  >
                    Resolve…
                  </button>
                )}
                <button
                  type="button"
                  className="sp-notice-dismiss"
                  data-testid={`sync-notice-dismiss-${n.id}`}
                  onClick={() => dismissNotice(n.id)}
                  title="Got it — don't show this again for this hub on this machine"
                >
                  Got it
                </button>
              </div>
            ))}
          </section>
        )}

        {items.length === 0 && !assets && (
          <div className="gp-empty">
            <p>No per-file detail yet — it arrives with the first sync report after this panel shipped. If this persists, restart Maude.</p>
          </div>
        )}

        {attention.length > 0 && (
          <section aria-label="Needs attention">
            <div className="gp-sect-label sp-sect-attention">Needs attention</div>
            <ul className="sp-list">
              {attention.map((item) => (
                <Row key={item.slug} item={item} />
              ))}
            </ul>
          </section>
        )}

        {[...byGroup.entries()].map(([group, rows]) => (
          <section key={group} aria-label={group}>
            <div className="gp-sect-label">
              {group} <span className="gp-group-count">{rows.length}</span>
            </div>
            <ul className="sp-list">
              {rows.map((item) => (
                <Row key={item.slug} item={item} />
              ))}
            </ul>
          </section>
        ))}

        {truncated > 0 && (
          <div className="sp-truncated">
            +{truncated} more synced canvas{truncated === 1 ? '' : 'es'} not listed.
          </div>
        )}

        {assets && (
          <section aria-label="Assets" data-testid="sync-assets">
            <div className="gp-sect-label">
              assets <span className="gp-group-count">{assets.total}</span>
            </div>
            <div className="sp-assets-line">
              {assets.finished
                ? `${assets.pushed} pushed · ${assets.skipped} already there` +
                  (assets.failedCount > 0 ? ` · ${assets.failedCount} failed` : '')
                : `Pushing assets — ${assets.done} of ${assets.total}…`}
              {/* Cancel is scoped to the SWEEP — interrupting an upload is a
                  real gesture; interrupting a reconnect mid-handshake is not.
                  Safe to press: uploads are idempotent and the hub writes
                  temp-then-rename, so nothing half-written can survive. */}
              {!assets.finished && (
                <button
                  type="button"
                  className="sp-assets-cancel"
                  data-testid="sync-assets-cancel"
                  onClick={cancelAssets}
                >
                  Cancel
                </button>
              )}
            </div>
            {!assets.finished && assets.active && (
              <div className="sp-assets-active" title={safeName(assets.active, '')}>
                ↑ {safeName(assets.active, '')}
              </div>
            )}
            {assets.failedCount > 0 && (
              <ul className="sp-list">
                {assetFailures.map((f) => (
                  <li className="sp-row is-auth-rejected" key={f.key}>
                    <span className="sp-row-dot" aria-hidden="true" />
                    <span className="sp-row-name" title={safeName(f.key, '(unnamed)')}>
                      {safeName(f.key, '(unnamed)')}
                    </span>
                    <span className="sp-row-state">{safeName(f.reason, 'failed')}</span>
                  </li>
                ))}
                {assets.failedCount > assetFailures.length && (
                  <li className="sp-truncated">
                    +{assets.failedCount - assetFailures.length} more failed. All retry on the next
                    launch.
                  </li>
                )}
              </ul>
            )}
            {assets.failedCount > 0 && assets.finished && (
              <div className="sp-assets-retry">Failed assets retry on the next launch.</div>
            )}
          </section>
        )}

        {files && (
          <section aria-label="Project files" data-testid="sync-files">
            <div className="gp-sect-label">
              project files{' '}
              <span className="gp-group-count">{progress ? progress.tracked : files.synced}</span>
            </div>
            {progress ? (
              <>
                <div className="sp-progress-track" data-testid="sync-files-progress">
                  <div
                    className="sp-progress-fill"
                    style={{
                      width: `${
                        progress.tracked > 0
                          ? Math.min(100, Math.round((progress.delivered / progress.tracked) * 100))
                          : 100
                      }%`,
                    }}
                  />
                </div>
                <div className="sp-assets-line" data-testid="sync-files-remaining">
                  {`${progress.delivered} of ${progress.tracked} delivered`}
                  {progress.remaining > 0 ? ` · ${progress.remaining} waiting` : ''}
                </div>
                {PHASE_TEXT[progress.phase] && (
                  <div className="sp-assets-line" data-testid="sync-files-phase">
                    {PHASE_TEXT[progress.phase]}
                  </div>
                )}
                {progress.passCapped && progress.remaining > 0 && (
                  <div className="sp-assets-line">
                    More is on the way — the last pass reached its limit and picks up where it
                    left off.
                  </div>
                )}
                {progress.blocked.map((b) => (
                  <div
                    key={b.class}
                    className="sp-assets-retry"
                    data-testid={`sync-blocked-${b.class}`}
                  >
                    {b.count} file{b.count === 1 ? '' : 's'} —{' '}
                    {BLOCKED_TEXT[b.class] ?? 'the workspace would not take them'}.
                  </div>
                ))}
                {/*
                  THE RAW COUNTERS STAY. A panel derived from the same source it
                  displays cannot be cross-checked, and DDR-214's whole lesson is
                  that a status surface has to be falsifiable — so the numbers the
                  passes actually reported remain here to disagree with.
                */}
                <div className="sp-assets-line sp-raw-counters">
                  {`raw: ${files.synced} synced`}
                  {files.pushed ? ` · ${files.pushed} pushed` : ''}
                  {files.pulled > 0 ? ` · ${files.pulled} pulled` : ''}
                </div>
              </>
            ) : (
              <div className="sp-assets-line">
                {`${files.synced} synced` + (files.pulled > 0 ? ` · ${files.pulled} pulled` : '')}
              </div>
            )}
            {files.conflicts > 0 && (
              <div className="sp-assets-retry" data-testid="sync-files-conflicts">
                {files.conflicts} conflict{files.conflicts === 1 ? '' : 's'} — the older copies are
                kept in Trash, below.
              </div>
            )}
            {/*
              A PAUSE IS NOT A FAILURE, and it gets its own words. The
              workspace asked us to slow down; nothing is wrong, nothing is
              lost, and the only correct action is to wait — which is exactly
              what a person cannot infer from a count of failures (issue #109).
              It comes FIRST because it explains the failure line below it.
            */}
            {files.rateLimited && (
              <div className="sp-assets-retry" data-testid="sync-files-rate-limited">
                <strong>syncing paused for a moment.</strong> The workspace asked this machine to
                slow down.{' '}
                {files.rateLimited.waiting > 0
                  ? `${files.rateLimited.waiting} file${files.rateLimited.waiting === 1 ? '' : 's'} still on the way — nothing is lost, they arrive when the pause lifts.`
                  : 'It resumes by itself.'}
              </div>
            )}
            {/*
              AND A FAILURE IS NOT A SYNC. This had no field at all, so a pass
              that refused every file rendered as "N synced" and a person saw
              broken images with the cause only in a terminal they never open.
            */}
            {files.failed > 0 && !files.rateLimited && (
              <div className="sp-assets-retry" data-testid="sync-files-failed">
                {files.failed} file{files.failed === 1 ? '' : 's'} did not come through on the last
                check — sync retries them by itself. The list is below.
              </div>
            )}
            {/*
              A HELD BREAKER, said out loud. These used to exist only as a
              console.warn, which on a machine whose user never opens a
              terminal is the same as not existing — while the release leaned
              on them as its reason for shipping deletion without a soak.
            */}
            {Array.isArray(files.held) &&
              files.held.map((h) => (
                <div key={h.kind} className="sp-assets-retry" data-testid={`sync-held-${h.kind}`}>
                  <strong>sync paused — nothing was removed.</strong> {h.detail}
                  {h.paths?.length > 0 && (
                    <details className="sp-held-paths">
                      <summary>
                        {h.count} file{h.count === 1 ? '' : 's'}
                      </summary>
                      <ul>
                        {h.paths.slice(0, 50).map((rel) => (
                          <li key={rel}>{rel}</li>
                        ))}
                        {h.paths.length > 50 && <li>…and {h.paths.length - 50} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            {/* THE DORUČENKA, per file (DDR-226 §7). The counts above say how
                many are fine; they cannot point at the one that is not — which
                is the question three days of dogfood kept asking. Rows needing
                a person come first and are always visible; the delivered rest
                stays behind a fold so a healthy project reads as one line. */}
            {delivery.attention.length > 0 && (
              <ul className="sp-list" data-testid="sync-delivery-attention">
                {delivery.attention.slice(0, 50).map(([rel, state]) => (
                  <li className="sp-row is-auth-rejected" key={rel}>
                    <span className="sp-row-dot" aria-hidden="true" />
                    <span className="sp-row-name" title={safeName(rel, '(unnamed)')}>
                      {safeName(rel, '(unnamed)')}
                    </span>
                    <span className="sp-row-state">{DELIVERY_WORD[state] || state}</span>
                  </li>
                ))}
                {delivery.attention.length > 50 && (
                  <li className="sp-truncated">…and {delivery.attention.length - 50} more</li>
                )}
              </ul>
            )}
            {delivery.fine.length > 0 && (
              <details className="sp-held-paths" data-testid="sync-delivery-fine">
                <summary>
                  {delivery.fine.length} file{delivery.fine.length === 1 ? '' : 's'} delivered
                </summary>
                <ul>
                  {delivery.fine.slice(0, 200).map(([rel, state]) => (
                    <li key={rel}>
                      {safeName(rel, '(unnamed)')} — {DELIVERY_WORD[state] || state}
                    </li>
                  ))}
                  {delivery.fine.length > 200 && <li>…and {delivery.fine.length - 200} more</li>}
                  {files.deliveryTruncated > 0 && (
                    <li className="sp-truncated">
                      …and {files.deliveryTruncated} more not listed here — the list is capped so
                      the files that need attention always fit.
                    </li>
                  )}
                </ul>
              </details>
            )}
          </section>
        )}

        {/* Trash (Task 3, F-6) — everything sync parked instead of deleting,
            with a way back. Rendered only when something is actually parked. */}
        {trash && trash.total > 0 && (
          <section aria-label="Trash" data-testid="sync-trash">
            <div className="gp-sect-label">
              trash <span className="gp-group-count">{trash.total}</span>
            </div>
            <div className="sp-assets-line">
              {trash.total} file{trash.total === 1 ? '' : 's'} kept instead of deleted (
              {fmtBytes(trash.bytes)}) — replaced copies, conflict losers and remote deletions
              land here, in .design/_trash/.
            </div>
            <ul className="sp-list" data-testid="sync-trash-list">
              {trash.entries.slice(0, 50).map((e) => (
                <li className="sp-row" key={e.trashRel}>
                  <span className="sp-row-name" title={safeName(e.trashRel, '(unnamed)')}>
                    {safeName(e.sourceRel ?? e.trashRel.replace(/^_trash\//, ''), '(unnamed)')}
                  </span>
                  <span className="sp-row-state">
                    {TRASH_REASON_WORD[e.reason] || e.reason} · {fmtAge(e.at)}
                  </span>
                  {e.sourceRel && (
                    <button
                      type="button"
                      className="sp-assets-cancel"
                      data-testid={`sync-trash-restore-${e.sourceRel}`}
                      disabled={trashBusy}
                      onClick={() =>
                        trashAction({ action: 'restore', trashRel: e.trashRel }, (j) =>
                          j.restoredTo ? `Restored to ${j.restoredTo}.` : 'Restored.'
                        )
                      }
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
              {trash.total > 50 && (
                <li className="sp-truncated">…and {trash.total - 50} more in .design/_trash/</li>
              )}
            </ul>
            {!pruneConfirm ? (
              <div className="sp-assets-line">
                <button
                  type="button"
                  className="sp-assets-cancel"
                  data-testid="sync-trash-prune"
                  disabled={trashBusy}
                  onClick={() => setPruneConfirm(true)}
                >
                  Remove copies older than 30 days…
                </button>
              </div>
            ) : (
              <div className="sp-assets-retry" data-testid="sync-trash-prune-confirm">
                Permanently delete every parked copy older than 30 days? This cannot be undone.{' '}
                <button
                  type="button"
                  className="sp-assets-cancel"
                  data-testid="sync-trash-prune-yes"
                  disabled={trashBusy}
                  onClick={() =>
                    trashAction(
                      { action: 'prune', olderThanDays: 30 },
                      (j) => `Removed ${j.pruned} file${j.pruned === 1 ? '' : 's'} (${fmtBytes(j.bytes)}); ${j.kept} kept.`
                    )
                  }
                >
                  {trashBusy ? 'Removing…' : 'Delete them'}
                </button>{' '}
                <button
                  type="button"
                  className="sp-assets-cancel"
                  disabled={trashBusy}
                  onClick={() => setPruneConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            {trashNote && (
              <div className="sp-resync-note" role="status" aria-live="polite">
                {trashNote}
              </div>
            )}
          </section>
        )}

        {/* Settings (feature-before-first-external-users Task 2) — the three
            toggles every breaker remediation used to hand the user as "edit
            linkedHub.* JSON". Rendered only when a hub is linked (the route
            answers settings: null otherwise — dead controls teach nothing). */}
        {settings && (
          <section aria-label="Sync settings" data-testid="sync-settings">
            <div className="gp-sect-label">settings</div>
            <label className="sp-setting" data-testid="sync-setting-syncFiles">
              <input
                type="checkbox"
                checked={settings.syncFiles}
                disabled={settingsBusy}
                onChange={(e) => changeSetting({ syncFiles: e.target.checked })}
              />
              <span>
                Sync project files
                <small>The whole design folder mirrors both ways, not just canvases.</small>
              </span>
            </label>
            <label className="sp-setting" data-testid="sync-setting-propagateDeletes">
              <input
                type="checkbox"
                checked={settings.propagateDeletes}
                disabled={settingsBusy}
                onChange={(e) => changeSetting({ propagateDeletes: e.target.checked })}
              />
              <span>
                Propagate deletions
                <small>
                  Removing a file here removes it everywhere; replaced copies are kept in Trash.
                </small>
              </span>
            </label>
            <label className="sp-setting sp-setting-select" data-testid="sync-setting-firstAnchor">
              <span>
                First-link conflicts
                <small>When both sides have content the first time a project links.</small>
              </span>
              <select
                value={settings.resolveFirstAnchor}
                disabled={settingsBusy}
                onChange={(e) => changeSetting({ resolveFirstAnchor: e.target.value })}
              >
                <option value="ask">Keep asking</option>
                <option value="keep-local">Keep this machine's</option>
                <option value="keep-cloud">Keep the workspace's</option>
              </select>
            </label>
            {settingsNote && (
              <div className="sp-resync-note" role="status" aria-live="polite">
                {settingsNote}
              </div>
            )}
          </section>
        )}

        {/* Ownership (Task 2) — who owns .design/: this repo's git, or the
            linked workspace. CLI parity for `maude design adopt` / `detach`,
            behind an explicit confirm. Hidden on a cell (a member's browser
            must not re-own the operator's checkout) and without git. */}
        {ownership && !cloud && ownership.git && (
          <section aria-label="Ownership" data-testid="sync-ownership">
            <div className="gp-sect-label">ownership</div>
            <div className="sp-assets-line" data-testid="sync-ownership-mode">
              {ownership.mode === 'hub-owned' &&
                'Workspace-owned — .design/ is gitignored and mirrored by the workspace.'}
              {ownership.mode === 'repo-owned' &&
                'Repo-owned — .design/ is committed with this repository.'}
              {ownership.mode === 'hybrid' &&
                `Two owners — git commits .design/ (${ownership.trackedCount} file${ownership.trackedCount === 1 ? '' : 's'}) AND a workspace mirrors it. A git pull and a sync pass can each undo the other.`}
            </div>
            {ownershipConfirm === null && ownership.linked && ownership.mode !== 'hub-owned' && (
              <div className="sp-assets-line">
                <button
                  type="button"
                  className="sp-assets-cancel"
                  data-testid="sync-ownership-adopt"
                  disabled={ownershipBusy}
                  onClick={() => setOwnershipConfirm('adopt')}
                >
                  Hand .design/ to the workspace…
                </button>
              </div>
            )}
            {ownershipConfirm === null && ownership.mode === 'hub-owned' && (
              <div className="sp-assets-line">
                <button
                  type="button"
                  className="sp-assets-cancel"
                  data-testid="sync-ownership-detach"
                  disabled={ownershipBusy}
                  onClick={() => setOwnershipConfirm('detach')}
                >
                  Take .design/ back into this repo…
                </button>
              </div>
            )}
            {ownershipConfirm && (
              <div className="sp-assets-retry" data-testid="sync-ownership-confirm">
                {ownershipConfirm === 'adopt' ? (
                  <>
                    Stop committing .design/ and let the workspace mirror it. Nothing is deleted —
                    every file stays on disk; git stops tracking them (staged as deletions, commit
                    when ready).
                  </>
                ) : (
                  <>
                    Disconnect from the workspace ({hostOf(ownership.hubUrl)}) and take .design/
                    back into git. Every file is already on disk in full; commit the folder when
                    you are ready.
                  </>
                )}{' '}
                <button
                  type="button"
                  className="sp-assets-cancel"
                  data-testid="sync-ownership-confirm-yes"
                  disabled={ownershipBusy}
                  onClick={() => changeOwnership(ownershipConfirm)}
                >
                  {ownershipBusy ? 'Working…' : 'Do it'}
                </button>{' '}
                <button
                  type="button"
                  className="sp-assets-cancel"
                  disabled={ownershipBusy}
                  onClick={() => setOwnershipConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            )}
            {ownershipNote && (
              <div className="sp-resync-note" role="status" aria-live="polite">
                {ownershipNote}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
