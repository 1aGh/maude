// client/v2/handoff/handoff-sheet.jsx — S8.10: Handoff to production ⇧⌘H (09 Export · ex-handoff,
// ex-handoff-ready, ex-handoff-edges). Menu › File › Handoff to production, ⌘K, the inspector's
// Handoff…, Export › Other… › Code…, and Design system › Hand off tokens (S10.19, `target: 'tokens'`)
// all land here through `setExportDialog({ mode: 'handoff', … })` (export-sheet.jsx renders this).
//
//   pick   the targets from the project's settings (web registry, React Native, Lottie — off with its
//          reason when nothing moves — and a design system's tokens); Use the design system; the last
//          review's blockers as a note that travels with the code. ↵ = Hand off.
//   connect  AI isn't connected yet: the one connect sheet, then the handoff you asked for runs.
//   drafting AI drafts the code as ONE scoped run (its write scope is the target file only — server).
//   queued   offline or waiting: it starts by itself and lands in Exports.
//   ready    one thing to copy; Advanced holds the file, Claude Code and the terminal lines.
//
// Needs Can edit (it writes code into the project): the shell never opens it for Can comment (S8.9),
// and the server refuses the POST for every role below edit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAiRuns } from '../ai/runs-store.js';
import { connectClaude } from '../ai/connect-flow.js';
import { StIcon } from '../../shell/icons.jsx';
import { DigitalIcon, WebIcon } from '../canvases/canvas-icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { HandoffConnect, QueuedLine, ReviewHint } from './edges.jsx';
import { ReadyCard } from './ready-card.jsx';
import {
  ADVANCED_HINT,
  DRAFTING,
  FAILED,
  HANDOFF_VERB,
  handoffSub,
  handoffTitle,
  initialTarget,
  LAST_USED,
  readLastUsed,
  USE_DS_LABEL,
  dsTokensSub,
  writeLastUsed,
} from './targets.js';

const POLL_MS = 2500;

/** The target's glyph: a browser (web), a phone (app), a play triangle (Lottie), a swatch grid (tokens). */
function TargetIcon({ kind }) {
  if (kind === 'web') return <WebIcon size={16} />;
  if (kind === 'rn') return <DigitalIcon size={16} />;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'lottie' ? (
        <path d="M5.5 3.5l7 4.5-7 4.5z" />
      ) : (
        <>
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
        </>
      )}
    </svg>
  );
}
const json = (r) => r.json().catch(() => null);

function query(subject) {
  return subject.canvas
    ? `canvas=${encodeURIComponent(subject.canvas)}`
    : `ds=${encodeURIComponent(subject.ds ?? '')}`;
}

/**
 * @param {{ subject: { canvas?: string|null, ds?: string|null }, name: string, askedTarget?: string|null,
 *   onClose: () => void, onBack?: (() => void)|null, onShowOnCanvas?: (() => void)|null,
 *   fetchImpl?: typeof fetch }} props
 */
export function HandoffSheet({
  subject,
  name: nameProp,
  askedTarget = null,
  onClose,
  onBack = null,
  onShowOnCanvas = null,
  fetchImpl,
}) {
  const doFetch = useMemo(() => fetchImpl ?? ((...a) => fetch(...a)), [fetchImpl]);
  const [info, setInfo] = useState(null); // GET /_api/handoff/targets
  const [pick, setPick] = useState(null);
  const [useDs, setUseDs] = useState(true);
  const [phase, setPhase] = useState('pick'); // pick | connect | drafting | queued | ready | failed
  const [connectPhase, setConnectPhase] = useState('idle');
  const [connectError, setConnectError] = useState(null);
  const [started, setStarted] = useState(null); // the POST answer
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [advOpen, setAdvOpen] = useState(false);
  const primary = useRef(null);
  const abortRef = useRef(null);
  // Focus the primary button on open, but only while it can take focus: Hand off is `disabled` until
  // the targets have arrived and one is picked, and a disabled button keeps the focus where it was
  // (behind the sheet, so Esc and ↵ never reached it). Then the dialog itself takes it.
  const pickedRef = useRef(null);
  const initialFocus = useMemo(
    () => ({
      get current() {
        const b = primary.current;
        return b && !b.disabled ? b : pickedRef.current;
      },
    }),
    []
  );
  // The sheet's own onKeyDown handles esc; 'bubble' is the net under it — with focus dropped to <body> (the Hand
  // off button disables itself the moment it is pressed) esc reached nobody (P8 B1).
  const root = useModalFocus({
    onClose: () => {
      if (phase === 'connect') abortRef.current?.abort();
      onClose();
    },
    esc: 'bubble',
    initialRef: initialFocus,
  });
  const runs = useAiRuns();
  const lastUsed = useMemo(() => readLastUsed(), []);
  const q = query(subject);

  useEffect(() => {
    let live = true;
    doFetch(`/_api/handoff/targets?${q}`)
      .then(json)
      .then((d) => {
        if (!live || !d || !Array.isArray(d.targets)) return;
        setInfo(d);
        const t = initialTarget(d.targets, { asked: askedTarget, last: lastUsed });
        setPick(t?.id ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [doFetch, q, askedTarget, lastUsed]);

  const targets = info?.targets ?? [];
  const target = targets.find((t) => t.id === pick) ?? null;
  const name = info?.subject?.name || nameProp;
  const ds = info?.subject?.ds ?? subject.ds ?? null;

  const post = useCallback(async () => {
    if (!target) return;
    setError(null);
    const res = await doFetch('/_api/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...subject, target: target.id, useDs }),
    }).catch(() => null);
    const body = res ? await json(res) : null;
    if (!res || !body?.ok) {
      setError(body?.words || 'This handoff did not start. Try again.');
      setPhase('pick');
      return;
    }
    writeLastUsed(target.id);
    setStarted(body);
    setPhase(body.status === 'queued' ? 'queued' : 'drafting');
  }, [doFetch, subject, target, useDs]);

  const submit = () => {
    if (phase !== 'pick' || !target || target.off) return;
    if (info && info.connected === false) {
      setPhase('connect');
      return;
    }
    void post();
  };

  const connect = async () => {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setConnectError(null);
    setConnectPhase('waiting');
    const r = await connectClaude({ signal: ctl.signal, onPhase: setConnectPhase });
    abortRef.current = null;
    setConnectPhase('idle');
    if (!r.ok) {
      if (r.reason !== 'cancelled') setConnectError(r.reason);
      return;
    }
    // the status probe is what tells the server's gate it is connected now
    await doFetch('/_api/acp/status').catch(() => null);
    void post();
  };

  // drafting → ready: the run's file appears, or the run ended without it
  const run = started?.runId ? runs.view?.mine?.find((r) => r.runId === started.runId) : null;
  const runFailed = run?.state === 'ended' && run.outcome && run.outcome !== 'done';
  useEffect(() => {
    if (phase !== 'drafting' || !target) return;
    let live = true;
    const tick = async () => {
      const d = await doFetch(`/_api/handoff/result?${q}&target=${encodeURIComponent(target.id)}`)
        .then(json)
        .catch(() => null);
      if (!live) return;
      if (d?.exists) {
        setContent(d.content ?? null);
        setStarted((s) => ({ ...s, ready: d.ready ?? s?.ready }));
        setPhase('ready');
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, target, doFetch, q]);
  useEffect(() => {
    if (phase === 'drafting' && runFailed) setPhase('failed');
  }, [phase, runFailed]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (phase === 'connect') abortRef.current?.abort();
      onClose();
      return;
    }
    if (e.key === 'Enter' && !e.defaultPrevented && !e.shiftKey && phase === 'pick') {
      const t = e.target;
      const isCheck = t.tagName === 'INPUT' && t.type === 'checkbox';
      if (t.getAttribute?.('role') === 'radio' || isCheck || t === e.currentTarget) {
        e.preventDefault();
        submit();
      }
    }
  };

  const showDs = !!ds && target && target.kind !== 'tokens';
  const ready = started?.ready ?? null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim closes the sheet on a press outside it
    <div
      className="ex-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={root}
        className="ex-sheet island ho-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ho-title"
        tabIndex={-1}
        data-testid="export-sheet"
        data-mode="handoff"
        data-phase={phase}
        onKeyDown={onKeyDown}
      >
        <div className="ex-sheet-hd" data-testid="handoff-sheet">
          <h2 className="ex-title" id="ho-title" data-testid="export-title">
            {handoffTitle(name)}
          </h2>
          {handoffSub(ds) ? <p className="ex-sheet-sub">{handoffSub(ds)}</p> : null}
        </div>

        {phase === 'pick' ? (
          <>
            {/* biome-ignore lint/a11y/useSemanticElements: a radio group of rich rows (title + line + chip) */}
            <div
              className="ho-targets"
              role="radiogroup"
              aria-label="Where the code goes"
              data-testid="export-handoff-body"
            >
              {targets.map((t) => (
                // biome-ignore lint/a11y/useSemanticElements: a rich radio row
                <div
                  key={t.id}
                  ref={t.id === pick ? pickedRef : null}
                  role="radio"
                  tabIndex={t.id === pick ? 0 : -1}
                  aria-checked={t.id === pick}
                  aria-disabled={t.off ? 'true' : undefined}
                  className={`ho-target${t.id === pick ? ' ho-target--on' : ''}${t.off ? ' ho-target--off' : ''}`}
                  data-testid={`handoff-target-${t.id}`}
                  data-kind={t.kind}
                  onClick={() => (t.off ? null : setPick(t.id))}
                  onKeyDown={(e) => {
                    if ((e.key === ' ' || e.key === 'Spacebar') && !t.off) {
                      e.preventDefault();
                      setPick(t.id);
                    }
                    // ← ↑ → ↓ move to the next target that can be picked, and pick it (one tab stop, as a radio group)
                    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
                    if (step) {
                      const live = targets.filter((x) => !x.off);
                      if (live.length === 0) return;
                      e.preventDefault();
                      const at = Math.max(
                        0,
                        live.findIndex((x) => x.id === pick)
                      );
                      const to = live[(at + step + live.length) % live.length];
                      setPick(to.id);
                      e.currentTarget.parentElement
                        ?.querySelector(`[data-testid="handoff-target-${to.id}"]`)
                        ?.focus();
                    }
                  }}
                >
                  <span className="ho-radio" aria-hidden="true" />
                  <span className="ho-target-ic" aria-hidden="true">
                    <TargetIcon kind={t.kind} />
                  </span>
                  <span className="ho-target-t">
                    {t.title}
                    {t.id === lastUsed && !t.off ? (
                      <span className="chip ho-chip">{LAST_USED}</span>
                    ) : null}
                  </span>
                  <span className="ho-target-s">{t.off ?? t.sub}</span>
                </div>
              ))}
            </div>
            {showDs ? (
              <label className="ho-check" data-testid="handoff-use-ds">
                <input
                  type="checkbox"
                  checked={useDs}
                  onChange={(e) => setUseDs(e.target.checked)}
                />
                <span>
                  {USE_DS_LABEL}
                  <span className="ho-check-s">{dsTokensSub(ds)}</span>
                </span>
              </label>
            ) : null}
            {info ? <ReviewHint review={info.review} onShowOnCanvas={onShowOnCanvas} /> : null}
            {target?.outRel && advOpen ? (
              <div className="k-adv ho-adv" data-open="true">
                <div className="ho-adv-body">
                  <span className="ho-kv">
                    <span>Writes</span>
                    <span className="k-mono">{target.outRel}</span>
                  </span>
                  <span className="ho-kv">
                    <span>Targets</span>
                    <span className="k-mono">.design/config.json · handoff.targets</span>
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {phase === 'connect' ? (
          <HandoffConnect
            phase={connectPhase}
            error={connectError}
            onConnect={connect}
            onCancel={() => {
              abortRef.current?.abort();
              setPhase('pick');
            }}
          />
        ) : null}
        {phase === 'drafting' ? (
          <p className="ho-drafting" data-testid="handoff-drafting" role="status">
            {DRAFTING(name)}
          </p>
        ) : null}
        {phase === 'queued' ? <QueuedLine words={started?.words} /> : null}
        {phase === 'failed' ? (
          <p className="ex-status ex-status--err" data-testid="handoff-failed" role="status">
            {FAILED}
          </p>
        ) : null}
        {phase === 'ready' && ready && target ? (
          <ReadyCard kind={target.kind} name={name} ready={ready} content={content} />
        ) : null}
        {error ? (
          <p className="ex-status ex-status--err" data-testid="export-status" role="status">
            {error}
          </p>
        ) : null}

        {phase === 'connect' ? null : (
          <div className="ex-sheet-a">
            {onBack && phase === 'pick' ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
                Back to export
              </button>
            ) : phase === 'pick' && target?.outRel ? (
              <button
                type="button"
                className="v2-fold-btn ex-adv-btn"
                aria-expanded={advOpen}
                data-testid="handoff-advanced"
                onClick={() => setAdvOpen((v) => !v)}
              >
                <span className="v2-fold-ch">
                  <StIcon name="chevron-right" size={12} />
                </span>
                Advanced
                <span className="v2-fold-hint">{ADVANCED_HINT}</span>
              </button>
            ) : (
              <span />
            )}
            <span className="ex-btns">
              {phase === 'pick' ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    data-testid="export-cancel"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    ref={primary}
                    type="button"
                    className="btn btn--primary ex-go"
                    data-testid="export-submit"
                    disabled={!target || !!target.off}
                    onClick={submit}
                  >
                    <span data-testid="export-submit-label">{HANDOFF_VERB}</span>
                    <span className="ex-ret" aria-hidden="true">
                      ↵
                    </span>
                  </button>
                </>
              ) : (
                <button
                  ref={primary}
                  type="button"
                  className="btn"
                  data-testid="handoff-close"
                  onClick={onClose}
                >
                  Close
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
