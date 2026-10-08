// shell/banners.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useState } from 'react';
import { restartToUpdate } from '../github.js';

// ---------- Sync banner (Phase 9 Task 8 — hub-down offline mode) ----------

// Renders nothing when online with no flash (the common case). Yellow strip
// while offline (with queued-edit count), red when offline > 24h, green flash
// for 3s right after a reconnect. Driven entirely by the 'sync:status' payload
// the dev-server's linked-mode sync runtime broadcasts.
// Phase 32 (Task 1) — auto-update notice. Shown after the shell has downloaded +
// staged a newer build in the background. Non-blocking: "Restart now" applies it,
// "Later" dismisses (the next focus/4h check re-stages and re-surfaces it).
/**
 * What this role can do, said once, where a teammate lands — Cloud Phase 27 C3.
 *
 * A browser tab arrives with none of the context a desktop has: no window
 * title, no app the person chose to install, and — for a viewer — a set of
 * controls that will refuse them without explaining why. One line, dismissible,
 * remembered per role. It re-appears if the role CHANGES, because "you can edit
 * this now" is worth saying exactly as much as the first sentence was.
 *
 * Copy comes from the role the cell vouched (`role-matrix.mjs` is the authority
 * on what each one means; this is its sentence, not a second opinion).
 */
export const ROLE_LINE = {
  owner: 'You own this project — edit, invite and export.',
  member: 'You can edit this project, comment and export.',
  viewer: 'You can look at this project, comment and download it, but not change it.',
};

export function CloudRoleBanner({ cloud }) {
  const role = cloud?.role || null;
  // Dismissal is READ AT RENDER, not seeded into state. `cfg.cloud` is
  // `undefined` until `/_config` lands, so a `useState` initializer runs while
  // there is no role yet — and whatever it decided then would stick forever,
  // which on the first attempt meant the banner never appeared at all. Found by
  // opening it in a browser; no test in this repo would have said a word.
  const [dismissedNow, setDismissedNow] = useState(false);
  if (!role || dismissedNow) return null;
  const storageKey = `maude-cloud-role-seen:${role}`;
  let alreadySeen = false;
  try {
    alreadySeen = localStorage.getItem(storageKey) === '1';
  } catch {
    /* private mode / storage disabled — show it, saying it twice beats never */
  }
  if (alreadySeen) return null;
  const line = ROLE_LINE[role];
  if (!line) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="st-banner st-banner--info"
      data-testid="cloud-role-banner"
    >
      <span className="st-banner-dot" aria-hidden="true" />
      <span>{line}</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid="cloud-role-banner-dismiss"
        onClick={() => {
          setDismissedNow(true);
          try {
            localStorage.setItem(storageKey, '1');
          } catch {}
        }}
      >
        Got it
      </button>
    </div>
  );
}

export function UpdateBanner({ update, onDismiss }) {
  const [restarting, setRestarting] = useState(false);
  if (!update) return null;
  const ver = update.version ? ` (v${update.version})` : '';
  return (
    <div role="status" aria-live="polite" className="st-banner st-banner--info">
      <span className="st-banner-dot" aria-hidden="true" />
      <span>Maude updated{ver} · restart to apply</span>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          restartToUpdate().catch(() => setRestarting(false));
        }}
      >
        {restarting ? 'Restarting…' : 'Restart now'}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        Later
      </button>
    </div>
  );
}

export function SyncBanner({ status }) {
  // Plan C follow-up — the banner overlapped the menubar and wasn't dismissable.
  // Dismissal is keyed on the connection state, so a transition (reconnect flash,
  // escalation to offline-long) re-surfaces it; a stable state stays hidden.
  const [dismissedKey, setDismissedKey] = useState(null);
  if (!status || status.linked === false) return null;
  // DDR-060 / 9.1-D — the "linked but 0 syncable" state is surfaced in the
  // status bar (sb-sync slot), NOT as a floating banner. This component owns
  // the transient offline / reconnect-flash banner (Task 8) plus the DDR-102
  // rejected-docs chip and divergence-resolution toast.
  if (status.notSyncable) return null;
  const { state, queuedOps, flash, conflicts } = status;
  const showFlash = flash === 'synced';
  const offline = state === 'offline' || state === 'offline-long';
  // DDR-102 — per-doc rollup + the latest divergence notice (additive fields;
  // an old payload without them renders exactly the pre-DDR-102 banner).
  const rejected = status.docs?.rejected ?? 0;
  const lastDiverged = Array.isArray(conflicts)
    ? [...conflicts].reverse().find((c) => c.kind === 'cold-start-diverged')
    : null;
  if (!offline && !showFlash && !lastDiverged && rejected === 0) return null;

  // One banner at a time — priority: reconnect flash > offline > divergence
  // toast > rejected chip. Dismissal is keyed per state so a new event
  // (another conflict, a changed rejected count) re-surfaces it.
  let variant;
  let text;
  let dismissKey;
  if (showFlash) {
    variant = 'success';
    text = 'Synced with hub';
    dismissKey = `${state}:flash`;
  } else if (offline) {
    const conflictNote =
      conflicts && conflicts.length > 0 ? ` (${conflicts.length} conflict notice(s))` : '';
    if (state === 'offline-long') {
      variant = 'error';
      text = `Long offline — ${queuedOps} edit(s) queued. Consider \`git commit && git push\` as backup.${conflictNote}`;
    } else {
      variant = 'warn';
      text = `Working offline · ${queuedOps} edit(s) queued · will sync when the hub reconnects.${conflictNote}`;
    }
    dismissKey = `${state}:offline`;
  } else if (lastDiverged) {
    // DDR-102 fail-closed: a snapshotFailed conflict means the hub-wins overwrite
    // was REFUSED (local kept) because _history couldn't be written — surface it
    // as an error, not a routine "kept newest" notice.
    if (lastDiverged.snapshotFailed) {
      variant = 'error';
      text = `Diverged on ${lastDiverged.slug}: kept local — the history snapshot FAILED, so the overwrite was refused. Check disk space / .design/_history write access.`;
    } else {
      variant = 'warn';
      text = `Diverged on ${lastDiverged.slug}: kept the ${
        lastDiverged.winner === 'local' ? 'local (newer)' : 'hub'
      } version — the other is snapshotted in history → /design:rollback ${lastDiverged.slug}`;
    }
    dismissKey = `diverged:${lastDiverged.slug}:${lastDiverged.at}`;
  } else {
    variant = 'warn';
    text = `${rejected} canvas(es) not syncing — the hub rejected auth. Details: maude design status`;
    dismissKey = `rejected:${rejected}`;
  }
  if (dismissedKey === dismissKey) return null;

  return (
    <div role="status" aria-live="polite" className={`st-banner st-banner--${variant}`}>
      <span className="st-banner-dot" aria-hidden="true" />
      <span>{text}</span>
      <button
        type="button"
        className="st-banner-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => setDismissedKey(dismissKey)}
      >
        ×
      </button>
    </div>
  );
}
