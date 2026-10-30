// client/v2/timeline/other-takes.jsx — S7.15 (07 · ve-ai-adjust): "A hand edit is just an edit."
//
// Select a clip and ask for its other takes: the other good moments of the same source (from its footage
// analysis), each shown with its seconds, AI's pick marked ✦. Click one and it is swapped in at the same length
// and the same place — nothing ripples, the cut stays on the beat. The swap is `video.take.swap` through the one
// clip pipe, so it is one ordinary edit: ⌘Z takes it back, then AI's own work, in that order.
//
// It opens from the clip inspector's "Other takes…" and ⌘K (`video.take.swap`); a click on a take, Esc, or
// selecting another clip closes it. Nothing is stored here.
//
//   OtherTakesPop   the drawing (props in, callbacks out — a test drives it)
//   OtherTakesHost  the wiring (selected clip → its source's footage → the model → the one write pipe)

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { portalToBody } from '../portal-scope.jsx';
import { shellToast } from '../../shell/util.js';
import { Spark } from '../ai/icons.jsx';
import { swapParams, TAKES_WORDS, takesOf } from './other-takes-model.js';
import { assetOfSrc, loadFootage } from './other-takes-store.js';
import { reasonProps } from '../access/disabled-reason.js';

// ── open state: a per-viewer UI fact, never stored ─────────────────────────────────────────────────────────
let openFor = null; // { stableId } | null
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

export const otherTakesUi = {
  get: () => openFor,
  /** Open for the selected clip (the host resolves which one). */
  open() {
    if (openFor) return;
    openFor = { stableId: null };
    notify();
  },
  close() {
    if (!openFor) return;
    openFor = null;
    notify();
  },
  /** The host pins the clip it opened on, so a different selection closes the pop. */
  pin(stableId) {
    if (!openFor || openFor.stableId === stableId) return;
    openFor = { stableId };
    notify();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
  /** Tests only. */
  reset() {
    openFor = null;
    notify();
  },
};

export function useOtherTakesUi() {
  useSyncExternalStore(otherTakesUi.subscribe, otherTakesUi.version, otherTakesUi.version);
  return otherTakesUi.get();
}

/** Where the clip is on screen: the pop sits above it. Null when it cannot be found. */
function anchorOf(stableId) {
  if (!stableId || typeof document === 'undefined') return null;
  const esc = globalThis.CSS?.escape
    ? globalThis.CSS.escape(stableId)
    : stableId.replace(/"/g, '\\"');
  const el = document.querySelector(`[data-clip-id="${esc}"]`);
  const r = el?.getBoundingClientRect?.();
  return r && r.width > 0 ? { x: r.left + r.width / 2, top: r.top } : null;
}

/**
 * @param {{
 *   name: string,                      // the source's name ("caaftv-td-run")
 *   takes: Array<{ srcStart: number, label: string, len: string, current: boolean, pick: boolean }>,
 *   canEdit: boolean,
 *   busy?: boolean,
 *   anchor: { x: number, top: number } | null,
 *   url?: string | null,               // the source video: each take shows its first frame
 *   onPick: (take: object) => void,
 *   onClose: () => void,
 * }} p
 */
export function OtherTakesPop({
  name,
  takes,
  canEdit,
  busy = false,
  anchor,
  url = null,
  onPick,
  onClose,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const first = ref.current?.querySelector('[data-on="true"], button:not(:disabled)');
    first?.focus?.();
  }, []);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const style = anchor
    ? { left: Math.min(Math.max(anchor.x, 170), vw - 170), bottom: vh - anchor.top + 10 }
    : { left: '50%', bottom: 96 };
  return (
    <div
      ref={ref}
      className="tl-takes"
      role="dialog"
      aria-label={TAKES_WORDS.title(name)}
      data-testid="other-takes"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="tl-takes-t" data-testid="other-takes-title">
        {TAKES_WORDS.title(name)}
      </p>
      <div className="tl-takes-row">
        {takes.map((t) => (
          <button
            key={t.label}
            type="button"
            className="tl-take"
            data-testid="other-takes-take"
            data-on={t.current ? 'true' : undefined}
            data-pick={t.pick ? 'true' : undefined}
            aria-pressed={t.current}
            aria-label={`${t.label}, ${t.len}${t.pick ? `, ${TAKES_WORDS.pick}` : ''}${t.current ? `, ${TAKES_WORDS.here}` : ''}`}
            disabled={busy || !canEdit || t.current}
            {...reasonProps(!canEdit, 'viewer')}
            onClick={() => onPick(t)}
          >
            <span className="tl-take-pic" aria-hidden="true">
              {url ? (
                <video
                  src={`${url}#t=${(t.srcStart + 0.05).toFixed(2)}`}
                  preload="metadata"
                  muted
                  playsInline
                  tabIndex={-1}
                />
              ) : null}
            </span>
            <span className="tl-take-t">{t.label}</span>
            {t.pick ? (
              <small>
                <Spark size={9} />
                {TAKES_WORDS.pick}
              </small>
            ) : (
              <small>{t.len}</small>
            )}
          </button>
        ))}
      </div>
      <p className="tl-takes-foot" data-testid="other-takes-foot">
        {canEdit ? TAKES_WORDS.foot : TAKES_WORDS.readOnly}
      </p>
    </div>
  );
}

/**
 * The wiring. Rendered by the Timeline (which owns the selected clip and the one clip pipe), drawn only while
 * `otherTakesUi` is open on a clip whose source AI has watched and that has another take of its length.
 * @param {{
 *   seq: any|null, fps: number, name: string, canEdit: boolean, url?: string|null,
 *   run: (params: object) => Promise<any>,
 * }} p
 */
export function OtherTakesHost({ seq, fps, name, canEdit, url = null, run }) {
  const ui = useOtherTakesUi();
  const stableId = seq?.stableId ?? null;
  const asset = assetOfSrc(seq?.mediaSrc);
  const visual = ['Video', 'OffthreadVideo', 'MaudeVideo'].includes(seq?.mediaTag ?? '');
  const valid = !!stableId && visual && !!asset && !seq?.loose;
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);

  // opening on something with no takes to offer says so, once; a different clip closes it
  useEffect(() => {
    if (!ui) return;
    if (!valid) {
      shellToast('Select a clip with footage to see its other takes.');
      otherTakesUi.close();
      return;
    }
    if (ui.stableId === null) otherTakesUi.pin(stableId);
    else if (ui.stableId !== stableId) otherTakesUi.close();
  }, [ui, valid, stableId]);

  useEffect(() => {
    if (!ui || !valid) {
      setAnalysis(null);
      return undefined;
    }
    let dead = false;
    loadFootage(asset).then((a) => {
      if (!dead) setAnalysis(a);
    });
    return () => {
      dead = true;
    };
  }, [ui, valid, asset]);

  const model = useMemo(
    () =>
      analysis
        ? takesOf({
            shots: analysis.shots,
            lengthFrames: seq?.duration,
            fps,
            rate: seq?.mediaProps?.playbackRate,
            trimBeforeFrames: seq?.mediaProps?.trimBefore ?? 0,
            sourceSeconds: analysis.durationSec,
          })
        : null,
    [analysis, seq, fps]
  );

  // the analysis arrived and there is nothing to offer: say why, close
  useEffect(() => {
    if (!ui || !valid || !analysis || !model) return;
    if (!Array.isArray(analysis.shots) || !analysis.shots.length) {
      shellToast(TAKES_WORDS.unwatched);
      otherTakesUi.close();
    } else if (!model.canSwap) {
      shellToast(TAKES_WORDS.none);
      otherTakesUi.close();
    }
  }, [ui, valid, analysis, model]);

  const onPick = useCallback(
    async (take) => {
      setBusy(true);
      try {
        const j = await run(swapParams(take, analysis?.durationSec));
        if (j?.ok !== false) otherTakesUi.close();
      } finally {
        setBusy(false);
      }
    },
    [run, analysis]
  );

  if (!ui || !valid || !model?.canSwap) return null;
  return portalToBody(
    <OtherTakesPop
      name={name}
      takes={model.takes}
      canEdit={canEdit}
      busy={busy}
      anchor={anchorOf(stableId)}
      url={url}
      onPick={onPick}
      onClose={() => otherTakesUi.close()}
    />
  );
}
