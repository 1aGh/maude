// client/v2/export/job-row.jsx — S8.4: one export, as one row (09 Export ex-progress / ex-history).
//
// A row says what it is, where it runs ("On this Mac" / "In the cloud"), how far along it is — in
// words — and gives the next move: a finished export opens its folder (Show in Finder on the Mac app,
// Download in a browser) or runs again; one that did not fully make it says "Exported 114 of 115" and
// Retry <name> runs only that item. The v1 hooks stay: `export-job-<id>` is the row (focusable, so the
// toast's "Open Exports" lands on it), `export-degraded-note` the problem line, and a failed row keeps
// its error behind a "Show error details" fold.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { summarizeNoticeText } from '../../../notifications.tsx';
import { StIcon } from '../../shell/icons.jsx';
import {
  DOWNLOAD,
  EXPORT_AGAIN,
  jobMenuItems,
  jobMeta,
  jobTitle,
  MORE,
  progressPct,
  retryLabel,
  SHOW_IN_FINDER,
  stateWord,
  whereOf,
} from './exports-model.js';
import { isQueuedCloud, RENDER_HERE } from './cloud-queue.js';

// Per-job anchor for the ETA: the FIRST progress sample the client sees. For a video export that is
// the first frame-step frame — after the (progress-less) renderMediaOnWeb attempt — so the rate is
// measured over real capture work. Keyed by job id; cleared when the job ends.
const etaAnchors = new Map();

/** Rough "~N min left" from the rate since the first observed progress sample; null until it can tell. */
export function etaLabel(job, now = Date.now()) {
  const cur = job.progress?.current;
  const total = job.progress?.total;
  if (!cur || !total || cur >= total) {
    etaAnchors.delete(job.id);
    return null;
  }
  let anchor = etaAnchors.get(job.id);
  if (!anchor || cur < anchor.c) {
    anchor = { t: now, c: cur };
    etaAnchors.set(job.id, anchor);
  }
  const doneSinceAnchor = cur - anchor.c;
  if (doneSinceAnchor < 3) return null; // need a few frames to estimate a rate
  const remainingMs = ((now - anchor.t) / doneSinceAnchor) * (total - cur);
  if (remainingMs < 45_000) return '<1 min left';
  return `~${Math.round(remainingMs / 60_000)} min left`;
}

export function ProgressBar({ pct }) {
  if (pct === null || pct === undefined) {
    return (
      <div className="ex-export-progress ex-export-progress--indeterminate" aria-hidden="true" />
    );
  }
  return (
    <div
      className="ex-export-progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="ex-export-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The "your file is missing something" line. Rendered on a `done` job that came back degraded — in the
 * row and in the completion toast, because the whole failure mode of the muted-mp4 bug was that
 * neither surface said anything.
 */
export function DegradedNote({ degraded, compact = false }) {
  if (!degraded) return null;
  // The font case names the fonts, because "reduced fidelity" is useless to someone about to send this
  // to a printer — what they need is which faces came out unprintable (issue #116).
  const fonts = degraded.fontsNotEmbedded ?? [];
  const headline = degraded.audioDropped
    ? 'Exported without audio.'
    : fonts.length
      ? `Fonts a print shop will reject: ${fonts.join(', ')}.`
      : 'Exported with reduced fidelity.';
  return (
    <div className="ex-export-degraded" data-testid="export-degraded-note">
      <span aria-hidden="true">!</span> {compact ? summarizeNoticeText(headline) : headline}
      {degraded.remedy ? (
        <div className="ex-export-degraded__fix">
          {compact ? summarizeNoticeText(degraded.remedy) : degraded.remedy}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 09 ex-history — the finished row's menu (the board's `Menu`): fixed under the "More" button so the panel's own
 * scroll never clips it; ↑ ↓ move, Esc or a click outside closes it (Esc stops there, the panel stays open).
 */
function RowMenu({ job, native, on, anchorRef, onClose }) {
  const ref = useRef(null);
  const [at, setAt] = useState(null);
  const items = jobMenuItems(job, { native });
  useLayoutEffect(() => {
    const a = anchorRef.current?.getBoundingClientRect?.();
    const w = ref.current?.offsetWidth || 260;
    if (!a) return;
    const left = Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8));
    const h = ref.current?.scrollHeight || 200;
    const below = a.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - 4 - h) : below;
    setAt({ left, top });
  }, [anchorRef]);
  useEffect(() => {
    const el = ref.current;
    el?.querySelector('button:not([disabled])')?.focus();
    const onPointer = (e) => {
      if (el && !el.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus?.();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = Array.from(el?.querySelectorAll('button:not([disabled])') ?? []);
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[n]?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchorRef, onClose]);
  const run = (id) => {
    onClose();
    if (id === 'reveal') (native ? on?.reveal : on?.download)?.(job);
    else if (id === 'again') on?.again?.(job);
    else if (id === 'again-with') on?.againWith?.(job);
    else if (id === 'copy-names') on?.copyNames?.(job);
    else if (id === 'remove') on?.remove?.(job);
  };
  return (
    <div
      ref={ref}
      className="sh-dropdown ex-job-menu"
      role="menu"
      aria-label={`Actions for ${jobTitle(job)}`}
      data-testid={`export-job-menu-${job.id}`}
      style={{
        position: 'fixed',
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        visibility: at ? 'visible' : 'hidden',
      }}
    >
      {items.map((it) =>
        it.separator ? (
          <hr key={it.id} className="sh-dd-sep" style={{ border: 0 }} />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className="sh-dd-item"
            disabled={it.disabled}
            data-testid={`export-job-menu-${it.id}-${job.id}`}
            onClick={() => run(it.id)}
          >
            <span className="sh-dd-lead">
              {it.icon ? <StIcon name={it.icon} size={14} /> : null}
              {it.label}
            </span>
          </button>
        )
      )}
    </div>
  );
}

function StateWord({ job }) {
  const word = stateWord(job);
  if (!word) return null;
  const kind =
    job.status === 'failed'
      ? 'fail'
      : job.status === 'queued'
        ? 'queued'
        : job.degraded
          ? 'warn'
          : 'done';
  return (
    <span className={`ex-job-w ex-job-w--${kind}`} data-testid={`export-job-state-${job.id}`}>
      <StIcon name={kind === 'done' ? 'check' : kind === 'queued' ? 'sync' : 'problem'} size={12} />
      {word}
    </span>
  );
}

/**
 * @param job      the export job
 * @param selected the row to focus when the panel opens on it
 * @param native   a Mac app: Show in Finder; a browser tab downloads instead
 * @param busy     this job's bytes are being fetched or saved
 * @param on       { reveal(job), download(job), again(job), retry(job) }
 */
export function JobRow({
  job,
  selected = false,
  native = false,
  busy = false,
  on,
  now,
  cover = null,
}) {
  const ref = useRef(null);
  const moreRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
    ref.current?.focus();
  }, [selected]);

  const active = job.status === 'queued' || job.status === 'running';
  const finished = !active;
  const retry = finished ? retryLabel(job) : null;
  const eta = job.status === 'running' ? etaLabel(job, now) : null;
  const meta = jobMeta(job, { now, eta });
  const warn = job.status === 'failed' || job.degraded || retry;
  const hasFile = job.status === 'done' && !job.deliveredInBrowser && job.filename;
  const pct = active ? progressPct(job) : null;

  return (
    <div
      ref={ref}
      className={`ex-job${warn ? ' ex-job--warn' : ''}`}
      data-testid={`export-job-${job.id}`}
      data-state={job.status}
      data-where={whereOf(job)}
      tabIndex={-1}
    >
      <div className="ex-job-main">
        {/* 09 ex-progress: the row's picture — the canvas it was made from; the format's glyph when it has none */}
        <span
          className="ex-job-thumb"
          data-testid={`export-job-thumb-${job.id}`}
          aria-hidden="true"
        >
          {cover ? (
            <img src={cover} alt="" loading="lazy" draggable={false} />
          ) : (
            <StIcon name="export" size={14} />
          )}
        </span>
        <span className="ex-job-t">
          <span className="ex-job-n" title={job.filename || undefined}>
            {jobTitle(job)}
          </span>
          <span className="ex-job-m" data-testid={`export-job-meta-${job.id}`} title={meta}>
            <StIcon name={whereOf(job) === 'cloud' ? 'cloud' : 'laptop'} size={11} />
            {meta}
          </span>
          {active ? <ProgressBar pct={pct} /> : null}
        </span>
        {retry ? (
          <button
            type="button"
            className="btn btn--sm ex-retry"
            data-testid={`export-job-retry-${job.id}`}
            onClick={() => on.retry(job)}
          >
            {retry}
          </button>
        ) : isQueuedCloud(job) && on?.renderHere ? (
          <button
            type="button"
            className="btn btn--sm ex-retry"
            data-testid={`export-job-here-${job.id}`}
            disabled={busy}
            onClick={() => on.renderHere(job)}
          >
            {RENDER_HERE}
          </button>
        ) : (
          <StateWord job={job} />
        )}
        {finished ? (
          <span className="ex-job-acts">
            {hasFile ? (
              <button
                type="button"
                className="icon-btn k-icon-sm"
                data-testid={`export-job-reveal-${job.id}`}
                title={native ? SHOW_IN_FINDER : DOWNLOAD}
                aria-label={native ? SHOW_IN_FINDER : DOWNLOAD}
                disabled={busy}
                onClick={() => (native ? on.reveal(job) : on.download(job))}
              >
                <StIcon name={native ? 'folder' : 'download'} size={14} />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-btn k-icon-sm"
              data-testid={`export-job-again-${job.id}`}
              title={EXPORT_AGAIN}
              aria-label={EXPORT_AGAIN}
              onClick={() => on.again(job)}
            >
              <StIcon name="sync" size={14} />
            </button>
            <button
              ref={moreRef}
              type="button"
              className={`icon-btn k-icon-sm${menuOpen ? ' ex-on' : ''}`}
              data-testid={`export-job-more-${job.id}`}
              title={MORE}
              aria-label={MORE}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <StIcon name="more" size={14} />
            </button>
          </span>
        ) : null}
        {finished && menuOpen ? (
          <RowMenu
            job={job}
            native={native}
            on={on}
            anchorRef={moreRef}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}
      </div>
      {job.status === 'done' ? <DegradedNote degraded={job.degraded} /> : null}
      {job.status === 'failed' ? (
        <details className="ex-export-item__error">
          <summary>Show error details</summary>
          <pre>{job.error ?? 'Export failed.'}</pre>
        </details>
      ) : null}
    </div>
  );
}
