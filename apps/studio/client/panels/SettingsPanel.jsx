// SettingsPanel.jsx — BYOK AI-media generation settings (feature-ai-media-
// generation, DDR-16x). Manages provider API keys + enable toggles from the UI.
//
// Trust model (load-bearing): a key is POSTed to the PRIVILEGED main-origin
// /_api/generate/keys route and NEVER echoed back — GET returns only a
// { configured: [...] } presence list. So this panel shows a masked "••••
// configured" state, never the key value. The panel lives in the app shell
// (main origin); the untrusted canvas iframe can't reach any of these routes.
//
// Layout mirrors OnboardingWizard's density + the ExportDialog modal shell
// (st-scrim / st-dialog). Icons are local Lucide-line paths (IdentityBar
// precedent); colors are theme tokens only (no hardcoded hex).

import { useCallback, useEffect, useMemo, useState } from 'react';

function Icon({ name, size = 16 }) {
  const p = {
    x: (
      <>
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </>
    ),
    key: (
      <>
        <circle cx="5.5" cy="5.5" r="3" />
        <path d="M7.6 7.6 13 13" />
        <line x1="11" y1="11" x2="12.5" y2="9.5" />
      </>
    ),
    check: <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />,
    external: (
      <>
        <path d="M6 3.5H3.2A.7.7 0 0 0 2.5 4.2v8.6a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V10" />
        <line x1="8" y1="8" x2="13" y2="3" />
        <polyline points="9.5 3 13 3 13 6.5" />
      </>
    ),
    cloud: <path d="M4.5 12h6a2.5 2.5 0 0 0 .2-5 3.5 3.5 0 0 0-6.7-1A2.75 2.75 0 0 0 4.5 12Z" />,
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

function ProviderCard({ provider, onChanged }) {
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }
  const configured = provider.configured;

  async function save() {
    const key = keyInput.trim();
    if (!key) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/_api/generate/keys', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ provider: provider.id, key }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setKeyInput('');
      setStatus({ ok: true, msg: json.configured ? 'Key saved.' : 'Saved.' });
      onChanged();
    } catch (err) {
      setStatus({ ok: false, msg: err && err.message ? err.message : 'save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/_api/generate/keys', {
        method: 'DELETE',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ provider: provider.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus({ ok: true, msg: 'Key removed.' });
      onChanged();
    } catch (err) {
      setStatus({ ok: false, msg: err && err.message ? err.message : 'remove failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-provider-card">
      <div className="st-provider-hd">
        <span className="st-provider-name">{provider.label}</span>
        <span className={'st-pill' + (provider.kind === 'local' ? ' is-local' : '')}>
          {provider.kind === 'local' ? (
            'Local'
          ) : (
            <>
              <Icon name="cloud" size={12} /> Cloud
            </>
          )}
        </span>
        {configured && (
          <span className="st-provider-configured">
            <Icon name="check" size={12} /> configured
          </span>
        )}
      </div>
      <div className="st-provider-modalities">{provider.modalities.join(' · ')}</div>
      {provider.notes && <div className="st-provider-notes">{provider.notes}</div>}
      {provider.keyUrl && (
        <a className="st-provider-keylink" href={provider.keyUrl} target="_blank" rel="noreferrer">
          Get a key <Icon name="external" size={12} />
        </a>
      )}
      {provider.auth === 'api-key' && (
        <div className="st-provider-keyrow">
          <input
            className="input st-provider-keyinput"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyInput}
            placeholder={configured ? '•••••••• configured — paste to replace' : 'paste API key'}
            aria-label={`${provider.label} API key`}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          <button
            type="button"
            className="st-btn"
            disabled={busy || !keyInput.trim()}
            onClick={save}
          >
            <Icon name="key" size={13} /> Save
          </button>
          {configured && (
            <button type="button" className="st-btn" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
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
    </div>
  );
}

// Task 2.6 — the subtitle/transcription engine is an EXPLICIT user choice, never
// an automatic fallback. This radio persists to generation.transcription.provider
// (the /_api/generate/prefs route); `maude design transcribe` reads the same
// default. Local whisper is free/offline/no-key; the cloud engines need a key
// (managed in the provider cards above).
const TRANSCRIPTION_ENGINES = [
  {
    id: 'auto',
    label: 'Auto',
    note: 'Use the best engine this machine is set up for — the card says which.',
  },
  {
    id: 'whisper',
    label: 'Local whisper.cpp',
    note: 'Free · offline · no key · runs on your hardware',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe',
    note: 'Cloud · accuracy · needs an ElevenLabs key',
  },
  { id: 'groq', label: 'Groq Whisper', note: 'Cloud · fast · needs a Groq key' },
];

const ENGINE_LABELS = Object.fromEntries(TRANSCRIPTION_ENGINES.map((e) => [e.id, e.label]));

function TranscriptionEngineCard() {
  const [engine, setEngine] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  // What `auto` currently resolves to, from the server (key presence lives in
  // the keychain). Shown verbatim so a delegated choice is still a visible one.
  const [auto, setAuto] = useState(null);

  useEffect(() => {
    fetch('/_api/generate/prefs')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setEngine(d?.transcriptionProvider || 'whisper'))
      .catch(() => setEngine('whisper'));
  }, []);

  // Re-read on every selection change: adding a key elsewhere in Settings moves
  // what Auto resolves to, and the user should see that immediately.
  useEffect(() => {
    fetch('/_api/generate/whisper-model')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAuto(d?.auto || null))
      .catch(() => {});
  }, []);

  async function choose(id) {
    if (id === engine) return;
    const prev = engine;
    setEngine(id);
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/_api/generate/prefs', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ transcriptionProvider: id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus({ ok: true, msg: 'Saved.' });
    } catch (err) {
      setEngine(prev); // revert on failure — no silent state drift
      setStatus({ ok: false, msg: err && err.message ? err.message : 'save failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-provider-card">
      <div className="st-provider-hd">
        <span className="st-provider-name">Subtitles — transcription engine</span>
      </div>
      <div className="st-provider-notes">
        Which engine turns audio into subtitles. Maude never switches engines behind your back — pin
        one, or pick <strong>Auto</strong> and it uses the best you're set up for and says so.
      </div>
      {engine === 'auto' && auto && (
        <div className="st-provider-notes">
          Right now Auto uses <strong>{ENGINE_LABELS[auto.engine] || auto.engine}</strong> —{' '}
          {auto.reason}
          {auto.cloud && ' Audio is uploaded to that provider and billed to your account.'}
        </div>
      )}
      <div className="st-engine-radios" role="radiogroup" aria-label="Transcription engine">
        {TRANSCRIPTION_ENGINES.map((e) => (
          <label key={e.id} className={'st-engine-radio' + (engine === e.id ? ' is-selected' : '')}>
            <input
              type="radio"
              name="transcription-engine"
              value={e.id}
              checked={engine === e.id}
              disabled={busy || engine === null}
              onChange={() => choose(e.id)}
            />
            <span className="st-engine-radio-body">
              <span className="st-engine-radio-label">{e.label}</span>
              <span className="st-engine-radio-note">{e.note}</span>
            </span>
          </label>
        ))}
      </div>
      {status && (
        <div
          className="st-provider-status"
          style={{ color: status.ok ? 'var(--accent)' : 'var(--danger, #e5484d)' }}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

// Task 2.7 (approach A) — one-click local whisper.cpp models. The engine binary
// is still a soft dep, but the MODEL half is one click: download a ggml model
// into a Maude-managed cache and `--provider whisper` auto-resolves it. Polls
// the download progress from the privileged /_api/generate/whisper-model route.
function WhisperModelCard() {
  const [state, setState] = useState(null); // { models, downloading } | null
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    fetch('/_api/generate/whisper-model')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setState)
      .catch((e) => setErr(e && e.message ? e.message : 'failed to load models'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a download is in flight.
  useEffect(() => {
    if (!state?.downloading) return undefined;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [state?.downloading, load]);

  async function download(id) {
    setErr(null);
    try {
      const res = await fetch('/_api/generate/whisper-model', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e) {
      setErr(e && e.message ? e.message : 'download failed');
    }
  }

  async function remove(id) {
    setErr(null);
    try {
      const res = await fetch('/_api/generate/whisper-model', {
        method: 'DELETE',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e) {
      setErr(e && e.message ? e.message : 'remove failed');
    }
  }

  const dl = state?.downloading;
  const pctOf = (r, t) => (t > 0 ? Math.min(100, Math.round((r / t) * 100)) : 0);
  const modelsReady = (state?.models || []).some((m) => m.downloaded);

  return (
    <div className="st-provider-card">
      <div className="st-provider-hd">
        <span className="st-provider-name">Local subtitle models (whisper.cpp)</span>
      </div>
      <div className="st-provider-notes">
        Local subtitles need two things: the whisper.cpp engine and one model. Models are stored on
        this machine only and never committed.
      </div>
      {state && (
        <div className="st-setup">
          <div className={`st-step${state.setup?.installed ? ' is-done' : ''}`}>
            <span className="st-step-n">{state.setup?.installed ? '✓' : '1'}</span>
            <div className="st-step-body">
              <span className="st-step-title">
                {state.setup?.installed
                  ? 'whisper.cpp engine is installed'
                  : 'Install the whisper.cpp engine'}
              </span>
              {/* Only routes that work on THIS machine — no `brew install`
                  without Homebrew. whisper.cpp ships no macOS prebuilt, so the
                  brew-less answer is a cloud engine or a source build. */}
              {(state.setup?.options || []).slice(0, 1).map((opt) =>
                opt.kind === 'command' ? (
                  <CopyCommand key={opt.id} command={opt.command} label={`Copy: ${opt.label}`} />
                ) : (
                  <span key={opt.id} className="st-provider-notes">
                    {opt.note}
                  </span>
                )
              )}
            </div>
          </div>
          <div className={`st-step${modelsReady ? ' is-done' : ''}`}>
            <span className="st-step-n">{modelsReady ? '✓' : '2'}</span>
            <div className="st-step-body">
              <span className="st-step-title">
                {modelsReady ? 'Model ready' : 'Download a model (below)'}
              </span>
            </div>
          </div>
          {(state.setup?.options || []).length > 1 && (
            <details className="st-setup-more">
              <summary>Other ways to get the engine</summary>
              {state.setup.options.slice(1).map((opt) => (
                <div key={opt.id} className="st-setup-option">
                  <span className="st-setup-option-label">{opt.label}</span>
                  <CopyCommand
                    command={opt.kind === 'command' ? opt.command : opt.url}
                    label={`Copy: ${opt.label}`}
                  />
                  {opt.note ? <span className="st-provider-notes">{opt.note}</span> : null}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      {err && (
        <div className="st-provider-status" style={{ color: 'var(--danger, #e5484d)' }}>
          {err}
        </div>
      )}
      {dl?.error && (
        <div className="st-provider-status" style={{ color: 'var(--danger, #e5484d)' }}>
          Download of {dl.id} failed: {dl.error}
        </div>
      )}
      {state === null && !err && <div className="st-settings-intro">Loading…</div>}
      <div className="st-model-list">
        {(state?.models || []).map((m) => {
          const busy = dl && !dl.error && dl.id === m.id;
          return (
            <div key={m.id} className="st-model-row">
              <div className="st-model-info">
                <span className="st-model-label">
                  {m.label}
                  <span className={'st-pill' + (m.multilingual ? '' : ' is-local')}>
                    {m.multilingual ? 'multilingual' : 'English-only'}
                  </span>
                  <span className="st-model-size">~{m.sizeMB} MB</span>
                </span>
                <span className="st-engine-radio-note">{m.note}</span>
                {busy && (
                  <span className="st-model-progress">
                    Downloading… {pctOf(dl.received, dl.total)}%
                  </span>
                )}
              </div>
              <div className="st-model-actions">
                {m.downloaded ? (
                  <>
                    <span className="st-provider-configured">
                      <Icon name="check" size={12} /> ready
                    </span>
                    <button type="button" className="st-btn" onClick={() => remove(m.id)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="st-btn"
                    disabled={!!(dl && !dl.error)}
                    onClick={() => download(m.id)}
                  >
                    {busy ? 'Downloading…' : 'Download'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// feature-scene-aware-keyframes — the video-analysis frame-selection engine, the
// sibling of the Subtitles section. Persists `keyframeEngine` to /_api/generate/prefs.
const KEYFRAME_ENGINES = [
  { id: 'auto', label: 'Auto', note: 'Use the best available: Gemma scout → ffmpeg → blind.' },
  {
    id: 'gemma',
    label: 'Gemma scout',
    note: 'Semantic action beats. Needs Ollama (gemma3 vision) or mlx-vlm + a model.',
  },
  {
    id: 'ffmpeg',
    label: 'ffmpeg scene-detect',
    note: 'Scene cuts + endpoints. Needs ffmpeg. No model download.',
  },
  {
    id: 'blind',
    label: 'Blind (even-spaced)',
    note: 'Chromium fallback — works with neither ffmpeg nor Gemma.',
  },
];

function KeyframeEngineCard() {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch('/_api/generate/prefs')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setEngine(d?.keyframeEngine || 'auto'))
      .catch(() => setEngine('auto'));
  }, []);

  async function choose(id) {
    if (id === engine) return;
    const prev = engine;
    setEngine(id);
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/_api/generate/prefs', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ keyframeEngine: id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus({ ok: true, msg: 'Saved.' });
    } catch (err) {
      setEngine(prev);
      setStatus({ ok: false, msg: err && err.message ? err.message : 'save failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-provider-card">
      <div className="st-provider-hd">
        <span className="st-provider-name">Scene-aware keyframes — analysis engine</span>
      </div>
      <div className="st-provider-notes">
        How Maude picks frames when it analyzes a video (`/design:video-analyze`, `/design:reel`).
        Scene-aware beats a blind frame rate. This is an explicit choice — a chosen-but-unavailable
        engine tells you how to fix it; <strong>Auto</strong> just uses the best you have installed.
      </div>
      <div className="st-engine-radios" role="radiogroup" aria-label="Keyframe engine">
        {KEYFRAME_ENGINES.map((e) => (
          <label key={e.id} className={'st-engine-radio' + (engine === e.id ? ' is-selected' : '')}>
            <input
              type="radio"
              name="keyframe-engine"
              value={e.id}
              checked={engine === e.id}
              disabled={busy || engine === null}
              onChange={() => choose(e.id)}
            />
            <span className="st-engine-radio-body">
              <span className="st-engine-radio-label">{e.label}</span>
              <span className="st-engine-radio-note">{e.note}</span>
            </span>
          </label>
        ))}
      </div>
      {status && (
        <div
          className="st-provider-status"
          style={{ color: status.ok ? 'var(--accent)' : 'var(--danger, #e5484d)' }}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

// A copy/paste terminal command with a Copy button (same look as the ACP
// readiness rows — the rdy-* classes are global in the bundled stylesheet).
function CopyCommand({ command, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };
  return (
    <span className="rdy-cmd">
      <code className="rdy-cmd-tx">{command}</code>
      <button
        type="button"
        className="rdy-copy"
        onClick={copy}
        aria-label={label || 'Copy command'}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

// The setup path, as STEPS rather than a wall of options. Only the shortest
// route is visible (install → pull); everything else — Homebrew, the download
// link, the whole mlx-vlm alternative — sits folded behind one disclosure, so a
// first-time reader sees two commands, not seven.
function SetupSteps({ state }) {
  const ollama = state.ollama || {};
  const setup = ollama.setup || [];
  // The server orders routes best-first, so the head is the one step to take now
  // ("install", or "start" when the binary is already there). Everything after
  // it is an alternative way to reach the same place.
  const [primary, ...alternatives] = setup;
  const step1Done = Boolean(ollama.available);
  const step2Done = Boolean(ollama.model);
  // Once Ollama is running, its own route list collapses to the pull command —
  // which IS step 2, so it must not also render as step 1.
  const step1 = step1Done || primary?.id === 'pull' ? null : primary;

  return (
    <div className="st-setup">
      <div className={`st-step${step1Done ? ' is-done' : ''}`}>
        <span className="st-step-n">{step1Done ? '✓' : '1'}</span>
        <div className="st-step-body">
          <span className="st-step-title">
            {step1Done ? 'Ollama is running' : ollama.installed ? 'Start Ollama' : 'Install Ollama'}
          </span>
          {step1?.kind === 'command' ? (
            <CopyCommand command={step1.command} label="Copy the install command" />
          ) : null}
        </div>
      </div>
      <div className={`st-step${step2Done ? ' is-done' : ''}`}>
        <span className="st-step-n">{step2Done ? '✓' : '2'}</span>
        <div className="st-step-body">
          <span className="st-step-title">
            {step2Done ? `Model ready (${ollama.model})` : 'Download the model'}
          </span>
          {step2Done ? null : (
            <CopyCommand command={ollama.pullCommand} label="Copy the model pull command" />
          )}
        </div>
      </div>
      <details className="st-setup-more">
        <summary>Other ways to install</summary>
        {alternatives.map((opt) => (
          <div key={opt.id} className="st-setup-option">
            <span className="st-setup-option-label">{opt.label}</span>
            {/* A link is rendered as a copyable URL, not a button: the desktop
                shell has no general URL opener by design (DDR-054). */}
            <CopyCommand
              command={opt.kind === 'command' ? opt.command : opt.url}
              label={`Copy: ${opt.label}`}
            />
          </div>
        ))}
        <div className="st-setup-option">
          <span className="st-setup-option-label">
            mlx-vlm instead of Ollama — faster, Apple Silicon only
          </span>
          {state.mlx?.supported ? (
            <>
              <CopyCommand command={state.mlx.command} label="Copy the mlx-vlm install command" />
              <span className="st-provider-notes">
                Then download a model below. Models live in your HuggingFace cache.
              </span>
            </>
          ) : (
            // Never show a command that would fail here — say why instead.
            <span className="st-provider-notes">{state.mlx?.reason}</span>
          )}
        </div>
      </details>
    </div>
  );
}

// The MODEL half of the Gemma scout — one click, mirroring WhisperModelCard. The
// RUNTIME is a manual install the app can't do for you (DDR-183), but the card
// hands you copy/paste commands for BOTH runtime paths — Ollama (simplest: one
// app, `ollama pull`, no Python) and mlx-vlm (fastest, the benchmarked path) —
// and re-probes on its own, so the card unlocks itself once you've run one.
function GemmaModelCard() {
  const [state, setState] = useState(null); // { models, downloading, mlxVlmAvailable, ffmpegAvailable, installCommand, ollama }
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    fetch('/_api/generate/keyframe-model')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setState)
      .catch((e) => setErr(e && e.message ? e.message : 'failed to load models'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!state?.downloading) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [state?.downloading, load]);

  // No scout runtime yet → the user is likely running one of the install
  // commands in a terminal right now. Re-probe every 10 s (server-side the
  // probes are TTL-cached) so the card unlocks itself without a reopen.
  const noRuntime = state ? !state.mlxVlmAvailable && !state.ollama?.model : false;
  useEffect(() => {
    if (!noRuntime) return undefined;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [noRuntime, load]);

  async function download(id) {
    setErr(null);
    try {
      const res = await fetch('/_api/generate/keyframe-model', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e) {
      setErr(e && e.message ? e.message : 'download failed');
    }
  }

  const dl = state?.downloading;
  const mlx = state?.mlxVlmAvailable;
  const ff = state?.ffmpegAvailable;
  const ollama = state?.ollama;
  const scoutReady = Boolean(mlx || ollama?.model);
  const pctOf = (r, t) => (t > 0 ? Math.min(100, Math.round((r / t) * 100)) : 0);
  const activeTier = scoutReady
    ? `Gemma scout${mlx ? '' : ` (Ollama · ${ollama.model})`}`
    : ff
      ? 'ffmpeg scene-detect'
      : 'blind (even-spaced)';

  return (
    <div className="st-provider-card">
      <div className="st-provider-hd">
        <span className="st-provider-name">Gemma scout model (optional)</span>
      </div>
      <div className="st-provider-notes">
        Adds semantic action-beat detection on top of scene cuts. Two short steps in a terminal —
        Maude picks the result up on its own.
      </div>
      {state && !scoutReady && <SetupSteps state={state} />}
      {state && (
        <div className="st-provider-notes">
          Active tier on this machine: <strong>{activeTier}</strong>
          {scoutReady && !mlx && ' — Ollama manages its own models, nothing to download below.'}
        </div>
      )}
      {err && (
        <div className="st-provider-status" style={{ color: 'var(--danger, #e5484d)' }}>
          {err}
        </div>
      )}
      {dl?.error && (
        <div className="st-provider-status" style={{ color: 'var(--danger, #e5484d)' }}>
          Download of {dl.id} failed: {dl.error}
        </div>
      )}
      {state === null && !err && <div className="st-settings-intro">Loading…</div>}
      <div className="st-model-list">
        {(state?.models || []).map((m) => {
          const busy = dl && !dl.error && dl.id === m.id;
          const runtimeReady = m.runtime === 'ollama' ? Boolean(ollama?.available) : Boolean(mlx);
          const blockedNote =
            m.runtime === 'ollama'
              ? ollama?.installed
                ? 'start Ollama first'
                : 'needs Ollama'
              : 'needs mlx-vlm';
          return (
            <div key={m.id} className="st-model-row">
              <div className="st-model-info">
                <span className="st-model-label">
                  {m.label}
                  <span className="st-model-size">~{Math.round(m.sizeMB / 100) / 10} GB</span>
                </span>
                <span className="st-engine-radio-note">{m.note}</span>
                {busy && (
                  <span className="st-model-progress">
                    {m.runtime === 'ollama' ? 'Pulling' : 'Downloading'}…{' '}
                    {pctOf(dl.received, dl.total)}%
                  </span>
                )}
              </div>
              <div className="st-model-actions">
                {m.downloaded ? (
                  <span className="st-provider-configured">
                    <Icon name="check" size={12} /> ready
                  </span>
                ) : (
                  // Each row is enabled by ITS OWN runtime — an Ollama model is
                  // one click whenever Ollama is running (the server pulls it
                  // through /api/pull); an mlx snapshot needs mlx-vlm. The
                  // button keeps its label and just goes disabled, with the
                  // reason in small type underneath.
                  <span className="st-model-action">
                    <button
                      type="button"
                      className="st-btn"
                      disabled={!runtimeReady || !!(dl && !dl.error)}
                      onClick={() => download(m.id)}
                    >
                      {busy ? 'Downloading…' : 'Download'}
                    </button>
                    {runtimeReady ? null : (
                      <span className="st-model-action-note">{blockedNote}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// feature-unified-settings-modal — one modal for every Maude preference, laid
// out as a left vertical tab rail + an internally-scrolling pane. Categories:
/**
 * Figma connect card (DDR-216 D2/D3 / T11).
 *
 * Same trust model as ProviderCard, DIFFERENT routes: `figma` is deliberately
 * not in the media-generation registry, so this card talks to
 * `/_api/figma/{status,connect,probe}` — all three main-origin-only, loopback-
 * and same-origin-gated, and none of which ever echoes the token back.
 *
 * The scope named here is `file_content:read`, never the deprecated blanket
 * `files:read`. The "Connected as …" handle comes from `/v1/me` and is
 * upstream-controlled — bounded server-side and rendered as a React text child
 * (never `dangerouslySetInnerHTML`), and deliberately never persisted.
 */
function FigmaConnectCard() {
  const [status, setStatus] = useState(null); // null = loading
  const [tokenInput, setTokenInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [handle, setHandle] = useState(null);

  const load = useCallback(() => {
    fetch('/_api/figma/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setStatus)
      .catch(() => setStatus({ configured: false }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    const token = tokenInput.trim();
    if (!token || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/_api/figma/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(body.error || 'could not save the token');
        return;
      }
      // Clear the field immediately — the value is never read back from the
      // server, so leaving it on screen only risks a shoulder-surf.
      setTokenInput('');
      load();
      await probe();
    } finally {
      setBusy(false);
    }
  }

  async function probe() {
    setMsg(null);
    const res = await fetch('/_api/figma/probe', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (body.ok) {
      setHandle(body.handle || '');
      setMsg(null);
    } else {
      setHandle(null);
      setMsg(body.error || 'Figma did not accept that token.');
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/_api/figma/connect', { method: 'DELETE' });
      setHandle(null);
      setMsg(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(status?.configured);

  return (
    <div className="st-provider-card" data-testid="figma-connect-card">
      <div className="st-provider-hd">
        <span className="st-provider-name">Figma</span>
        {configured && (
          <span className="st-provider-configured">
            <Icon name="check" size={12} /> connected
          </span>
        )}
      </div>
      <p className="st-settings-intro">
        Import real Figma documents — frames become editable canvases, FigJam boards become the
        whiteboard, and paint/text/effect styles become design tokens. The translation is plain
        code: no AI reads your file.
      </p>
      <p className="st-settings-intro">
        Create a personal access token with the{' '}
        <code>{status?.requiredScope || 'file_content:read'}</code> scope. It is stored on this
        machine only and is never sent anywhere but Figma.
      </p>
      {status?.tokenUrl && (
        <a className="st-provider-keylink" href={status.tokenUrl} target="_blank" rel="noreferrer">
          Get a token <Icon name="external" size={12} />
        </a>
      )}
      <div className="st-provider-keyrow">
        <input
          className="st-provider-keyinput"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={configured ? '•••••••• stored' : 'figd_…'}
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') connect();
          }}
          aria-label="Figma personal access token"
          data-testid="figma-connect-input"
        />
        <button
          type="button"
          className="st-btn"
          disabled={busy || !tokenInput.trim()}
          onClick={connect}
          data-testid="figma-connect-save"
        >
          {configured ? 'Replace' : 'Save'}
        </button>
        {configured && (
          <button
            type="button"
            className="st-btn"
            disabled={busy}
            onClick={disconnect}
            data-testid="figma-disconnect"
          >
            Remove
          </button>
        )}
      </div>
      {configured && (
        <button type="button" className="st-btn" disabled={busy} onClick={probe}>
          Test connection
        </button>
      )}
      {handle !== null && (
        <div className="st-provider-status" data-testid="figma-connected-as">
          Connected as {handle || 'your Figma account'}
        </div>
      )}
      {msg && (
        <div className="st-provider-status" data-testid="figma-connect-error">
          {msg}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'canvas-view', label: 'Canvas & View' },
  { id: 'layout', label: 'Layout' },
  // Cloud Phase 27 — `local: true` means "this tab configures something that
  // runs on the machine Maude is installed on". A browser tab has no ffmpeg, no
  // mlx-vlm, no HuggingFace cache and no provider key of yours, and the routes
  // behind these panes are refused in a cell by design (DDR-209 D1) — so in the
  // cloud they rendered as a wall of `HTTP 404`.
  //
  // ABSENT, not disabled. C2 says state an absence where the thing would be,
  // and that rule earns its keep for the agent chat: the feature exists, you
  // just need the desktop app. These are settings for machinery that is not
  // missing so much as inapplicable — a preference pane for hardware this shell
  // does not have. There is nothing for the reader to act on, so a whole tab of
  // dead controls is worse than no tab.
  { id: 'ai-generation', label: 'AI generation', local: true },
  // DDR-216 — Figma is its OWN tab, not a row under "AI generation". It is not
  // a media-generation provider (it produces no modality and needs no adapter),
  // and putting it in that registry would create a second write path for the
  // same secret — which is how one of them ends up ungated.
  { id: 'figma', label: 'Figma', local: true },
  { id: 'subtitles', label: 'Subtitles', local: true },
  { id: 'video', label: 'Video', local: true },
];
const SETTINGS_TAB_STORE = 'mdcc-settings-tab';

// feature-configurable-panel-docking — the panels the Layout tab can dock. Order
// = display order. (Assistant is native-only; moving it is a no-op in the browser.)
const LAYOUT_PANELS = [
  { id: 'tree', label: 'Files' },
  { id: 'layers', label: 'Layers' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'comments', label: 'Comments' },
  { id: 'changes', label: 'Changes' },
  { id: 'assistant', label: 'Assistant' },
];

function SideToggle({ value, disabled, onChange }) {
  return (
    <span className="st-sidetoggle" role="radiogroup" aria-label="Panel side">
      {['left', 'right'].map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          disabled={disabled}
          className={'st-sidebtn' + (value === s ? ' is-active' : '')}
          onClick={() => onChange(s)}
        >
          {s === 'left' ? 'Left' : 'Right'}
        </button>
      ))}
    </span>
  );
}

const LAYERS_MODE_OPTIONS = [
  { id: 'separate', label: 'Separate panel', note: 'Layers docks on its own (default: left).' },
  { id: 'in-inspector', label: 'Inside Inspector', note: 'Layers is a tab within the Inspector.' },
];
function LayoutTab({ panelSide, onSetPanelSide, layersMode, onSetLayersMode }) {
  return (
    <>
      <div className="st-provider-card">
        <div className="st-provider-hd">
          <span className="st-provider-name">Layers panel</span>
        </div>
        <div className="st-provider-notes">
          Show Layers as its own dockable panel, or as a tab inside the Inspector.
        </div>
        <div className="st-engine-radios" role="radiogroup" aria-label="Layers mode">
          {LAYERS_MODE_OPTIONS.map((o) => (
            <label
              key={o.id}
              className={'st-engine-radio' + (layersMode === o.id ? ' is-selected' : '')}
            >
              <input
                type="radio"
                name="layers-mode"
                checked={layersMode === o.id}
                onChange={() => onSetLayersMode(o.id)}
              />
              <span className="st-engine-radio-body">
                <span className="st-engine-radio-label">{o.label}</span>
                <span className="st-engine-radio-note">{o.note}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="st-provider-card">
        <div className="st-provider-hd">
          <span className="st-provider-name">Panel positions</span>
        </div>
        <div className="st-provider-notes">
          Dock each panel to the left or right side. Each side shows one panel at a time, with tabs
          to switch between the panels docked there.
        </div>
        {LAYOUT_PANELS.map((p) => {
          const disabled = p.id === 'layers' && layersMode !== 'separate';
          return (
            <div key={p.id} className={'st-pref-row' + (disabled ? ' is-disabled' : '')}>
              <span className="st-pref-body">
                <span className="st-pref-label">{p.label}</span>
                {disabled && (
                  <span className="st-pref-note">
                    Layers is inside the Inspector — choose “Separate panel” above to dock it.
                  </span>
                )}
              </span>
              <SideToggle
                value={panelSide?.[p.id] || 'left'}
                disabled={disabled}
                onChange={(s) => onSetPanelSide(p.id, s)}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

// A labeled switch row. The `checked`/`onChange` are owned by app.jsx state
// (single source of truth) so the modal and the View menu never diverge.
function PrefToggleRow({ label, note, checked, disabled, reason, onChange }) {
  return (
    <label className={'st-pref-row' + (disabled ? ' is-disabled' : '')}>
      <span className="st-pref-body">
        <span className="st-pref-label">{label}</span>
        {(reason || note) && (
          <span className="st-pref-note">{disabled && reason ? reason : note}</span>
        )}
      </span>
      <input
        type="checkbox"
        className="st-switch"
        role="switch"
        aria-checked={!!checked}
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </label>
  );
}

// Appearance — theme control. Reuses the transcription-engine radio density so
// the whole modal reads as one system. Wired to app.jsx `theme` + `onSetTheme`.
const THEME_OPTIONS = [
  { id: 'light', label: 'Light', note: 'Bright shell chrome' },
  { id: 'dark', label: 'Dark', note: 'Dim shell chrome' },
];
// DDR-171 — the CSS-panel (Inspector) vocabulary. Advanced = raw CSS property
// names (the default, unchanged); Designer = Figma-familiar clusters (Fill,
// Stroke, Auto layout…). Same underlying controls + write path, just relabeled
// and regrouped. Persisted via the App-owned `maude-cp-mode` state, so this
// radio and the in-panel corner toggle stay in lockstep.
const CP_MODE_OPTIONS = [
  {
    id: 'advanced',
    label: 'Advanced',
    note: 'Raw CSS property names — border-radius, flex-direction…',
  },
  {
    id: 'designer',
    label: 'Designer',
    note: 'Figma vocabulary — Fill, Stroke, Corner radius, Auto layout…',
  },
];
function AppearanceTab({ theme, onSetTheme, cpMode, onSetCpMode }) {
  return (
    <>
      <div className="st-provider-card">
        <div className="st-provider-hd">
          <span className="st-provider-name">Theme</span>
        </div>
        <div className="st-provider-notes">
          Controls Maude’s own chrome — menubar, sidebar, canvas plane, minimap, zoom HUD. Artboards
          keep their own design-system theme.
        </div>
        <div className="st-engine-radios" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((o) => (
            <label
              key={o.id}
              className={'st-engine-radio' + (theme === o.id ? ' is-selected' : '')}
            >
              <input
                type="radio"
                name="maude-theme"
                value={o.id}
                checked={theme === o.id}
                onChange={() => onSetTheme?.(o.id)}
              />
              <span className="st-engine-radio-body">
                <span className="st-engine-radio-label">{o.label}</span>
                <span className="st-engine-radio-note">{o.note}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="st-provider-card">
        <div className="st-provider-hd">
          <span className="st-provider-name">Inspector vocabulary</span>
        </div>
        <div className="st-provider-notes">
          How the CSS panel labels controls. You can also flip this from the small toggle in the
          panel’s own corner — this choice is remembered.
        </div>
        <div className="st-engine-radios" role="radiogroup" aria-label="Inspector vocabulary">
          {CP_MODE_OPTIONS.map((o) => (
            <label
              key={o.id}
              className={'st-engine-radio' + (cpMode === o.id ? ' is-selected' : '')}
            >
              <input
                type="radio"
                name="maude-cp-mode"
                value={o.id}
                checked={cpMode === o.id}
                onChange={() => onSetCpMode?.(o.id)}
              />
              <span className="st-engine-radio-body">
                <span className="st-engine-radio-label">{o.label}</span>
                <span className="st-engine-radio-note">{o.note}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

export default function SettingsPanel({
  /** `{ dashboardUrl?, projectName }` when this is a cloud tab, else null. */
  // Tri-state (see the note where this value is created): `undefined` until
  // the server config answers, `null` for the desktop, an object for a cloud
  // tab. Defaulting it to `null` here is what re-broke the boot 404 after the
  // call sites were fixed — a default fires on `undefined`, so "not known yet"
  // became "not cloud" one layer further in, invisibly.
  cloud,
  onClose,
  initialTab,
  theme,
  onSetTheme,
  cpMode,
  onSetCpMode,
  minimapVisible,
  onToggleMinimap,
  zoomCtlVisible,
  onToggleZoomCtl,
  annotationsVisible,
  onToggleAnnotations,
  autoOpenInspector,
  onToggleAutoOpenInspector,
  hasCanvas = false,
  panelSide,
  onSetPanelSide,
  layersMode,
  onSetLayersMode,
}) {
  const [providers, setProviders] = useState(null); // null = loading
  const [error, setError] = useState(null);
  // The tabs THIS shell can honour. See TABS for why the local-machine ones are
  // absent in a browser tab rather than disabled.
  const tabs = useMemo(() => TABS.filter((t) => !(cloud && t.local)), [cloud]);
  const [tab, setTab] = useState(() => {
    // A remembered tab that this shell does not have (you opened Video on the
    // desktop, then opened Settings in the cloud) must not select nothing.
    const has = (id) => TABS.some((t) => t.id === id && !(cloud && t.local));
    if (initialTab && has(initialTab)) return initialTab;
    try {
      const v = localStorage.getItem(SETTINGS_TAB_STORE);
      if (v && has(v)) return v;
    } catch {}
    return 'appearance';
  });

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_TAB_STORE, tab);
    } catch {}
  }, [tab]);

  const load = useCallback(() => {
    fetch('/_api/generate/providers')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setProviders(Array.isArray(d?.providers) ? d.providers : []))
      .catch((err) => setError(err && err.message ? err.message : 'failed to load providers'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  // Vertical roving focus over the tab rail (native-menu parity).
  function onRailKey(e) {
    const idx = tabs.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      setTab(tabs[(idx + 1) % tabs.length].id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setTab(tabs[0].id);
    } else if (e.key === 'End') {
      e.preventDefault();
      setTab(tabs[tabs.length - 1].id);
    }
  }

  // Minimap / zoom-controls are canvas-scoped — mirror the View menu's
  // `disabled: !activePath || isSystem` gate and say why inline.
  const canvasReason = !hasCanvas ? 'Open a canvas to use this.' : undefined;

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-dialog is-settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Settings</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="st-settings-tabs">
          <div
            className="st-settings-rail"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings categories"
            onKeyDown={onRailKey}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`st-stab-${t.id}`}
                aria-controls={`st-spanel-${t.id}`}
                aria-selected={tab === t.id}
                tabIndex={tab === t.id ? 0 : -1}
                className={'st-settings-tab' + (tab === t.id ? ' is-active' : '')}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="st-settings-pane">
            {/* Appearance */}
            <section
              role="tabpanel"
              id="st-spanel-appearance"
              aria-labelledby="st-stab-appearance"
              hidden={tab !== 'appearance'}
            >
              <div className="st-rp-hd">Appearance</div>
              <AppearanceTab
                theme={theme}
                onSetTheme={onSetTheme}
                cpMode={cpMode}
                onSetCpMode={onSetCpMode}
              />
            </section>

            {/* Canvas & View — the persistent View-menu prefs, one canonical home. */}
            <section
              role="tabpanel"
              id="st-spanel-canvas-view"
              aria-labelledby="st-stab-canvas-view"
              hidden={tab !== 'canvas-view'}
            >
              <div className="st-rp-hd">Canvas &amp; View</div>
              <PrefToggleRow
                label="Minimap"
                note="Show the canvas minimap overlay."
                checked={minimapVisible}
                disabled={!hasCanvas}
                reason={canvasReason}
                onChange={() => onToggleMinimap?.()}
              />
              <PrefToggleRow
                label="Zoom controls"
                note="Show the floating zoom controls on the canvas."
                checked={zoomCtlVisible}
                disabled={!hasCanvas}
                reason={canvasReason}
                onChange={() => onToggleZoomCtl?.()}
              />
              <PrefToggleRow
                label="Annotations"
                note="Show annotation pins and overlays on the canvas."
                checked={annotationsVisible}
                onChange={() => onToggleAnnotations?.()}
              />
              <PrefToggleRow
                label="Auto-open Inspector on select"
                note="Open the Inspector automatically when you select an element."
                checked={autoOpenInspector}
                onChange={() => onToggleAutoOpenInspector?.()}
              />
            </section>

            {/* Layout — dock panels left/right + Layers mode. */}
            <section
              role="tabpanel"
              id="st-spanel-layout"
              aria-labelledby="st-stab-layout"
              hidden={tab !== 'layout'}
            >
              <div className="st-rp-hd">Layout</div>
              <LayoutTab
                panelSide={panelSide}
                onSetPanelSide={onSetPanelSide}
                layersMode={layersMode}
                onSetLayersMode={onSetLayersMode}
              />
            </section>

            {/* AI generation — BYOK provider keys (kept mounted so the fetch runs once). */}
            <section
              role="tabpanel"
              id="st-spanel-ai-generation"
              aria-labelledby="st-stab-ai-generation"
              hidden={tab !== 'ai-generation'}
            >
              <div className="st-rp-hd">Provider keys</div>
              <p className="st-settings-intro">
                Bring your own API keys to generate images (and, soon, audio + video) inside Maude.
                Keys are stored on this machine only — in your OS keychain or a private{' '}
                <code>~/.config/maude/keys.json</code> (mode 0600) — sent straight to the provider,
                and never committed, logged, or exposed to a canvas.
              </p>
              {error && (
                <div className="st-provider-status" style={{ color: 'var(--danger, #e5484d)' }}>
                  {error}
                </div>
              )}
              {providers === null && !error && <div className="st-settings-intro">Loading…</div>}
              {providers?.map((p) => (
                <ProviderCard key={p.id} provider={p} onChanged={load} />
              ))}
              {providers?.length === 0 && (
                <div className="st-settings-intro">No providers registered.</div>
              )}
            </section>

            {/* Figma — the import credential (DDR-216 D2/D3). Separate routes from
                the generation keys above, and separate on purpose. */}
            <section
              role="tabpanel"
              id="st-spanel-figma"
              aria-labelledby="st-stab-figma"
              hidden={tab !== 'figma'}
            >
              <div className="st-rp-hd">Figma</div>
              <FigmaConnectCard />
            </section>

            {/* Subtitles — kept mounted so WhisperModelCard's download poll survives
                a tab switch (unmounting mid-download would drop the interval). */}
            <section
              role="tabpanel"
              id="st-spanel-subtitles"
              aria-labelledby="st-stab-subtitles"
              hidden={tab !== 'subtitles'}
            >
              <div className="st-rp-hd">Subtitles</div>
              <TranscriptionEngineCard />
              <WhisperModelCard />
            </section>

            {/* Video — scene-aware keyframe engine. Kept mounted so GemmaModelCard's
                download poll survives a tab switch (like Subtitles above). */}
            <section
              role="tabpanel"
              id="st-spanel-video"
              aria-labelledby="st-stab-video"
              hidden={tab !== 'video'}
            >
              <div className="st-rp-hd">Video</div>
              <KeyframeEngineCard />
              <GemmaModelCard />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
