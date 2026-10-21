// client/v2/diagnostics/diagnostics-sheet.jsx — V2-4.7b: what Menu › Diagnostics opens (06 Advanced
// ad-logs + ad-syncd). Presentational: the host (diagnostics-host.jsx) owns the data and the fetches.
//
//   Logs      — the four sources' ring buffers (sync · server · AI · export), filter + copy (ad-logs)
//   Server    — mode stamp, live connection, address, version, process, project folder, "repo state
//               changed — reload?" (was the status bar's live dot / version, the menu bar's IDLE ·
//               CANVAS · SYSTEM stamp, the empty canvas's port line, and the reload banner)
//   AI setup  — the readiness list, whole: Claude Code, where it was found, plugins, Re-check
//   Sync      — today's Sync panel, whole (ad-syncd), plus "Get latest" when the team has new versions
//
// Mono and raw words are allowed here: this is the Advanced side of the app.

import { useState } from 'react';
import { rovingTabKey, useModalFocus } from '../shell/modal-focus.js';
import { TeamProjectsDialog } from '../../panels/TeamProjects.jsx';
import { isNativeApp } from '../../github.js';
import SyncDetails from './sync-details/sync-details.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import ReadinessList from '../../panels/ReadinessList.jsx';
import {
  aiNeedsWork,
  aiRows,
  clock,
  filterLabel,
  LOG_FILTERS,
  logLines,
  modeStamp,
  tilde,
} from './diagnostics-model.js';
import {
  groupDigits,
  resyncPercent,
  resyncProgressText,
  resyncResultText,
} from './resync-model.js';

/** Diagnostics' Advanced fold (Sync › Hub, commands) in prefs.json `fold`. */
export const DIAGNOSTICS_FOLD = 'diagnostics';
/** AI setup's "All checks" fold — its own key, so opening one fold never opens the other. */
export const DIAGNOSTICS_AI_FOLD = 'diagnostics-ai';
const DG_FOLD_CLASSES = Object.freeze({
  root: 'dg-fold',
  btn: 'dg-fold-btn',
  ch: 'dg-fold-ch',
  body: 'dg-fold-body',
});

export const TABS = Object.freeze([
  ['logs', 'Logs'],
  ['server', 'Server'],
  ['ai', 'AI setup'],
  ['sync', 'Sync'],
]);

function Word({ w }) {
  if (!w) return null;
  return (
    <span className="dg-word" data-tone={w.tone}>
      {w.word}
    </span>
  );
}

function CopyBtn({ id, label, value, onCopy }) {
  return (
    <button
      type="button"
      className="dg-copy"
      data-testid={`diag-copy-${id}`}
      aria-label={`Copy ${label.toLowerCase()}`}
      disabled={value === '' || value == null}
      onClick={() => onCopy(String(value), label)}
    >
      Copy
    </button>
  );
}

function Row({ id, k, children, mono, copy, onCopy }) {
  return (
    <div className="dg-row" data-testid={`diag-row-${id}`}>
      <span className="dg-k">{k}</span>
      <span className={`dg-v${mono ? ' dg-mono' : ''}`}>{children || '—'}</span>
      {copy !== undefined ? <CopyBtn id={id} label={k} value={copy} onCopy={onCopy} /> : null}
    </div>
  );
}

// ── Logs ──────────────────────────────────────────────────────────────────────────────────────

function LogsView({ data, error, onRefresh, onCopyLogs, onReveal }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const lines = logLines(data?.sources, { filter, query });
  return (
    <div className="dg-card dg-logs" data-testid="diag-logs">
      <div className="dg-logs-hd">
        <strong>Logs</strong>
        <fieldset className="dg-seg" aria-label="Source">
          {LOG_FILTERS.map((f) => (
            <button
              type="button"
              key={f}
              className="dg-seg-b"
              aria-pressed={filter === f}
              data-testid={`diag-logs-filter-${f}`}
              onClick={() => setFilter(f)}
            >
              {filterLabel(f)}
            </button>
          ))}
        </fieldset>
        <input
          type="search"
          className="dg-find"
          placeholder="Filter"
          aria-label="Filter log lines"
          data-testid="diag-logs-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="dg-btn"
          data-testid="diag-logs-refresh"
          onClick={onRefresh}
        >
          Refresh
        </button>
        <button
          type="button"
          className="dg-btn"
          data-testid="diag-logs-copy-all"
          onClick={() => onCopyLogs(lines)}
        >
          Copy all
        </button>
        {/* Native only (S11.16's command): in a browser tab there is no Finder to show it in. */}
        {onReveal ? (
          <button
            type="button"
            className="dg-btn"
            data-testid="diag-logs-show-in-finder"
            onClick={onReveal}
          >
            Show in Finder
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="dg-empty" role="alert" data-testid="diag-logs-error">
          Couldn’t read the logs — {error}
        </p>
      ) : lines.length === 0 ? (
        <p className="dg-empty" data-testid="diag-logs-empty">
          {data ? 'No lines yet.' : 'Reading the logs…'}
        </p>
      ) : (
        // gate-b-a11y: a scrolling list is a tab stop (WCAG 2.1.1 — axe scrollable-region-focusable)
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scroller must be keyboard-reachable
        <ol className="dg-lines" data-testid="diag-logs-lines" aria-label="Log lines" tabIndex={0}>
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a log tail has no identity but position
            <li key={i} className="dg-line" data-source={l.source} data-level={l.level}>
              <span className="dg-line-t">{clock(l.at)}</span>
              <span className="dg-line-s">{l.source}</span>
              <span className="dg-line-m">{l.shown}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="dg-hint">
        Kept {data?.retentionDays ?? 7} days on this Mac · Help › Report a bug can attach the last
        200 lines.
      </p>
    </div>
  );
}

// ── Server ────────────────────────────────────────────────────────────────────────────────────

function ServerView({ status, wsConnected, activePath, isSystem, info, repoChanged, onCopy }) {
  const mode = modeStamp({ activePath, isSystem });
  return (
    <div className="dg-card" data-testid="diag-server">
      <div className="dg-hd">
        <strong>Server</strong>
        <Word w={status} />
      </div>
      {repoChanged ? (
        <div className="dg-notice" role="status" data-testid="diag-repo-changed">
          <span>Repo state changed — reload?</span>
          <button
            type="button"
            className="dg-btn dg-btn--primary"
            data-testid="diag-repo-reload"
            onClick={repoChanged.reload}
          >
            Reload
          </button>
          <button
            type="button"
            className="dg-btn"
            data-testid="diag-repo-dismiss"
            onClick={repoChanged.dismiss}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <Row id="mode" k="Showing">
        <span data-testid="diag-mode-stamp" data-mode={mode.stamp.toLowerCase()}>
          {mode.showing}
        </span>
      </Row>
      <Row id="live" k="Live connection">
        <span data-testid="diag-live">{wsConnected ? 'Connected' : 'Reconnecting…'}</span>
      </Row>
      <Row id="address" k="Address" mono copy={info.address} onCopy={onCopy}>
        {info.address}
      </Row>
      <Row id="version" k="Version" mono copy={info.version} onCopy={onCopy}>
        {info.version}
      </Row>
      <Row id="process" k="Process" mono copy={info.pid ?? ''} onCopy={onCopy}>
        {info.pid ?? ''}
      </Row>
      <Row id="folder" k="Project folder" mono copy={info.folder} onCopy={onCopy}>
        {info.folder ? tilde(info.folder) : ''}
      </Row>
      <p className="dg-hint">
        Was the status bar’s live dot and version, the IDLE · CANVAS · SYSTEM stamp and the empty
        canvas’s port line.
      </p>
    </div>
  );
}

// ── AI setup ──────────────────────────────────────────────────────────────────────────────────

function AiRow({ row }) {
  return (
    <li className="dg-ai-row" data-state={row.state} data-testid={`diag-ai-row-${row.id}`}>
      <span className="dg-ai-ic" aria-hidden="true">
        {row.state === 'ok' ? '✓' : row.state === 'unknown' ? '?' : '!'}
      </span>
      <span>
        {row.label}
        <span className="sr-only">
          {row.state === 'ok'
            ? ' — ready'
            : row.state === 'unknown'
              ? ' — not known'
              : ' — needs setup'}
        </span>
        {row.hint ? <span className="dg-hint"> · {row.hint}</span> : null}
      </span>
      <span className="dg-ai-v">{row.value}</span>
    </li>
  );
}

function AiView({ status, report, loading, onRecheck }) {
  const rows = aiRows(report);
  // Anything not satisfied keeps its whole row (fix text, Set up / Sign in, the install command).
  const needs = aiNeedsWork(report);
  return (
    <div className="dg-card" data-testid="diag-ai">
      <div className="dg-hd">
        <strong>AI setup</strong>
        <Word w={status} />
        <span className="dg-when" data-testid="diag-ai-when">
          {loading ? 'Checking…' : report ? 'Checked just now' : ''}
        </span>
        <button
          type="button"
          className="dg-btn"
          data-testid="diag-ai-recheck"
          disabled={loading}
          onClick={onRecheck}
        >
          Check again
        </button>
      </div>
      {rows.length ? (
        <ul className="dg-ai-rows" data-testid="diag-ai-rows">
          {rows.map((r) => (
            <AiRow key={r.id} row={r} />
          ))}
        </ul>
      ) : (
        <p className="dg-empty">{loading ? 'Checking…' : 'Couldn’t reach the readiness probe.'}</p>
      )}
      {needs.length ? (
        <>
          <p className="dg-ai-sub" data-testid="diag-ai-needs">
            Needs setup
          </p>
          <ReadinessList
            report={{ ...report, items: needs }}
            loading={loading}
            refresh={onRecheck}
          />
        </>
      ) : null}
      {/* The whole probe, as it always was (the optional checks too): one quiet row. */}
      {report ? (
        <AdvancedFold
          panel={DIAGNOSTICS_AI_FOLD}
          label="All checks"
          classes={DG_FOLD_CLASSES}
          testid="diag-ai-all"
          buttonTestid="diag-ai-all-toggle"
        >
          <ReadinessList report={report} loading={loading} refresh={onRecheck} />
        </AdvancedFold>
      ) : null}
    </div>
  );
}

// ── Sync ──────────────────────────────────────────────────────────────────────────────────────

function hubHost(status) {
  try {
    return status?.url ? new URL(status.url).host : '';
  } catch {
    return '';
  }
}

/** 06 ad-trace steps 3-4: how far Resync got, then what it did. Quiet until a resync has run. */
function ResyncCard({ view }) {
  if (!view) return null;
  const running = view.state === 'running';
  const pct = resyncPercent(view);
  return (
    <div className="dg-resync" data-testid="diag-resync" data-state={view.state}>
      {running ? (
        <>
          <span
            className="dg-bar"
            role="progressbar"
            aria-label="Resync"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <i style={{ width: `${pct ?? 0}%` }} />
          </span>
          <span data-testid="diag-resync-progress">{resyncProgressText(view)}</span>
          <p className="dg-hint">
            You keep working; the status beside the faces says Syncing… until it’s done.
          </p>
        </>
      ) : (
        <>
          <span role="status" data-testid="diag-resync-result">
            {resyncResultText(view)}
          </span>
          <p className="dg-hint">
            {groupDigits(view.summary?.checked)} checked — the line is in Logs.
          </p>
        </>
      )}
    </div>
  );
}

function SyncView({ sync }) {
  const [latest, setLatest] = useState('');
  const [busy, setBusy] = useState(false);
  const [signInAt, setSignInAt] = useState(null);
  if (!sync.status) {
    return (
      <div className="dg-card" data-testid="diag-sync-solo">
        <div className="dg-hd">
          <strong>Sync</strong>
          <Word w={sync.word} />
        </div>
        <p className="dg-empty">
          This project isn’t linked to the cloud, so there is nothing to sync. Everything is on this
          Mac.
        </p>
      </div>
    );
  }
  const behind = Number(sync.behind) || 0;
  return (
    <div className="dg-sync" data-testid="diag-sync">
      <ResyncCard view={sync.resync} />
      {behind > 0 && sync.onGetLatest ? (
        <div className="dg-latest" data-testid="diag-get-latest-row">
          <span>
            {behind} new version{behind === 1 ? '' : 's'} from your team.
          </span>
          <button
            type="button"
            className="dg-btn dg-btn--primary"
            data-testid="diag-get-latest"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await sync.onGetLatest().catch(() => null);
              setBusy(false);
              setLatest(r?.ok ? 'Up to date with everyone.' : r?.error || '');
            }}
          >
            Get latest
          </button>
        </div>
      ) : null}
      {latest ? (
        <p className="dg-hint" role="status" data-testid="diag-get-latest-note">
          {latest}
        </p>
      ) : null}
      {/* S11.12 — Sync details (06 ad-syncd); the v1 Sync panel is no longer mounted here. */}
      <SyncDetails
        status={sync.status}
        project={sync.project}
        cloud={sync.cloud}
        native={sync.native ?? isNativeApp()}
        onSignInAgain={(url) => setSignInAt(url)}
      />
      {signInAt !== null ? (
        <TeamProjectsDialog
          title="Sign in again"
          initialServer={signInAt}
          onClose={() => setSignInAt(null)}
        />
      ) : null}
      {/* The terminal hints the old banners and Help named (ad-syncd "Hub, commands"). */}
      <AdvancedFold
        panel={DIAGNOSTICS_FOLD}
        label="Hub, commands"
        classes={DG_FOLD_CLASSES}
        testid="diag-sync-hints"
        buttonTestid="diag-sync-hints-toggle"
      >
        {hubHost(sync.status) ? (
          <Row id="hub" k="Hub" mono copy={hubHost(sync.status)} onCopy={sync.onCopy}>
            {hubHost(sync.status)}
          </Row>
        ) : null}
        <p className="dg-hint">Terminal — the same status</p>
        <code className="dg-cmd">maude design status</code>
        <p className="dg-hint">Claude Code — undo a canvas from its history</p>
        <code className="dg-cmd">/design:rollback &lt;canvas&gt;</code>
      </AdvancedFold>
    </div>
  );
}

// ── The sheet ─────────────────────────────────────────────────────────────────────────────────

/**
 * @param view 'logs' | 'server' | 'ai' | 'sync'
 * @param words `{ sync, server, ai }` status words (diagnostics-model `menuStatuses`)
 * @param data `GET /_api/diagnostics` payload or null; `error` its failure sentence
 * @param ai `{ report, loading, recheck }`
 * @param sync `{ status, project, cloud, groupPaths, behind, onGetLatest, word, resync }`
 *   (`resync` = the server's trace of the last Resync, or null)
 * @param onCopyLogs `(lines) => void` — "Copy all" (S11.11: the lines as shown, not the report)
 * @param onReveal `() => void` or null — "Show in Finder" (native only)
 */
export default function DiagnosticsSheet({
  view,
  onView,
  onClose,
  words,
  data,
  error,
  onRefresh,
  onCopyLogs,
  onReveal,
  onCopy,
  info,
  wsConnected,
  activePath,
  isSystem,
  repoChanged,
  ai,
  sync,
}) {
  // V2-4 gate (a11y W3): a floating, NON-modal sheet — esc closes it, focus goes back to the opener (it
  // used to drop to BODY); Tab is not trapped (the shell stays usable beside it).
  const ref = useModalFocus({ onClose, modal: false });
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="dg-sheet island"
      role="dialog"
      aria-label="Diagnostics"
      data-testid="diagnostics-sheet"
      data-view={view}
      data-occludes="right"
    >
      <header className="dg-top">
        <strong className="dg-title">Diagnostics</strong>
        <div
          className="dg-tabs"
          role="tablist"
          aria-label="Diagnostics"
          tabIndex={-1}
          onKeyDown={(e) =>
            rovingTabKey(
              e,
              TABS.map(([id]) => id),
              view,
              onView
            )
          }
        >
          {TABS.map(([id, label]) => (
            <button
              type="button"
              key={id}
              role="tab"
              className="dg-tab"
              aria-selected={view === id}
              tabIndex={view === id ? 0 : -1}
              data-testid={`diag-tab-${id}`}
              onClick={() => onView(id)}
            >
              {label}
              {words?.[id] ? <Word w={words[id]} /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="dg-x"
          aria-label="Close Diagnostics"
          data-testid="diagnostics-close"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="dg-body" role="tabpanel">
        {view === 'logs' ? (
          <LogsView
            data={data}
            error={error}
            onRefresh={onRefresh}
            onCopyLogs={onCopyLogs}
            onReveal={onReveal}
          />
        ) : null}
        {view === 'server' ? (
          <ServerView
            status={words?.server}
            wsConnected={wsConnected}
            activePath={activePath}
            isSystem={isSystem}
            info={info}
            repoChanged={repoChanged}
            onCopy={onCopy}
          />
        ) : null}
        {view === 'ai' ? (
          <AiView
            status={words?.ai}
            report={ai.report}
            loading={ai.loading}
            onRecheck={ai.recheck}
          />
        ) : null}
        {view === 'sync' ? <SyncView sync={sync} /> : null}
      </div>
    </section>
  );
}
