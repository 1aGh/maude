// SettingsPanel.jsx — BYOK AI-media generation settings (feature-ai-media-
// generation, DDR-16x). Manages provider API keys + enable toggles from the UI.
//
// Trust model (load-bearing): a key is POSTed to the PRIVILEGED main-origin
// /_api/generate/keys route and NEVER echoed back — GET returns only a
// { configured: [...] } presence list. So this panel shows a masked "••••
// configured" state, never the key value. The panel lives in the app shell
// (main origin); the untrusted canvas iframe can't reach any of these routes.
//
// V2-4.7a: this file no longer draws a dialog. The seven-tab modal became the v2 Settings sheet
// (client/v2/settings/ — General · Connections · Advanced); what stays here are the controls
// themselves — the provider, Figma, engine and model cards, the theme / layout rows — exported so
// the sheet rehomes them without a second copy. Icons are local Lucide-line paths (IdentityBar
// precedent); colors are theme tokens only (no hardcoded hex).

import { useCallback, useEffect, useState } from 'react';
import { StIcon } from '../shell/icons.jsx';

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

export function ProviderCard({ provider, onChanged }) {
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

export function TranscriptionEngineCard() {
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

  // 06 ad-settings: the engine is ONE select row ("Subtitles · Auto"); what Auto resolves to and the save
  // outcome ride under it as hints. Maude never switches engines behind your back — a pinned choice stays.
  return (
    <div className="v2s-eng" data-testid="settings-transcription-select">
      <label className="v2s-row">
        <span className="v2s-row-t">
          <span className="v2s-row-k">Subtitles</span>
        </span>
        <select
          className="v2s-select"
          aria-label="Transcription engine"
          data-testid="settings-transcription-engine"
          value={engine ?? 'auto'}
          disabled={busy || engine === null}
          onChange={(e) => choose(e.target.value)}
        >
          {TRANSCRIPTION_ENGINES.map((e) => (
            <option key={e.id} value={e.id} title={e.note}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      {engine === 'auto' && auto && (
        <p className="v2s-hint">
          Right now Auto uses <strong>{ENGINE_LABELS[auto.engine] || auto.engine}</strong> —{' '}
          {auto.reason}
          {auto.cloud && ' Audio is uploaded to that provider and billed to your account.'}
        </p>
      )}
      {status && (
        <p className="v2s-hint" role="status" data-ok={status.ok ? 'true' : 'false'}>
          {status.msg}
        </p>
      )}
    </div>
  );
}

// 06 ad-settings `ModelCard`: a quiet box per model — name + size on the first line, the status word and ONE
// action on the second. The note rides the tooltip (the board draws none); install commands sit under the list.
function ModelBox({ name, size, tone, word, action, title, testid }) {
  return (
    <div className="v2s-model" data-testid={testid} title={title}>
      <span className="v2s-model-hd">
        <strong>{name}</strong>
        <span className="v2s-model-sz">{size}</span>
      </span>
      <span className="v2s-model-st">
        <span className="dg-word" data-tone={tone}>
          {word}
        </span>
        {action}
      </span>
    </div>
  );
}

// Task 2.7 (approach A) — one-click local whisper.cpp models. The engine binary
// is still a soft dep, but the MODEL half is one click: download a ggml model
// into a Maude-managed cache and `--provider whisper` auto-resolves it. Polls
// the download progress from the privileged /_api/generate/whisper-model route.
export function WhisperModelCard() {
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
    <div className="v2s-models" data-testid="settings-whisper-models">
      {state === null && !err && <p className="v2s-hint">Loading…</p>}
      {err && (
        <p className="v2s-hint" role="alert" data-ok="false">
          {err}
        </p>
      )}
      {dl?.error && (
        <p className="v2s-hint" role="alert" data-ok="false">
          Download of {dl.id} failed: {dl.error}
        </p>
      )}
      {(state?.models || []).map((m) => {
        const busy = dl && !dl.error && dl.id === m.id;
        return (
          <ModelBox
            key={m.id}
            testid={`settings-whisper-model-${m.id}`}
            name={`whisper.cpp · ${m.label}`}
            size={`${m.sizeMB} MB`}
            title={m.note}
            tone={m.downloaded ? 'ok' : busy ? 'info' : 'off'}
            word={
              m.downloaded
                ? 'On this Mac'
                : busy
                  ? `Downloading… ${pctOf(dl.received, dl.total)}%`
                  : 'Not downloaded'
            }
            action={
              m.downloaded ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => remove(m.id)}
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!(dl && !dl.error)}
                  onClick={() => download(m.id)}
                >
                  {busy ? 'Downloading…' : 'Download'}
                </button>
              )
            }
          />
        );
      })}
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
                {modelsReady ? 'Model ready' : 'Download a model (above)'}
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

export function KeyframeEngineCard() {
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

  // 06 ad-settings: "Video keyframes · Auto" is one select row; an unavailable pick says how to fix it under it.
  return (
    <div className="v2s-eng" data-testid="settings-keyframe-select">
      <label className="v2s-row">
        <span className="v2s-row-t">
          <span className="v2s-row-k">Video keyframes</span>
        </span>
        <select
          className="v2s-select"
          aria-label="Keyframe engine"
          data-testid="settings-keyframe-engine"
          value={engine ?? 'auto'}
          disabled={busy || engine === null}
          onChange={(e) => choose(e.target.value)}
        >
          {KEYFRAME_ENGINES.map((e) => (
            <option key={e.id} value={e.id} title={e.note}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      {status && (
        <p className="v2s-hint" role="status" data-ok={status.ok ? 'true' : 'false'}>
          {status.msg}
        </p>
      )}
    </div>
  );
}

// A copy/paste terminal command with a Copy button (same look as the ACP
// readiness rows — the rdy-* classes are global in the bundled stylesheet).
export function CopyCommand({ command, label, ghost = false, text }) {
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
  // 06 ad-settings `CopyBtn`: a ghost button with the duplicate glyph and a plain-words label; the command itself
  // is on the tooltip (it is a thing to paste, not to read).
  if (ghost)
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={copy}
        // WCAG 2.5.3: the name starts with the visible words; the rest says which command
        aria-label={`${text ?? 'Copy command'}, ${String(label || '').replace(/^Copy (the )?/, '')}`}
        title={command}
      >
        <StIcon name="duplicate" size={14} />
        {copied ? 'Copied' : (text ?? 'Copy command')}
      </button>
    );
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
export function GemmaModelCard() {
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
    <div className="v2s-models" data-testid="settings-gemma-models">
      {state && !scoutReady && <SetupSteps state={state} />}
      {state && (
        <p className="v2s-hint">
          Active tier on this machine: <strong>{activeTier}</strong>
          {scoutReady && !mlx && ' — Ollama manages its own models, nothing to download below.'}
        </p>
      )}
      {err && (
        <p className="v2s-hint" role="alert" data-ok="false">
          {err}
        </p>
      )}
      {dl?.error && (
        <p className="v2s-hint" role="alert" data-ok="false">
          Download of {dl.id} failed: {dl.error}
        </p>
      )}
      {state === null && !err && <p className="v2s-hint">Loading…</p>}
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
          <ModelBox
            key={m.id}
            testid={`settings-gemma-model-${m.id}`}
            name={m.label}
            size={`${Math.round(m.sizeMB / 100) / 10} GB`}
            title={m.note}
            tone={m.downloaded ? 'ok' : busy ? 'info' : 'off'}
            word={
              m.downloaded
                ? 'On this Mac'
                : busy
                  ? `${m.runtime === 'ollama' ? 'Pulling' : 'Downloading'}… ${pctOf(dl.received, dl.total)}%`
                  : runtimeReady
                    ? 'Not downloaded'
                    : blockedNote
            }
            action={
              m.downloaded ? null : (
                // Each row is enabled by ITS OWN runtime — an Ollama model is one click whenever Ollama is
                // running (the server pulls it through /api/pull); an mlx snapshot needs mlx-vlm.
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!runtimeReady || !!(dl && !dl.error)}
                  onClick={() => download(m.id)}
                >
                  {busy ? 'Downloading…' : 'Download'}
                </button>
              )
            }
          />
        );
      })}
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
export function FigmaConnectCard() {
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
        <button
          type="button"
          className="st-btn"
          disabled={busy}
          onClick={probe}
          data-testid="figma-test"
        >
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

// feature-configurable-panel-docking — the panels the Layout tab can dock. Order
// = display order. (Assistant is native-only; moving it is a no-op in the browser.)
const LAYOUT_PANELS = [
  { id: 'tree', label: 'Canvases' },
  { id: 'layers', label: 'Layers' },
  { id: 'assets', label: 'Assets' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'comments', label: 'Comments' },
  // CONTRACT §3: the panel is "Version history" (it was "Changes" — a v1 word the table bans). The id stays.
  { id: 'changes', label: 'Version history' },
  { id: 'assistant', label: 'AI chat panel' },
];

// `labelledBy` is the id of the row's visible label, so each group is announced by the panel it moves
// ("Canvases, Left") instead of seven identical "Panel side" groups.
// S11.18 (a11y): a radiogroup is ONE tab stop — the checked side takes Tab, the arrows move and choose (the seven
// groups here were fourteen stops). Left/Up pick Left, Right/Down pick Right, and focus follows the choice.
export function SideToggle({ value, disabled, onChange, testId, labelledBy }) {
  const onKeyDown = (e) => {
    const to =
      e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? 'left'
        : e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 'right'
          : null;
    if (!to || disabled) return;
    e.preventDefault();
    if (to !== value) onChange(to);
    const sibs = e.currentTarget.querySelectorAll('[role="radio"]');
    sibs[to === 'left' ? 0 : 1]?.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a two-state segmented control, not a form field
    <span
      className="st-sidetoggle"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : 'Panel side'}
      data-testid={testId}
      onKeyDown={onKeyDown}
    >
      {['left', 'right'].map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          tabIndex={value === s ? 0 : -1}
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
export function LayoutTab({ panelSide, onSetPanelSide, layersMode, onSetLayersMode }) {
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
          Put each panel on the left or the right. The AI chat is its own panel and shows beside the
          rest; Canvases, Layers and Assets share one panel with tabs.
        </div>
        {LAYOUT_PANELS.map((p) => {
          const disabled = p.id === 'layers' && layersMode !== 'separate';
          return (
            <div key={p.id} className={'st-pref-row' + (disabled ? ' is-disabled' : '')}>
              <span className="st-pref-body">
                <span className="st-pref-label" id={`panel-side-label-${p.id}`}>
                  {p.label}
                </span>
                {disabled && (
                  <span className="st-pref-note">
                    Layers is inside the Inspector — choose “Separate panel” above to dock it.
                  </span>
                )}
              </span>
              <SideToggle
                testId={`panel-side-${p.id}`}
                labelledBy={`panel-side-label-${p.id}`}
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
export function PrefToggleRow({ label, note, checked, disabled, reason, onChange }) {
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
  { id: 'light', label: 'Light', note: 'Light panels and menus' },
  { id: 'dark', label: 'Dark', note: 'Dark panels and menus' },
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
export function AppearanceTab({ theme, onSetTheme, cpMode, onSetCpMode }) {
  return (
    <>
      <div className="st-provider-card">
        <div className="st-provider-hd">
          <span className="st-provider-name">Theme</span>
        </div>
        <div className="st-provider-notes">
          Sets the look of the panels, toolbar and canvas background. Artboards keep their own
          design system.
        </div>
        <div
          className="st-engine-radios"
          role="radiogroup"
          aria-label="Theme"
          data-testid="settings-theme"
        >
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
          How the inspector names its controls. The small toggle in the inspector’s corner flips it
          too — this choice is remembered.
        </div>
        <div
          className="st-engine-radios"
          role="radiogroup"
          aria-label="Inspector vocabulary"
          data-testid="settings-inspector-vocabulary"
        >
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

/**
 * The AI-media provider keys (feature-ai-media-generation). Kept mounted by its caller so the
 * provider fetch runs once. A key is POSTed to the privileged main-origin route and never echoed
 * back; this list only ever shows a masked "configured" state.
 */
export function ProviderKeys() {
  const [providers, setProviders] = useState(null); // null = loading
  const [error, setError] = useState(null);

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

  return (
    <>
      <p className="st-settings-intro">
        Bring your own API keys to generate images (and, soon, audio + video) inside Maude. Keys are
        stored on this machine only — in your OS keychain or a private{' '}
        <code>~/.config/maude/keys.json</code> (mode 0600) — sent straight to the provider, and
        never committed, logged, or exposed to a canvas.
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
      {providers?.length === 0 && <div className="st-settings-intro">No providers registered.</div>}
    </>
  );
}
