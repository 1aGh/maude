// SetupChecklist — DDR-166 plan, Phase 2 (T7/T8). Design-setup progress surface
// (project / design system / first canvas / brand assets), mirroring
// ReadinessList.jsx's shape but backed by GET /_api/setup-readiness instead of
// /_api/preflight. Pure detect-and-guide: never installs or mutates anything.
//
// "Bring my existing brand" (T8) now opens the real in-app ingestion panel
// (T12, DDR-173) — `onBringBrand` is threaded down the same way `onStartTour`
// already is; when absent (an older mount site not yet updated), falls back
// to the public docs link this used to be a stub for.

import { useCallback, useEffect, useState } from 'react';

/** Fetch + cache the design-setup readiness report. `refresh()` re-probes. */
export function useSetupReadiness(enabled = true) {
  const [report, setReport] = useState(null); // { ready, items } | null
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(() => {
    setLoading(true);
    return fetch('/_api/setup-readiness')
      .then((r) => r.json())
      .then((d) => {
        setReport(d && Array.isArray(d.items) ? d : null);
        setLoading(false);
        return d;
      })
      .catch(() => {
        setReport(null);
        setLoading(false);
        return null;
      });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetch('/_api/setup-readiness')
      .then((r) => r.json())
      .then((d) => alive && (setReport(d && Array.isArray(d.items) ? d : null), setLoading(false)))
      .catch(() => alive && (setReport(null), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { report, loading, refresh };
}

function StatusIcon({ present }) {
  if (present)
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="3 8.4 6.4 11.8 13 4.4" />
      </svg>
    );
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}

export function SetupChecklist({
  report,
  loading,
  refresh,
  onStartTour,
  onBringBrand,
  onImportFigma,
}) {
  return (
    <div className="setup-cl">
      <ul className="setup-cl-list">
        {report?.items?.map((it) => (
          <li
            key={it.id}
            className={`setup-cl-row setup-cl-row--${it.status}`}
            data-testid={`setup-cl-row-${it.id}`}
          >
            <span className="setup-cl-ic" aria-hidden="true">
              <StatusIcon present={it.status === 'present'} />
            </span>
            <span className="setup-cl-tx">
              <span className="setup-cl-label">{it.label}</span>
              <span className="setup-cl-detail">{it.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="setup-cl-foot">
        {onStartTour && (
          <button
            type="button"
            data-testid="setup-cl-start-tour"
            className="btn btn--primary btn--sm"
            onClick={onStartTour}
          >
            Start guided setup
          </button>
        )}
        {onBringBrand ? (
          <button
            type="button"
            data-testid="onboarding-bring-brand"
            className="btn btn--ghost btn--sm setup-cl-brand"
            onClick={onBringBrand}
          >
            Bring my existing brand
          </button>
        ) : (
          <a
            href="https://maude.sh/docs/getting-started"
            target="_blank"
            rel="noreferrer noopener"
            data-testid="onboarding-bring-brand"
            className="btn btn--ghost btn--sm setup-cl-brand"
          >
            Bring my existing brand
          </a>
        )}
        {onImportFigma && (
          <button
            type="button"
            data-testid="onboarding-import-figma"
            className="btn btn--ghost btn--sm"
            onClick={onImportFigma}
          >
            Import from Figma
          </button>
        )}
        {refresh && (
          <button
            type="button"
            className="btn btn--ghost btn--sm setup-cl-recheck"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        )}
      </div>
    </div>
  );
}

// Standalone modal, reachable from Help ▸ Quick setup… — reuses the shared
// help-modal chrome (backdrop + header + body), same shape as ReadinessDialog.
export default function SetupChecklistDialog({
  open,
  onClose,
  onStartTour,
  onBringBrand,
  onImportFigma,
}) {
  const { report, loading, refresh } = useSetupReadiness(open);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-modal setup-cl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-cl-modal-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="setup-cl-modal-title">
            Quick setup
          </span>
          <button
            type="button"
            className="help-modal-close"
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="help-modal-body">
          <p className="setup-cl-note">
            Empty → design system → first canvas → your first AI edit. Ask the Assistant to build
            each step, or take the guided tour to see where everything lives.
          </p>
          {report ? (
            <SetupChecklist
              report={report}
              loading={loading}
              refresh={refresh}
              onStartTour={
                onStartTour
                  ? () => {
                      onClose();
                      onStartTour();
                    }
                  : undefined
              }
              onBringBrand={
                onBringBrand
                  ? () => {
                      onClose();
                      onBringBrand();
                    }
                  : undefined
              }
              onImportFigma={
                onImportFigma
                  ? () => {
                      onClose();
                      onImportFigma();
                    }
                  : undefined
              }
            />
          ) : (
            <p className="setup-cl-note">
              {loading ? 'Checking…' : "Couldn't reach the setup probe."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
