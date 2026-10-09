// generate-dialog.jsx — the in-app AI-media generate action (feature-ai-media-
// generation, DDR-16x). Prompt → provider/model/aspect → enqueue on the
// privileged /_api/generate-jobs route → poll the job → the produced content-
// addressed asset lands ON the active canvas artboard by default (Phase 1 Task
// 1.1 — generation is never a dead-end modal). "Place on canvas" can be
// unchecked to generate-without-placing; the Copy path / Insert buttons are the
// secondary affordance. Sibling of `maude design generate` (same route).
//
// Main-origin shell UI (the route is privileged — never canvas-reachable).
// Modal chrome mirrors ExportDialog (st-scrim / st-dialog); a running job polls
// the job list every 1.5s until done/failed (the same completion signal the
// notification center consumes via the generate:job WS push). Auto-insert reuses
// the AssetPicker's main-origin source-write lane (insertElementShell →
// /_api/insert-element) via the `onInsert` prop passed by app.jsx.

import { useCallback, useEffect, useRef, useState } from 'react';

function Icon({ name, size = 16 }) {
  const p = {
    x: (
      <>
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </>
    ),
    sparkle: <path d="M8 2.5l1.2 3.3L12.5 7 9.2 8.2 8 11.5 6.8 8.2 3.5 7l3.3-1.2z" />,
    copy: (
      <>
        <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" />
        <path d="M3 10.5V3.2A.7.7 0 0 1 3.7 2.5H10" />
      </>
    ),
  }[name];
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
      {p}
    </svg>
  );
}

const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5'];

export default function GenerateDialog({ onClose, onInsert }) {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }
  const [resultAsset, setResultAsset] = useState(null);
  // feature-ai-media-generation Phase 1 (Task 1.1) — auto-insert the finished
  // image onto the canvas by default (generation is never a dead-end modal). The
  // user can uncheck "Place on canvas" to generate-without-placing (the manual
  // Copy path / Insert buttons remain the secondary affordance).
  const [placeOnCanvas, setPlaceOnCanvas] = useState(true);
  const [placed, setPlaced] = useState(null); // null | true (inserted) | false (no target)
  const pollRef = useRef(null);
  // Guard against a double-insert: onInsert's identity changes when the active
  // artboard changes, which would otherwise re-fire the auto-insert effect and
  // splice the SAME asset twice. Record the last auto-inserted path.
  const autoInsertedRef = useRef(null);

  // Load the image-capable providers + their configured status.
  useEffect(() => {
    fetch('/_api/generate/providers')
      .then((r) => r.json())
      .then((d) => {
        const image = (d?.providers ?? []).filter((p) => p.modalities?.includes('image'));
        setProviders(image);
        const first = image.find((p) => p.configured) ?? image[0];
        if (first) setProvider(first.id);
      })
      .catch(() => setStatus({ ok: false, msg: 'failed to load providers' }));
  }, []);

  // Model list follows the chosen provider (best-effort — the descriptor drives
  // the fallback; a real listModels lands with the fal aggregator in Phase 1).
  useEffect(() => {
    if (!provider) return;
    // Static model hints live server-side; the providers route doesn't ship them
    // per-provider yet, so leave the model unset (adapter picks its default).
    setModels([]);
    setModel('');
  }, [provider]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // Auto-insert the moment a result lands (keyed on resultAsset so the fresh
  // onInsert prop is used, never the stale one captured in the poll closure).
  // onInsert returns false when there's no target artboard (no canvas open) — in
  // that case fall back to the manual Insert/Copy affordances below.
  useEffect(() => {
    if (!resultAsset || !placeOnCanvas || typeof onInsert !== 'function') return;
    // Insert each result at most once, even if onInsert's identity changes.
    if (autoInsertedRef.current === resultAsset) return;
    autoInsertedRef.current = resultAsset;
    const ok = onInsert(resultAsset) === true;
    setPlaced(ok);
    if (ok) setStatus({ ok: true, msg: 'Placed on canvas ✓' });
    else
      setStatus({
        ok: true,
        msg: 'Generated — open a canvas artboard to place it, or insert below.',
      });
  }, [resultAsset, placeOnCanvas, onInsert]);

  const current = providers.find((p) => p.id === provider);
  const notConfigured = current && !current.configured;

  const poll = useCallback((jobId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const d = await (await fetch('/_api/generate-jobs')).json();
        const job = (d?.jobs ?? []).find((j) => j.id === jobId);
        if (!job) return;
        if (job.status === 'done') {
          clearInterval(pollRef.current);
          setBusy(false);
          const asset = job.assets?.[0] ?? null;
          setResultAsset(asset);
          setStatus({ ok: true, msg: asset ? `Generated ${asset}` : 'Done (no asset)' });
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current);
          setBusy(false);
          setStatus({ ok: false, msg: job.error || 'generation failed' });
        }
      } catch {
        /* transient — keep polling until the deadline below */
      }
    }, 1500);
    // Safety deadline so a wedged job doesn't spin forever.
    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        setBusy((b) => {
          if (b) setStatus({ ok: false, msg: 'timed out waiting for the job' });
          return false;
        });
      }
    }, 180000);
  }, []);

  async function generate() {
    if (!prompt.trim() || !provider) return;
    setBusy(true);
    setStatus(null);
    setResultAsset(null);
    setPlaced(null);
    autoInsertedRef.current = null;
    try {
      const body = {
        modality: 'image',
        provider,
        prompt: prompt.trim(),
        aspectRatio: aspect,
        ...(model ? { model } : {}),
      };
      const res = await fetch('/_api/generate-jobs', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(body),
      });
      if (res.status === 202) {
        const { jobId } = await res.json();
        setStatus({ ok: true, msg: 'Generating…' });
        poll(jobId);
      } else {
        setBusy(false);
        setStatus({ ok: false, msg: await res.text() });
      }
    } catch (err) {
      setBusy(false);
      setStatus({ ok: false, msg: err && err.message ? err.message : 'request failed' });
    }
  }

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-dialog" role="dialog" aria-modal="true" aria-label="Generate media">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Generate with AI</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <div className="st-rp-hd">Prompt</div>
          <textarea
            className="input st-gen-prompt"
            rows={3}
            value={prompt}
            placeholder="a minimal hero image of a mountain lake at dawn, soft light"
            aria-label="Generation prompt"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="st-dialog-row">
            <label className="st-dialog-lbl" htmlFor="st-gen-provider">
              Provider
            </label>
            <select
              id="st-gen-provider"
              className="st-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.configured ? '' : ' — no key'}
                </option>
              ))}
            </select>
          </div>
          {models.length > 0 && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-gen-model">
                Model
              </label>
              <select
                id="st-gen-model"
                className="st-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="st-dialog-row">
            <label className="st-dialog-lbl" htmlFor="st-gen-aspect">
              Aspect
            </label>
            <select
              id="st-gen-aspect"
              className="st-select"
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
            >
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          {onInsert && (
            <label className="st-dialog-row" style={{ gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={placeOnCanvas}
                onChange={(e) => setPlaceOnCanvas(e.target.checked)}
                aria-label="Place the generated image on the canvas"
              />
              <span className="st-dialog-lbl" style={{ margin: 0 }}>
                Place on canvas
              </span>
            </label>
          )}
          {notConfigured && (
            <div className="st-provider-status" style={{ color: 'var(--fg-3)' }}>
              No key for {current.label} — add one in Settings (⌘,).
            </div>
          )}
          {resultAsset && (
            <div className="st-gen-result">
              <img className="st-gen-thumb" src={`/${resultAsset}`} alt="generated" />
              <div className="st-gen-result-actions">
                <button
                  type="button"
                  className="st-btn"
                  onClick={() => navigator.clipboard?.writeText(`/${resultAsset}`)}
                >
                  <Icon name="copy" size={13} /> Copy path
                </button>
                {/* Manual Insert stays as a secondary affordance — for a
                    generate-without-placing run, or when auto-insert found no
                    target artboard (placed === false). */}
                {onInsert && placed !== true && (
                  <button
                    type="button"
                    className="st-btn"
                    onClick={() => {
                      const ok = onInsert(resultAsset) === true;
                      setPlaced(ok);
                      setStatus(
                        ok
                          ? { ok: true, msg: 'Placed on canvas ✓' }
                          : { ok: false, msg: 'Open a canvas and select an artboard first.' }
                      );
                    }}
                  >
                    Insert
                  </button>
                )}
              </div>
            </div>
          )}
          {status && (
            <div
              className="st-provider-status"
              style={{ color: status.ok ? 'var(--accent)' : 'var(--danger, #e5484d)' }}
            >
              {status.msg}
            </div>
          )}
          <div className="st-dialog-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              type="button"
              className="st-btn st-gen-go"
              disabled={busy || !prompt.trim() || !provider}
              onClick={generate}
            >
              <Icon name="sparkle" size={14} /> {busy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
