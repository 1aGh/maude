// shell/status-bar.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { SYSTEM_TAB } from './constants.js';
import { syncPresentation } from '../../sync/presentation.ts';
import { StIcon } from './icons.jsx';

// ---------- Comment composer / viewer ----------

export function StatusBar({
  activePath,
  selected,
  wsConnected,
  openCount,
  theme,
  onToggleTheme,
  onClearSelected,
  syncStatus,
  syncProject,
  syncOpen = false,
  onOpenSync,
  changesCount = 0,
  unpushed = 0,
  // Somebody else commits this project (a cloud cell, or the cell behind a
  // linked+credentialed desktop repo — DDR-218). The chip then names the
  // mechanism that IS saving rather than reporting a working-tree count the
  // user has no reason to act on. Default false = today's local-first chip.
  savingIsManaged = false,
  changesOpen = false,
  onOpenChanges,
  version,
}) {
  const isSystem = activePath === SYSTEM_TAB;
  const text =
    selected && selected.selector
      ? selected.selector + (selected.text ? ` — "${selected.text.slice(0, 60)}"` : '')
      : '';
  const title =
    selected && selected.dom_path
      ? selected.dom_path.join(' > ')
      : selected
        ? selected.selector
        : '';
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  // P5 (Plan C) — always-on hub-sync slot. `/_sync-status` returns one of three
  // shapes: solo `{linked:false}` (hide), DDR-060 `{notSyncable,tsxCount,reason}`
  // (linked but 0 syncable), or the connection-state machine `{state,queuedOps,
  // flash,…}` (the common linked case the old notSyncable-only guard never
  // showed — the "hub sync se neukazuje" bug).
  //
  // The mapping used to live here, and it referenced `docs` ZERO times: it read
  // `state` alone, so a link whose every document the hub had refused still
  // showed a green dot and the word "synced". `syncPresentation` is now the one
  // rule, shared with the cloud rail's connect note, so the two surfaces cannot
  // give a person different answers about the same payload.
  const syncSlot = (() => {
    const p = syncPresentation(syncStatus, { project: syncProject });
    if (!p) return null;
    const detail = p.names.length ? ` (${p.names.join(', ')})` : '';
    return {
      online: p.online,
      phase: p.phase,
      label: p.label,
      title: `${p.title}${detail}${p.next ? ` — ${p.next}` : ''}`,
    };
  })();
  // One body for both chip forms (button vs plain span) below.
  const syncSlotBody = syncSlot && (
    <>
      <span
        className={'st-sb-sync-dot' + (syncSlot.online ? ' is-online' : '')}
        aria-hidden="true"
      />
      <span className="lbl">hub sync</span>
      <span
        className="val"
        title={syncSlot.title}
        data-testid="statusbar-sync"
        data-phase={syncSlot.phase}
      >
        {syncSlot.label}
      </span>
    </>
  );

  return (
    <footer className="st-statusbar" role="contentinfo" data-testid="statusbar">
      <span className="st-sb-slot st-sb-active" role="group" aria-label="Active file">
        <span className="lead" aria-hidden="true" />
        <span className="lbl">active</span>
        <span className="val" title={activePath || ''}>
          {isSystem ? '▦ design system' : activePath || '—'}
        </span>
      </span>

      {/* Selection is meaningless without an open canvas — a stale _active.json
          selection used to leave a ghost SELECTED chip on the empty shell. */}
      {activePath && selected && selected.selector && !isSystem && (
        <span className="st-sb-slot st-sb-sel" role="group" aria-label="Selected element">
          <span className="lbl">selected</span>
          <span className="val" title={title}>
            {text}
          </span>
          <button
            type="button"
            className="st-sb-sel-clear"
            onClick={onClearSelected}
            data-tip="Clear · Esc inside iframe"
            data-tip-pos="top"
            aria-label="Clear selection"
          >
            ×
          </button>
        </span>
      )}

      <span className="st-sb-slot" role="group" aria-label="Open comments">
        <span className="lbl">comments</span>
        <span className="val">{openCount} open</span>
      </span>

      {/* Phase 28 — changes count, click to open the Changes panel (⌘⇧G). */}
      {onOpenChanges && (
        <button
          type="button"
          className={
            'st-sb-slot st-sb-changes' +
            (changesOpen ? ' is-open' : '') +
            (changesCount > 0 ? ' has-changes' : unpushed > 0 ? ' has-unpushed' : '')
          }
          onClick={onOpenChanges}
          data-testid="open-changes"
          data-tip="Open Changes · ⌘⇧G"
          data-tip-pos="top"
          aria-label="Open Changes panel"
          aria-pressed={changesOpen}
        >
          <span className="st-sb-changes-dot" aria-hidden="true" />
          <span className="lbl">changes</span>
          <span className="val">
            {savingIsManaged
              ? // Not "all saved": assets and project config are written into the
                // cell's checkout but never committed there, so asserting a clean
                // save would overstate what the cloud actually holds. Naming the
                // mechanism is both honest and the thing the user needs to know.
                'cloud saving'
              : changesCount > 0
                ? `${changesCount} unsaved`
                : unpushed > 0
                  ? `${unpushed} to publish`
                  : 'all saved'}
          </span>
        </button>
      )}

      <span className="st-sb-spacer" />

      <span className="st-sb-slot" role="group" aria-label="Connection">
        <span className={'st-live-dot' + (wsConnected ? ' is-connected' : '')} aria-hidden="true" />
        <span className="lbl">{wsConnected ? 'live' : 'reconnecting'}</span>
      </span>

      {/* P5 (Plan C) — always-on hub-sync slot (was notSyncable-only per DDR-060
          / 9.1-D). Now also surfaces the connection-state machine's queued/synced
          counter for the common linked case. Solo projects render nothing.
          feature-sync-progress-modal — a BUTTON that toggles the per-file Sync
          panel (like the Changes chip toggles GitPanel); the plain-span form
          stays for servers/sessions that pass no handler. */}
      {syncSlot &&
        (onOpenSync ? (
          <button
            type="button"
            className={'st-sb-slot st-sb-sync st-sb-sync--btn' + (syncOpen ? ' is-open' : '')}
            onClick={onOpenSync}
            data-testid="open-sync"
            data-tip="Open Sync panel"
            data-tip-pos="top"
            aria-label="Open Sync panel"
            aria-pressed={syncOpen}
          >
            {syncSlotBody}
          </button>
        ) : (
          <span className="st-sb-slot st-sb-sync" role="group" aria-label="Hub sync">
            {syncSlotBody}
          </span>
        ))}

      {/* Which release this is. Reading it used to mean probing production by
          hand — and the desktop, the browser and a cloud tab all serve the same
          client, so one slot covers all three. Absent on an older server that
          omits `version` from /_config, exactly as `cloud` and `canvasToken`
          already are. */}
      {version && (
        <span className="st-sb-slot st-sb-version" role="group" aria-label="Maude version">
          <span className="val" data-testid="statusbar-version">
            v{version}
          </span>
        </span>
      )}

      <button
        type="button"
        className="st-sb-theme"
        onClick={onToggleTheme}
        data-tip={`Switch to ${nextTheme} theme`}
        data-tip-pos="top"
        aria-label={`Switch to ${nextTheme} theme`}
      >
        <StIcon name={theme === 'dark' ? 'sun' : 'moon'} size={13} />
        {nextTheme}
      </button>
    </footer>
  );
}
