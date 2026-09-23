// Phase 27 (epic E2) Task 7 — visual before/after diff + conflict resolver.
//
// Built from `.design/ui/DiffView.tsx` (side-by-side · overlay/slider · Keep
// mine/theirs/both). The Maude differentiator: a RENDERED before/after of the
// actual canvas, not a text diff. Each pane renders a CLEAN canvas (hide-chrome:
// no editor toolbar/minimap/devtools) — "after" = the working tree, "before" =
// a past version via `?sha=` — inside a SHARED, LOCKED zoom/pan view: scroll to
// zoom, drag to pan, both panes track the exact same region. Keep both is the
// default conflict resolution (zero data loss).

import { useEffect, useRef, useState } from 'react';

import { canvasUrl } from '../canvas-url.js';

const ICONS = {
  x: (
    <>
      <line x1="4.3" y1="4.3" x2="11.7" y2="11.7" />
      <line x1="11.7" y1="4.3" x2="4.3" y2="11.7" />
    </>
  ),
  file: (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <polyline points="9 2 9 5 12 5" />
    </>
  ),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  split: (
    <>
      <line x1="8" y1="2.5" x2="8" y2="13.5" />
      <polyline points="5 6 2.5 8 5 10" />
      <polyline points="11 6 13.5 8 11 10" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M3.5 13a4.5 4.5 0 0 1 9 0" />
    </>
  ),
  users: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <path d="M2.5 12.5a3.6 3.6 0 0 1 7 0" />
      <path d="M10.5 4.2a2.2 2.2 0 0 1 0 4.1" />
      <path d="M11 12.5a3.6 3.6 0 0 0-1.2-2.7" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="8" height="8" rx="1.2" />
      <path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5" />
    </>
  ),
};
function Icon({ name, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** The real app brand mark (same as the menubar — bordered message-bubble spark). */
function Brand() {
  return (
    <span className="st-brand">
      <span className="st-brand-mark">
        <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true">
          <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
        </svg>
      </span>
      <span className="st-brand-name">Maude</span>
    </span>
  );
}

function baseName(p) {
  const s = (p || '').split('/').pop() || p || '';
  return s.replace(/\.(tsx|html|meta\.json|css|svg|json)$/i, '');
}
function isRenderableCanvas(p) {
  return /\.(tsx|html)$/i.test(p || '');
}
function timeAgo(iso) {
  try {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d} days ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** A clean canvas iframe inside a zoom/pan viewport. `view` is the SHARED locked
 *  transform — both panes pass the same one, so dragging/zooming either moves
 *  both. The iframe is non-interactive (hide-chrome leaves nothing to click); the
 *  viewport owns scroll-to-zoom + drag-to-pan. */
function CanvasView({ src, view, setView, label }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [panning, setPanning] = useState(false);

  function onWheel(e) {
    if (!src) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setView((v) => {
      const scale = clamp(v.scale * Math.exp(-e.deltaY * 0.0015), 0.25, 8);
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }
  function onPointerDown(e) {
    if (!src || e.button !== 0) return;
    ref.current.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }
  function endPan(e) {
    if (!drag.current) return;
    drag.current = null;
    setPanning(false);
    try {
      ref.current.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  return (
    <div
      ref={ref}
      className={'dv-viewport' + (panning ? ' is-panning' : '')}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
    >
      {src ? (
        <div
          className="dv-frame-wrap"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <iframe className="dv-frame" src={src} title={label} />
        </div>
      ) : (
        <div className="dv-thumb-note">No saved version of this canvas to compare yet.</div>
      )}
    </div>
  );
}

function ZoomBar({ view, setView }) {
  const zoom = (factor) => setView((v) => ({ ...v, scale: clamp(v.scale * factor, 0.25, 8) }));
  return (
    <div className="dv-zoombar" role="group" aria-label="Zoom">
      <button type="button" className="dv-zoom-btn" aria-label="Zoom out" onClick={() => zoom(0.8)}>
        −
      </button>
      <button
        type="button"
        className="dv-zoom-val"
        title="Reset to 100%"
        aria-label="Reset zoom"
        onClick={() => setView({ scale: 1, x: 0, y: 0 })}
      >
        {Math.round(view.scale * 100)}%
      </button>
      <button type="button" className="dv-zoom-btn" aria-label="Zoom in" onClick={() => zoom(1.25)}>
        +
      </button>
      <span className="dv-zoom-sync" title="Both sides are locked together">
        locked
      </span>
    </div>
  );
}

const CHOICES = [
  { id: 'mine', icon: 'user', title: 'Keep mine', desc: 'Use your version. Their edits are set aside.' },
  {
    id: 'theirs',
    icon: 'users',
    title: 'Keep theirs',
    desc: 'Use the published version. Your edits are set aside.',
  },
  {
    id: 'both',
    icon: 'copy',
    title: 'Keep both',
    rec: true,
    desc: 'Keep theirs and save yours as a copy. Nothing is lost.',
  },
];

export default function DiffView({ target, cfg, loadLog, onResolve, onRestore, onClose }) {
  const [mode, setMode] = useState('side'); // 'side' | 'overlay'
  const [choice, setChoice] = useState('both');
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [split, setSplit] = useState(52);
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef(null);
  const overlayRef = useRef(null);

  // phase-27.1 — which saved version the "before" pane renders. Seeded from the
  // opener (History click passes a specific version; a plain compare passes
  // HEAD), then re-pointable in-place via the "Saved version" picker.
  const tgtFile = target?.file;
  const tgtBeforeSha = target?.beforeSha;
  const acceptedPreview = /^r\d+$/.test(tgtBeforeSha || '');
  const [beforeSha, setBeforeSha] = useState(tgtBeforeSha || 'HEAD');
  const [versions, setVersions] = useState(null); // per-file saved versions, or null while loading

  // Re-seed when the opener hands us a different file/version.
  useEffect(() => {
    setBeforeSha(tgtBeforeSha || 'HEAD');
  }, [tgtFile, tgtBeforeSha]);

  // Load the open file's saved versions for the picker (per-file History).
  useEffect(() => {
    if (!tgtFile || !loadLog) {
      setVersions(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = (await loadLog(tgtFile)) || [];
      if (!cancelled) setVersions(Array.isArray(entries) ? entries : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [tgtFile, loadLog]);

  useEffect(() => {
    if (!target) return;
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    sheetRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [target, onClose]);

  if (!target) return null;
  const { file, conflict } = target;
  const renderable = isRenderableCanvas(file);
  const opts = { thumbnail: true, hideChrome: true };
  const afterSrc = renderable ? canvasUrl(file, cfg, opts) : null;
  const beforeSrc = renderable ? canvasUrl(file, cfg, { ...opts, sha: beforeSha }) : null;
  // The picker offers "Last saved" (HEAD) + each per-file saved version. Shown
  // only in the compare view (not the conflict resolver) once history loads.
  const showPicker = !conflict && renderable && !!loadLog && !!(versions && versions.length);
  const selectedVersion =
    beforeSha !== 'HEAD' && versions ? versions.find((v) => v.sha === beforeSha) : null;
  const beforeWhen = selectedVersion ? timeAgo(selectedVersion.date) : 'last saved';

  function splitDrag(e) {
    const box = overlayRef.current?.getBoundingClientRect();
    if (!box) return;
    setSplit(clamp(((e.clientX - box.left) / box.width) * 100, 4, 96));
  }
  function onSplitDown(e) {
    e.preventDefault();
    const move = (ev) => splitDrag(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      className="st-scrim dv-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dv-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${conflict ? 'Resolve' : 'Compare'} ${baseName(file)}`}
        ref={sheetRef}
        tabIndex={-1}
      >
        <div className="dv-hd">
          <Brand />
          <span className="dv-title">
            {conflict ? 'You both changed this canvas' : 'What changed'}
          </span>
          <span className="dv-file">
            <Icon name="file" size={13} /> {baseName(file)}
          </span>
          <span className="dv-spacer" />
          {showPicker && (
            <label className="dv-verpick">
              <span className="dv-verpick-lbl">Compare against</span>
              <select
                data-testid="history-preview-version"
                className="dv-verpick-sel"
                value={beforeSha}
                onChange={(e) => setBeforeSha(e.target.value)}
                aria-label={`Saved version of ${baseName(file)} to compare against`}
              >
                {!acceptedPreview && <option value="HEAD">Last saved</option>}
                {versions.map((v) => (
                  <option key={v.sha} value={v.sha}>
                    {`${v.message || 'Saved version'} · ${timeAgo(v.date)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!conflict && renderable && (
            <div className="dv-seg" role="group" aria-label="Comparison mode">
              <button
                type="button"
                className="dv-seg-btn"
                aria-pressed={mode === 'side'}
                onClick={() => setMode('side')}
              >
                Side by side
              </button>
              <button
                type="button"
                className="dv-seg-btn"
                aria-pressed={mode === 'overlay'}
                onClick={() => setMode('overlay')}
              >
                Overlay
              </button>
            </div>
          )}
          <button type="button" className="dv-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {conflict ? (
          <>
            <div className="dv-pick-intro">
              <div className="callout callout--info">
                <span>
                  While you were working, someone published their own changes to{' '}
                  <strong style={{ color: 'var(--fg-0)' }}>{baseName(file)}</strong>. Pick which to
                  keep — <strong style={{ color: 'var(--fg-0)' }}>Keep both</strong> saves yours as a
                  copy so nothing is lost.
                </span>
              </div>
            </div>
            <div className="dv-stage">
              <ZoomBar view={view} setView={setView} />
              <div className="dv-pair">
                <div className="dv-col">
                  <div className="dv-col-hd">
                    <span className="dv-col-tag">
                      <Icon name="user" size={12} /> Yours
                    </span>
                    <span className="dv-col-who">you · just now</span>
                  </div>
                  <div className="dv-thumb ring-mine">
                    <CanvasView src={afterSrc} view={view} setView={setView} label="Your version" />
                  </div>
                </div>
                <div className="dv-col">
                  <div className="dv-col-hd">
                    <span className="dv-col-tag">
                      <Icon name="users" size={12} /> Theirs
                    </span>
                    <span className="dv-col-who">published</span>
                  </div>
                  <div className="dv-thumb ring-theirs">
                    <CanvasView
                      src={beforeSrc}
                      view={view}
                      setView={setView}
                      label="Published version"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="dv-picker" role="radiogroup" aria-label="How to resolve">
              {CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'dv-pick' + (choice === c.id ? ' is-rec' : '')}
                  role="radio"
                  aria-checked={choice === c.id}
                  tabIndex={choice === c.id ? 0 : -1}
                  onClick={() => setChoice(c.id)}
                  onKeyDown={(e) => {
                    // Arrow-key navigation for the radiogroup (roving tabindex —
                    // only the checked radio is a Tab stop, so arrows must move it).
                    const dir =
                      e.key === 'ArrowRight' || e.key === 'ArrowDown'
                        ? 1
                        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                          ? -1
                          : 0;
                    if (!dir) return;
                    e.preventDefault();
                    const i = CHOICES.findIndex((x) => x.id === choice);
                    const ni = (i + dir + CHOICES.length) % CHOICES.length;
                    setChoice(CHOICES[ni].id);
                    e.currentTarget.parentElement?.children[ni]?.focus();
                  }}
                >
                  <span className="dv-pick-hd">
                    <Icon name={c.icon} size={14} />
                    <span className="dv-pick-title">{c.title}</span>
                    {c.rec && <span className="dv-pick-rec">Default</span>}
                  </span>
                  <span className="dv-pick-desc">{c.desc}</span>
                </button>
              ))}
            </div>
            <div className="dv-ft">
              <span className="dv-note">
                You can change your mind later — both versions stay in History.
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onResolve?.(choice);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="check" size={14} /> {CHOICES.find((c) => c.id === choice)?.title}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dv-stage">
              <ZoomBar view={view} setView={setView} />
              {mode === 'side' ? (
                <div className="dv-pair">
                  <div className="dv-col">
                    <div className="dv-col-hd">
                      <span className="dv-col-tag is-before">Saved version</span>
                      <span className="dv-col-who">{beforeWhen}</span>
                    </div>
                    <div className="dv-thumb">
                      <CanvasView
                        src={beforeSrc}
                        view={view}
                        setView={setView}
                        label="Saved version"
                      />
                    </div>
                  </div>
                  <div className="dv-col">
                    <div className="dv-col-hd">
                      <span className="dv-col-tag is-after">Your version</span>
                      <span className="dv-col-who">{acceptedPreview ? 'now · working copy' : 'now · unsaved'}</span>
                    </div>
                    <div className="dv-thumb is-after">
                      <CanvasView
                        src={afterSrc}
                        view={view}
                        setView={setView}
                        label="Your version (now)"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="dv-overlay" ref={overlayRef} style={{ '--dv-split': `${split}%` }}>
                  <div className="dv-overlay-layer">
                    <CanvasView src={beforeSrc} view={view} setView={setView} label="Saved version" />
                  </div>
                  <div className="dv-overlay-after">
                    <CanvasView src={afterSrc} view={view} setView={setView} label="Your version" />
                  </div>
                  <span className="dv-overlay-tag l">Saved</span>
                  <span className="dv-overlay-tag r">Yours</span>
                  <div className="dv-split">
                    <span
                      className="dv-split-handle"
                      role="slider"
                      aria-label="Drag to wipe between saved and your version"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(split)}
                      tabIndex={0}
                      onPointerDown={onSplitDown}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') setSplit((s) => clamp(s - 4, 4, 96));
                        if (e.key === 'ArrowRight') setSplit((s) => clamp(s + 4, 4, 96));
                      }}
                    >
                      <Icon name="split" size={14} />
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="dv-ft">
              <span className="dv-note">
                {mode === 'side'
                  ? 'A live rendered before & after — scroll to zoom, drag to pan. Both sides stay locked together.'
                  : 'Drag the handle to wipe between the saved version and yours.'}
              </span>
              {onRestore && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="history-preview-restore"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        acceptedPreview
                          ? `Restore version ${beforeSha.slice(1)} of “${baseName(file)}” as a new saved version?`
                          : `Restore the saved version of “${baseName(file)}”? Your unsaved changes to it are discarded.`
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await onRestore(file, beforeSha);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Restore saved version
                </button>
              )}
              <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
                Keep my version
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
