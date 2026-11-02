// shell/banners.jsx — V2-4.8b: what is left of the v1 banner file is the format-gate strip (V2-1.12, v2
// code). The sync / role / update / repo-changed banners are callouts now: client/v2/shell/callouts-*.
// The gate keeps its own state machine and testids, and draws as a callout (same plate, same stack).

import { useState } from 'react';
import { isNativeApp, restartToUpdate } from '../github.js';
import { useShellStore } from '../stores/shell-store.jsx';
import { StIcon } from './icons.jsx';
import { isOlderGate, isSaveModeOffer } from '../v2/shell/format-update.js';
import { OlderFormatCallout } from '../v2/shell/format-update.jsx';

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
 *   • not gated, or gated by an OLDER project (OlderFormatCallout owns that) → null
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
  // An OLDER project (format 1 in v2) is the v2 side: view only + Update project (Michal 2A); a linked
  // project that still saves the old way gets the same Update, quieter (p8-update-to-accepted).
  if (isOlderGate(cfg) || isSaveModeOffer(cfg)) return <OlderFormatCallout />;
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
      className="sh-callout sh-callout--info"
      data-testid="format-gate-banner"
    >
      <span className="sh-callout-ic" aria-hidden="true">
        <StIcon name="problem" size={16} />
      </span>
      <span className="sh-callout-t">{state.line}</span>
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
