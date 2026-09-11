// export-center.jsx — background export notification center
// (feature-background-export-notification-center).
//
//   useExportCenter()  → headless handle (hydrate + WS upsert + toast/panel state)
//   <ExportBadge>      → menubar entry point (busy pulse + running/queued count)
//   <ExportToast>       → completion notice (bottom-left, mirrors WhatsNewToast)
//   <ExportPanel>       → job list (reuses the help-modal backdrop)
//
// Structurally a near-exact twin of whats-new.jsx, but driven by live WS
// `export:job` pushes (via `upsert`, called from app.jsx's WS message handler)
// instead of a static feed. Styling lives in client/styles/3-shell-maude.css
// (`.st-exports`) and 4-components.css (`.st-export-*`).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dismissNotice, notify, summarizeNoticeText } from '../notifications.tsx';
import { isNativeApp, saveExport } from './github.js';

const FORMAT_LABELS = {
  png: 'PNG',
  pdf: 'PDF',
  svg: 'SVG',
  html: 'HTML',
  pptx: 'PPTX',
  canva: 'Canva',
  zip: 'ZIP',
  mp4: 'MP4',
  webm: 'WebM',
  gif: 'GIF',
};
const SCOPE_LABELS = {
  selection: 'Selection',
  artboard: 'Artboard',
  'canvas-as-separate': 'Canvas → separate',
  'project-raw': 'Project (raw)',
};

async function fetchJobBytes(id) {
  const r = await fetch(`/_api/export-jobs/download?id=${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const disp = r.headers.get('Content-Disposition') || '';
  const filename = /filename="([^"]+)"/.exec(disp)?.[1] || null;
  const blob = await r.blob();
  return { blob, filename };
}

async function autoDownloadBlob(id, fallbackName) {
  const got = await fetchJobBytes(id);
  if (!got) return;
  const filename = got.filename || fallbackName || 'export';
  const url = URL.createObjectURL(got.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Native "Save…" — unlike the web `download()` path, this does NOT fetch the
// job's bytes into the renderer first. `save_export` fetches them itself
// (RCA issue-desktop-print-pdf-save-as-hang-large-payload: routing a
// hundreds-of-MB export through a JS Uint8Array + Tauri's JSON IPC froze the
// app), so all this needs is the filename already carried on the job record.
async function saveNative(id, filename) {
  return saveExport(filename || 'export', id);
}

/**
 * @param {{ enabled?: boolean }} [opts] — `enabled` false suppresses the
 *   hydration fetch. The cloud shell passes false: `/_api/export-jobs` is
 *   refused there by design, so asking is guaranteed noise. It stays UNDEFINED
 *   until `/_config` answers, and undefined is not "false" here — see the
 *   tri-state note on `cfg.cloud`.
 */
export function useExportCenter({ enabled = true } = {}) {
  const [jobs, setJobs] = useState(() => new Map());
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [toastQueue, setToastQueue] = useState([]);
  const [savingIds, setSavingIds] = useState(() => new Set());
  const prevStatusRef = useRef(new Map());
  // Dedup guards (not state — re-rendering on these changing would be
  // pointless; they only gate one-shot side effects).
  const finalizedRef = useRef(new Set()); // auto-download fires at most once per job
  const startToastShownRef = useRef(new Set()); // "Exporting…" toast fires at most once per job

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetch('/_api/export-jobs')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const m = new Map();
        for (const job of Array.isArray(j?.jobs) ? j.jobs : []) {
          m.set(job.id, job);
          // Hydration is a SNAPSHOT, not a live transition — seed both guards
          // so a page (re)load never replays a toast / auto-download for a
          // job that already reached this status before we opened.
          prevStatusRef.current.set(job.id, job.status);
          startToastShownRef.current.add(job.id);
        }
        setJobs(m);
      })
      .catch(() => {
        /* offline / restart — the badge just stays empty until a push arrives */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const upsert = useCallback((job) => {
    if (!job || typeof job.id !== 'string') return;
    setJobs((prev) => {
      const next = new Map(prev);
      next.set(job.id, job);
      return next;
    });
  }, []);

  // One toast per job, morphing in place as the job's live status changes
  // (queued/running → done/failed) rather than stacking a separate "started"
  // and "finished" toast. Detects two kinds of transitions:
  //   - first time a job is seen active (queued/running) → surfaces it so the
  //     user knows it's running in the background right after the dialog closes.
  //   - a done/failed transition → surfaces it (or refreshes it in place if
  //     it's still the front-of-queue toast from the "started" step above).
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const toSurface = [];
    const justFinished = [];
    // Single pass — read `was` for every job BEFORE prevStatus gets mutated
    // below, so both the toast + auto-download decisions see the real
    // "did this change just now" transition, not an already-updated ref.
    for (const job of jobs.values()) {
      const was = prevStatus.get(job.id);
      const isActive = job.status === 'queued' || job.status === 'running';
      const isFinished = job.status === 'done' || job.status === 'failed';
      if (was === undefined && isActive && !startToastShownRef.current.has(job.id)) {
        startToastShownRef.current.add(job.id);
        toSurface.push(job.id);
      } else if (was !== job.status && isFinished) {
        toSurface.push(job.id);
        justFinished.push(job);
      }
    }
    for (const job of jobs.values()) prevStatus.set(job.id, job.status);

    if (toSurface.length) {
      setToastQueue((q) => {
        const merged = q.filter((id) => !toSurface.includes(id));
        return [...toSurface, ...merged];
      });
    }

    // Native (Tauri) never auto-pops the OS save dialog — it would interrupt
    // whatever the user is doing elsewhere. Always an explicit "Save…" click.
    if (isNativeApp() || !justFinished.length) return;
    for (const job of justFinished) {
      if (job.status !== 'done') continue;
      if (finalizedRef.current.has(job.id)) continue;
      // Focus-gated: avoids duplicate downloads when multiple tabs share one
      // dev-server and both receive the same WS push.
      if (!document.hasFocus()) continue;
      finalizedRef.current.add(job.id);
      void autoDownloadBlob(job.id, job.filename);
    }
  }, [jobs]);

  const list = useMemo(
    () =>
      Array.from(jobs.values()).sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || '')
      ),
    [jobs]
  );
  const runningCount = list.filter((j) => j.status === 'running').length;
  const queuedCount = list.filter((j) => j.status === 'queued').length;

  const dismissToast = useCallback(
    (id) => setToastQueue((q) => q.filter((item) => item !== (id ?? q[0]))),
    []
  );
  const openPanel = useCallback((jobId) => {
    setSelectedJobId(typeof jobId === 'string' ? jobId : null);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const withSaving = useCallback(async (job, fn) => {
    setSavingIds((prev) => new Set(prev).add(job.id));
    try {
      await fn();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  }, []);

  // Manual "Download" (web, unfocused-tab fallback) / "Save…" (native) — the
  // toast/panel row action. Both mark the job finalized so the focus-gated
  // auto-download effect above doesn't ALSO fire for it later, and both track
  // a busy state (`savingIds`) so the button can show it's working instead of
  // going silent while the bytes fetch + (for native) the OS dialog opens.
  const download = useCallback(
    async (job) => {
      finalizedRef.current.add(job.id);
      await withSaving(job, () => autoDownloadBlob(job.id, job.filename));
    },
    [withSaving]
  );
  const save = useCallback(
    async (job) => {
      finalizedRef.current.add(job.id);
      await withSaving(job, () => saveNative(job.id, job.filename));
    },
    [withSaving]
  );

  const toastJobId = panelOpen ? null : (toastQueue[0] ?? null);

  return {
    jobs: list,
    upsert,
    runningCount,
    queuedCount,
    busyCount: runningCount + queuedCount,
    panelOpen,
    selectedJobId,
    toastJobs: toastQueue.map((id) => jobs.get(id)).filter(Boolean),
    openPanel,
    closePanel,
    showToast: !!toastJobId,
    toastJob: toastJobId ? (jobs.get(toastJobId) ?? null) : null,
    dismissToast,
    download,
    save,
    savingIds,
  };
}

function jobLabel(job) {
  const fmt = FORMAT_LABELS[job.format] || String(job.format || '').toUpperCase();
  const scope = SCOPE_LABELS[job.scope] || job.scope;
  return `${fmt} · ${scope}`;
}

// Native "Save…" opens the OS file picker; web "Download" streams a blob
// through <a download> — distinct verbs, so the busy label stays distinct too
// (the fetch-bytes step behind both can take several seconds on a large export).
function saveActionLabel(saving) {
  if (isNativeApp()) return saving ? 'Saving…' : 'Save…';
  return saving ? 'Downloading…' : 'Download';
}

function ProgressBar({ progress }) {
  if (!progress || !progress.total) {
    return (
      <div className="st-export-progress st-export-progress--indeterminate" aria-hidden="true" />
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
  return (
    <div
      className="st-export-progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="st-export-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Per-job anchor for the ETA: the FIRST progress sample the client sees. For a
// video export that's the first frame-step frame — after the (progress-less)
// renderMediaOnWeb attempt — so the rate is measured over real capture work and
// isn't skewed by that pre-roll. Keyed by job id; cleared when the job ends.
const etaAnchors = new Map();

/** Rough "~N min left" from the rate since the first observed progress sample.
 *  Recomputes on every progress update (frame-step emits ~1–2/s), so it ticks
 *  down live without a timer. Returns null until there's enough delta to trust. */
function etaLabel(job) {
  const cur = job.progress?.current;
  const total = job.progress?.total;
  if (!cur || !total || cur >= total) {
    etaAnchors.delete(job.id);
    return null;
  }
  let anchor = etaAnchors.get(job.id);
  if (!anchor || cur < anchor.c) {
    anchor = { t: Date.now(), c: cur };
    etaAnchors.set(job.id, anchor);
  }
  const doneSinceAnchor = cur - anchor.c;
  if (doneSinceAnchor < 3) return null; // need a few frames to estimate a rate
  const remainingMs = ((Date.now() - anchor.t) / doneSinceAnchor) * (total - cur);
  if (remainingMs < 45_000) return '<1 min left';
  return `~${Math.round(remainingMs / 60_000)} min left`;
}

function StatusPill({ job }) {
  // A degraded export is `done` — the file is real — but it is NOT clean, and a
  // plain "Ready" pill is exactly how a muted mp4 shipped unnoticed for four
  // attempts (RCA issue-mp4-audio-export-html5audio-silent-degrade).
  const degraded = job.status === 'done' && !!job.degraded;
  const statusText =
    job.status === 'queued'
      ? 'Queued'
      : job.status === 'running'
        ? job.progress?.total
          ? `${job.progress.current} of ${job.progress.total}`
          : 'Rendering…'
        : job.status === 'done'
          ? degraded && job.degraded.audioDropped
            ? 'Ready · no audio'
            : degraded && job.degraded.fontsNotEmbedded?.length
              ? 'Ready · font warning'
              : degraded
                ? 'Ready · degraded'
                : 'Ready'
          : 'Failed';
  const eta = job.status === 'running' ? etaLabel(job) : null;
  return (
    <span
      className={`st-export-pill st-export-pill--${job.status}${
        degraded ? ' st-export-pill--degraded' : ''
      }`}
    >
      {statusText}
      {eta ? ` · ${eta}` : ''}
    </span>
  );
}

/**
 * The "your file is missing something" row. Rendered on a `done` job that came
 * back degraded — in the panel row and in the completion toast, because the
 * whole failure mode of this bug was that neither surface said anything.
 */
function DegradedNote({ degraded, compact = false }) {
  if (!degraded) return null;
  // The font case names the fonts, because "reduced fidelity" is useless to
  // someone about to send this to a printer — what they need is which faces
  // came out unprintable (issue #116).
  const fonts = degraded.fontsNotEmbedded ?? [];
  const headline = degraded.audioDropped
    ? 'Exported without audio.'
    : fonts.length
      ? `Fonts a print shop will reject: ${fonts.join(', ')}.`
      : 'Exported with reduced fidelity.';
  return (
    <div className="st-export-degraded" data-testid="export-degraded-note">
      <span aria-hidden="true">!</span> {compact ? summarizeNoticeText(headline) : headline}
      {degraded.remedy ? (
        <div className="st-export-degraded__fix">
          {compact ? summarizeNoticeText(degraded.remedy) : degraded.remedy}
        </div>
      ) : null}
    </div>
  );
}

export function ExportBadge({ center }) {
  const busy = center.busyCount > 0;
  return (
    <button
      type="button"
      className="st-exports"
      data-tour="exports"
      data-busy={busy ? 'true' : 'false'}
      aria-label={busy ? `Exports — ${center.busyCount} running` : 'Exports'}
      data-tip="Exports"
      onClick={center.openPanel}
    >
      <span aria-hidden="true">⬇</span>
      {busy && (
        <span className="st-exports__count" aria-hidden="true">
          {center.busyCount}
        </span>
      )}
    </button>
  );
}

function ExportJobNotice({ job, center }) {
  const pending = job.status === 'queued' || job.status === 'running';
  const ok = job.status === 'done';
  const saving = center.savingIds.has(job.id);
  const id = `export-${job.id}`;
  useEffect(() => {
    notify({
      id,
      group: 'exports',
      title: pending
        ? 'Exporting…'
        : ok
          ? job.degraded
            ? 'Export ready — with a problem'
            : 'Export ready'
          : 'Export failed',
      description: pending
        ? 'Running in the background — you can keep working.'
        : ok
          ? (job.filename ?? 'Ready to download.')
          : (job.error ?? 'Something went wrong.'),
      kind: pending ? 'info' : ok ? (job.degraded ? 'warning' : 'success') : 'error',
      duration: pending ? Infinity : undefined,
      timerKey: pending ? 'active' : job.status,
      paused: saving,
      onDismiss: () => center.dismissToast(job.id),
      content: (
        <>
          <div className="maude-notice-summary">{jobLabel(job)}</div>
          {pending && <ProgressBar progress={job.progress} />}
          {ok && <DegradedNote degraded={job.degraded} compact />}
          <div className="st-toast-actions">
            {ok && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={saving}
                onClick={() => (isNativeApp() ? void center.save(job) : void center.download(job))}
              >
                {saving && <span className="st-btn-spin" aria-hidden="true" />}
                {saveActionLabel(saving)}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => center.openPanel(job.id)}
            >
              View in history
            </button>
          </div>
        </>
      ),
    });
  }, [
    id,
    job,
    pending,
    ok,
    saving,
    center.dismissToast,
    center.openPanel,
    center.save,
    center.download,
  ]);
  useEffect(() => () => dismissNotice(id), [id]);
  return null;
}

export function ExportToast({ center }) {
  return center.toastJobs.map((job) => <ExportJobNotice key={job.id} job={job} center={center} />);
}

export function ExportPanel({ center }) {
  const { panelOpen, closePanel, selectedJobId } = center;
  const selectedRow = useRef(null);
  useEffect(() => {
    if (panelOpen && selectedJobId) {
      selectedRow.current?.scrollIntoView?.({ block: 'nearest' });
      selectedRow.current?.focus();
    }
  }, [panelOpen, selectedJobId]);
  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') closePanel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  if (!panelOpen) return null;
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      <div
        className="st-export-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-export-panel-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="st-export-panel-title">
            Exports
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
        <div className="st-export-panel__body">
          {center.jobs.length === 0 ? (
            <p className="mdcc-wn-empty">No exports yet.</p>
          ) : (
            <ul className="st-export-list">
              {center.jobs.map((job) => (
                <li
                  key={job.id}
                  className="st-export-item"
                  data-testid={`export-job-${job.id}`}
                  ref={job.id === selectedJobId ? selectedRow : null}
                  tabIndex={-1}
                >
                  <div className="st-export-item__hd">
                    <span className="st-export-item__label">{jobLabel(job)}</span>
                    <StatusPill job={job} />
                  </div>
                  {(job.status === 'queued' || job.status === 'running') && (
                    <ProgressBar progress={job.progress} />
                  )}
                  {job.status === 'done' && <DegradedNote degraded={job.degraded} />}
                  {job.status === 'done' && (
                    <div className="st-export-item__ft">
                      <span className="st-export-item__filename">{job.filename}</span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={center.savingIds.has(job.id)}
                        onClick={() => (isNativeApp() ? center.save(job) : center.download(job))}
                      >
                        {center.savingIds.has(job.id) && (
                          <span className="st-btn-spin" aria-hidden="true" />
                        )}
                        {saveActionLabel(center.savingIds.has(job.id))}
                      </button>
                    </div>
                  )}
                  {job.status === 'failed' && (
                    <div className="st-export-item__ft">
                      <details className="st-export-item__error">
                        <summary>Show error details</summary>
                        <pre>{job.error ?? 'Export failed.'}</pre>
                      </details>
                    </div>
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
