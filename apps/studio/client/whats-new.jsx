// whats-new.jsx — Maude UI "What's New" surfaces.
//
//   useWhatsNew(version)  → headless handle (fetch + seen-state + open-state)
//   <WhatsNewToast>       → first-run notice (bottom-left, mirrors ai-banner.tsx)
//   <WhatsNewPanel>       → list of entries (reuses the help-modal backdrop)
//
// Styling lives in client/v2/help/help.css (.mdcc-wn-*). Spotlight tours
// (entry.tour[]) land in Phase 3 — the panel/toast leave a hook for them.

import { useCallback, useEffect, useState } from 'react';
import { dismissNotice, notify } from '../notifications.tsx';
import {
  bestSeenVersion,
  canReplayTour,
  computeUnseen,
  LEGACY_SEEN_KEY,
  resolveSeen,
  SEEN_PREF,
} from './whats-new-seen.js';

// S6.6 / Q11: the seen mark of record is ui-prefs `whatsNewSeen` (one per Mac, shared with Home);
// the per-origin key is still written for a 1.x build on this origin and seeds the first migration.
const WN_SEEN = LEGACY_SEEN_KEY;
const WN_TOAST = 'mdcc-whatsnew-toast-dismissed';

// learnMore renders as <a href> in the privileged main origin. Only bind an
// http(s) URL — belt-and-suspenders next to React's built-in URL sanitizer and
// the schema's pattern (security review, defense-in-depth).
function isSafeHref(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function readLegacySeen() {
  try {
    return localStorage.getItem(WN_SEEN);
  } catch {
    return null;
  }
}

/** The first paint's mark, before ui-prefs answers: this origin's old key, else the current version. */
function readSeen(currentVersion) {
  return readLegacySeen() || currentVersion;
}

function storeSeen(version) {
  fetch('/_api/ui-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [SEEN_PREF]: version }),
  }).catch(() => {
    /* offline / restart — the next refresh re-reads the stored mark */
  });
}

/**
 * The shared mark (ui-prefs): stored → use it; else migrate this origin's old key once; else a
 * first-ever run acknowledges the current version silently, so a brand-new user isn't greeted with
 * the entire backlog as "new" (only true upgrades and pending dev entries surface after this).
 */
async function syncSeen(currentVersion) {
  const r = await fetch('/_api/ui-prefs');
  const prefs = await r.json();
  const legacy = readLegacySeen();
  const { seen, write } = resolveSeen({
    stored: prefs?.[SEEN_PREF],
    legacy,
    current: currentVersion,
  });
  if (write) {
    storeSeen(write);
    try {
      if (!legacy) localStorage.setItem(WN_SEEN, write);
    } catch {}
  }
  return seen;
}

function readToastDismissed() {
  try {
    return localStorage.getItem(WN_TOAST);
  } catch {
    return null;
  }
}

export function useWhatsNew(currentVersion) {
  const [entries, setEntries] = useState([]);
  const [feedVersion, setFeedVersion] = useState(currentVersion);
  const [seenVersion, setSeenVersion] = useState(() => readSeen(currentVersion));
  const [toastDismissed, setToastDismissed] = useState(() => readToastDismissed());
  const [panelOpen, setPanelOpen] = useState(false);

  // Fetch the feed on mount AND whenever the window regains focus (Phase 32 /
  // Task 5). The native shell can sit backgrounded for a long time; an auto-update
  // (or a deploy of the web studio) bumps the feed while we're not looking, so we
  // re-evaluate on focus to surface the ✦ badge without a full reload.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      syncSeen(currentVersion)
        .then((seen) => {
          if (!cancelled && seen) setSeenVersion(seen);
        })
        .catch(() => {
          /* prefs unreadable — keep this origin's mark */
        });
      fetch('/_api/whats-new')
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          setEntries(Array.isArray(j?.entries) ? j.entries : []);
          if (typeof j?.version === 'string') setFeedVersion(j.version);
        })
        .catch(() => {
          /* offline / restart — no banner */
        });
    };
    refresh();
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentVersion]);

  const unseen = computeUnseen(entries, seenVersion);
  const showToast = unseen.length > 0 && toastDismissed !== feedVersion && !panelOpen;
  const toastEntry = unseen[0] ?? null;

  const markAllSeen = useCallback(() => {
    const next = bestSeenVersion(entries, feedVersion);
    setSeenVersion(next);
    setToastDismissed(feedVersion);
    storeSeen(next);
    try {
      localStorage.setItem(WN_SEEN, next);
      localStorage.setItem(WN_TOAST, feedVersion);
    } catch {}
  }, [entries, feedVersion]);

  const dismissToast = useCallback(() => {
    setToastDismissed(feedVersion);
    try {
      localStorage.setItem(WN_TOAST, feedVersion);
    } catch {}
  }, [feedVersion]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    markAllSeen();
  }, [markAllSeen]);

  return {
    entries,
    unseen,
    feedVersion,
    panelOpen,
    openPanel,
    closePanel,
    showToast,
    toastEntry,
    dismissToast,
    markAllSeen,
  };
}

/** S11.18 (design W5): a toast is one short line, not the changelog — the first sentence, 90 characters at most. */
export function toastLine(summary) {
  const text = String(summary ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const first = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first;
}

export function WhatsNewToast({ wn }) {
  const id = `whats-new-${wn.feedVersion}`;
  useEffect(() => {
    if (!wn.showToast || !wn.toastEntry) {
      dismissNotice(id);
      return;
    }
    notify({
      id,
      group: 'whats-new',
      kind: 'info',
      duration: 10_000,
      title: `What’s new${wn.toastEntry.version ? ` · v${wn.toastEntry.version}` : ''} — ${wn.toastEntry.title}`,
      description: toastLine(wn.toastEntry.summary),
      action: {
        label: wn.unseen.length > 1 ? `See all (${wn.unseen.length})` : 'Details',
        onClick: wn.openPanel,
      },
      onDismiss: wn.dismissToast,
    });
  }, [id, wn.showToast, wn.toastEntry, wn.unseen.length, wn.openPanel, wn.dismissToast]);
  useEffect(() => () => dismissNotice(id), [id]);
  return null;
}

export function WhatsNewPanel({ wn, onStartTour }) {
  const { panelOpen, closePanel } = wn;
  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') closePanel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  if (!panelOpen) return null;
  const unseenIds = new Set(wn.unseen.map((e) => e.id));
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      <div
        className="mdcc-wn-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mdcc-wn-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="mdcc-wn-title">
            ✦ What’s new in maude
          </span>
          <button
            type="button"
            className="help-modal-close"
            aria-label="Close (Esc)"
            onClick={closePanel}
          >
            ×
          </button>
        </header>
        <div className="mdcc-wn-panel__body">
          {wn.entries.length === 0 ? (
            <p className="mdcc-wn-empty">Nothing new yet.</p>
          ) : (
            <ul className="mdcc-wn-list">
              {wn.entries.map((e) => (
                <li
                  key={e.id}
                  className={'mdcc-wn-item' + (unseenIds.has(e.id) ? ' is-unseen' : '')}
                >
                  <div className="mdcc-wn-item__hd">
                    <span className={'mdcc-wn-kind mdcc-wn-kind--' + e.kind}>{e.kind}</span>
                    <span className="mdcc-wn-item__title">{e.title}</span>
                    <span className="mdcc-wn-item__ver">
                      {e.version ? `v${e.version}` : 'next'}
                    </span>
                  </div>
                  <p className="mdcc-wn-item__summary">{e.summary}</p>
                  {isSafeHref(e.learnMore) && (
                    <a
                      className="mdcc-wn-item__more"
                      href={e.learnMore}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Learn more →
                    </a>
                  )}
                  {onStartTour && canReplayTour(e) && (
                    <button
                      type="button"
                      className="mdcc-wn-item__tour"
                      onClick={() => {
                        closePanel();
                        onStartTour(e.tour);
                      }}
                    >
                      ▶ Take tour
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
