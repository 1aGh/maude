// client/v2/settings/settings-sheet.jsx — V2-4.7a: the Settings sheet (06 ad-settings · ad-edge-hub,
// 02 ob-settings). Replaces the seven-tab Settings dialog.
//
//   ┌ Settings ──────────────────────────────────────────────┐
//   │ General        │  …the section's groups…               │
//   │ Connections    │                                       │
//   │ Advanced       │                                       │
//   │ Maude 2.0.0    │                                       │
//   └────────────────────────────────────────────────────────┘
//
// A modal sheet over a veil: esc (or a click on the veil) closes it and focus goes back to where it
// was — the project menu's “Settings…” row, or the canvas after ⌘,. The section rail is a vertical
// tablist (arrows / Home / End rove); each section is a tabpanel. A section that was opened stays
// mounted (hidden) so a model download's poll survives a section switch.
//
// Connections and Advanced are the desktop's (`cloud === null`, and an owner's session): a browser tab
// has no keychain, ffmpeg or whisper, and a read-only link must not touch the Mac's config, so those
// sections are ABSENT there, not disabled (settings-model.js).

import { useEffect, useRef, useState } from 'react';

import { StIcon } from '../../shell/icons.jsx';
import { MDCC_VERSION } from '../../shell/constants.js';
import AdvancedSection from './advanced-section.jsx';
import { restoreFocus, trapTab } from '../shell/modal-focus.js';
import ConnectionsSection from './connections-section.jsx';
import GeneralSection from './general-section.jsx';
import { railTarget, resolveTab, SETTINGS_TAB_STORE, sectionsFor } from './settings-model.js';

function remembered() {
  try {
    return localStorage.getItem(SETTINGS_TAB_STORE);
  } catch {
    return null;
  }
}

export default function SettingsSheet({
  /** Tri-state shell flag (see settings-model.js): undefined = unknown, null = desktop, object = cloud tab. */
  cloud,
  /** A read-only session (V2-4.9): General only — the preferences of the person, none of the Mac's. */
  readOnly = false,
  onClose,
  initialTab,
  /** The staged auto-update (`{ version }`) or null, and the “Later” answer. */
  update = null,
  onUpdateLater,
  syncStatus,
  onLinkedHub,
  onLocalProject,
  ...general
}) {
  const sections = sectionsFor(cloud, readOnly);
  const ids = sections.map((s) => s.id);
  const [tab, setTab] = useState(() => resolveTab(cloud, initialTab, remembered(), readOnly));
  // A section the shell lost between renders (cloud answered late) must not stay selected.
  const current = ids.includes(tab) ? tab : 'general';
  const [visited, setVisited] = useState(() => new Set([current]));
  const sheetRef = useRef(null);
  const tabRefs = useRef({});

  useEffect(() => {
    setVisited((v) => (v.has(current) ? v : new Set(v).add(current)));
    try {
      localStorage.setItem(SETTINGS_TAB_STORE, current);
    } catch {
      /* private mode — the choice just isn't remembered */
    }
  }, [current]);

  // Focus: in on open, back out on close.
  useEffect(() => {
    const opener = document.activeElement;
    tabRefs.current[current]?.focus();
    return () => {
      restoreFocus(opener); // the opener, or the shell's landmark when it is gone — never BODY
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // esc closes — unless a dialog opened FROM the sheet (the sign-in code, the team-server form) is
  // on top: esc belongs to that one first.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.gi-modal, .cp-modal')) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function onRailKey(e) {
    const to = railTarget(ids, current, e.key);
    if (!to) return;
    e.preventDefault();
    setTab(to);
    tabRefs.current[to]?.focus();
  }

  // Keep Tab inside the sheet while it is the topmost thing (the shell's one trap, v2/shell/modal-focus.js).
  function onSheetKey(e) {
    if (document.querySelector('.gi-modal, .cp-modal')) return;
    trapTab(e, sheetRef.current);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the veil is a pointer convenience (esc and the Done button close the sheet for the keyboard)
    <div
      className="v2s-scrim"
      role="presentation"
      data-testid="settings-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="v2s-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-sheet"
        ref={sheetRef}
        onKeyDown={onSheetKey}
      >
        {/* The rail is a plain wrapper: the tablist inside holds ONLY tabs (WCAG 1.3.1 / aria-required-children),
            the title, version line and Done sit beside it. */}
        <div className="v2s-rail">
          <p className="v2s-title">Settings</p>
          <div
            className="v2s-tabs"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings sections"
            onKeyDown={onRailKey}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`v2s-tab-${s.id}`}
                aria-controls={`v2s-panel-${s.id}`}
                aria-selected={current === s.id}
                tabIndex={current === s.id ? 0 : -1}
                className="v2s-tab"
                data-testid={`settings-tab-${s.id}`}
                ref={(n) => {
                  tabRefs.current[s.id] = n;
                }}
                onClick={() => setTab(s.id)}
              >
                {s.icon ? <StIcon name={s.icon} size={14} className="v2s-tab-ic" /> : null}
                {s.label}
              </button>
            ))}
          </div>
          <span className="v2s-rail-sp" />
          <span className="v2s-foot">Maude {MDCC_VERSION}</span>
          <button
            type="button"
            className="v2s-close"
            data-testid="settings-close"
            onClick={onClose}
          >
            Done
          </button>
        </div>

        <div className="v2s-main">
          {sections.map(
            (s) =>
              visited.has(s.id) && (
                <section
                  key={s.id}
                  role="tabpanel"
                  id={`v2s-panel-${s.id}`}
                  aria-labelledby={`v2s-tab-${s.id}`}
                  hidden={current !== s.id}
                  className="v2s-panel"
                  data-testid={`settings-panel-${s.id}`}
                >
                  {s.id === 'general' && (
                    <GeneralSection cloud={cloud} readOnly={readOnly} {...general} />
                  )}
                  {s.id === 'connections' && (
                    <ConnectionsSection
                      syncStatus={syncStatus}
                      onLinkedHub={onLinkedHub}
                      onLocalProject={onLocalProject}
                    />
                  )}
                  {s.id === 'advanced' && (
                    <AdvancedSection update={update} onUpdateLater={onUpdateLater} live={general} />
                  )}
                </section>
              )
          )}
        </div>
      </div>
    </div>
  );
}
