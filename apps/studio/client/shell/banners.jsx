// shell/banners.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useState } from 'react';
import { isNativeApp, restartToUpdate } from '../github.js';
import { useShellStore } from '../stores/shell-store.jsx';

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

/**
 * V2-1.12 §5.8 — the 1.x side of a project that moved to Maude 2. The words
 * are the contract's (CONTRACT §4 voice; "Update Maude to edit" is the signed
 * A17 wording) and match `format.ts` FORMAT_COPY (test/format-gate-banner.test.ts).
 */
export const FORMAT_GATE_LINE = {
  newer: "This project now uses Maude 2. It's open here to look at — nothing in it is lost.",
  action: 'Update Maude to edit',
  noBuild: "This project now uses Maude 2, which isn't out yet. It stays open here to look at.",
  cloud: "This project now uses Maude 2. It's open here to look at.",
};

/** Where a browser shell sends someone to get the newer app. */
export const DOWNLOAD_URL = 'https://maude.sh/download';

/**
 * What the format banner says and offers — pure, so every variant is tested.
 *
 *   • not gated, or gated by an OLDER project (v2's own dialog owns that) → null
 *   • a cloud tab: the cell runs the compat build; look only, no action (§9 Q2)
 *   • the desktop app: a staged update → restart into it; none staged once the
 *     person asked → the "isn't out yet" line, no action (§9 Q1 — the updater
 *     already checks at boot, on focus and every 4 h, so no newer build staged
 *     means none on this channel)
 *   • a browser shell: the download page
 */
export function formatGateBannerState({ cfg, native, updateReady, askedForUpdate }) {
  const gate = cfg?.formatGate;
  if (!gate || !(gate.projectFormat > gate.supported)) return null;
  if (cfg?.cloud) return { line: FORMAT_GATE_LINE.cloud, action: null };
  if (native) {
    if (updateReady) return { line: FORMAT_GATE_LINE.newer, action: 'restart' };
    if (askedForUpdate) return { line: FORMAT_GATE_LINE.noBuild, action: null };
    return { line: FORMAT_GATE_LINE.newer, action: 'check' };
  }
  return { line: FORMAT_GATE_LINE.newer, action: 'download' };
}

/**
 * Not dismissible while gated: the project stays view only for as long as this
 * build is older than it, and a banner that can be closed makes every refused
 * edit after it look like a bug. A ShellTree child — reads the shell store.
 */
export function FormatGateBanner() {
  const {
    shellCore: { cfg, updateReady },
  } = useShellStore();
  const [askedForUpdate, setAskedForUpdate] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const state = formatGateBannerState({
    cfg,
    native: isNativeApp(),
    updateReady,
    askedForUpdate,
  });
  if (!state) return null;
  const onAction = () => {
    if (state.action === 'restart') {
      setRestarting(true);
      restartToUpdate().catch(() => setRestarting(false));
    } else if (state.action === 'check') {
      setAskedForUpdate(true);
    } else if (state.action === 'download') {
      window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
    }
  };
  return (
    <div
      role="status"
      aria-live="polite"
      className="st-banner st-banner--info"
      data-testid="format-gate-banner"
    >
      <span className="st-banner-dot" aria-hidden="true" />
      <span>{state.line}</span>
      {state.action && (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="format-gate-update"
          disabled={restarting}
          onClick={onAction}
        >
          {restarting ? 'Restarting…' : FORMAT_GATE_LINE.action}
        </button>
      )}
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
