// client/v2/history/compare-view.jsx — S1.15: Compare two versions (11 · pn-compare, V2-1.9 §5.7).
//
//   ┌────────────────────┬────────────────────┐
//   │ A · Schváleno …    │ B · Now · 6 Oct …  │   two isolated, read-only canvas frames — Side by side,
//   └────────────────────┴────────────────────┘   or Overlay (B over A, a slider between)
//   Side by side | Overlay        4 changes between A and B — 3 on Venkovní dres · přední, 1 on Helma z boku
//   ● Venkovní dres   Dres: černá → zelená                          ✦ Made by AI, 14:32
//
// The frames are the canvas at `?sha=<ref>` with `ro=1&comments=0` (S1.14's Viewing) plus `hide-chrome`: two
// documents, because both versions' CSS cannot share one. Now is the live canvas, read-only. Neither frame
// persists a camera or a layout. The words and who-made-what come from `GET /_api/project/changes`; the A / B
// marks, Stop comparing and the two restores live in Version history (history-panel.jsx), where the rows are.
//
//   CompareView   the picture (props only, so it tests without a studio)
//   CompareHost   binds it to the Compare store + the Viewing hold and reads the changes

import { useCallback, useEffect, useRef } from 'react';
import { canvasUrl } from '../../canvas-url.js';
import { JUMP_LADDER_MS, planJump } from '../canvases/jump-model.js';
import { COMPARE_WORDS as W, focusGroup, groupByArtboard, summaryLine } from './blame.js';
import { ChangeList } from './change-list.jsx';
import { useIslandInsets } from './clear-band.js';
import { compareStore, useCompare } from './compare-store.js';
import { useViewing } from './history-host.jsx';

/** `GET /_api/project/changes` for one pair. */
export function changesUrl({ path, from, to }) {
  return `/_api/project/changes?${new URLSearchParams({ path, from, to })}`;
}

/**
 * The frame's address for one side. A past version is S1.14's Viewing URL (`sha`, `ro=1`, `comments=0`);
 * Now is the embed URL (read-only, no comment layer, keeps its camera to itself). Both hide the chrome.
 * Built once per (path, ref): a re-minted capability must not reload a frame that is on screen.
 */
function useFrameSrc(path, cfg, at) {
  const kept = useRef({ key: '', src: '' });
  const key = `${path}|${at}`;
  if (kept.current.key !== key) {
    const opts =
      at === 'now' ? { embed: true, hideChrome: true } : { viewing: at, hideChrome: true };
    kept.current = { key, src: canvasUrl(path, cfg, opts) };
  }
  return kept.current.src;
}

/** Take the camera of both frames to one artboard — `zoom-to-artboard`, today's jump (S1.3), repeated
 *  on a short ladder because a frame mounts late. */
// the held version's frames only reveal the artboard; the Viewing selection is not theirs to change
const SELECTION_MESSAGES = new Set(['select-by-id']);

function useFrameFocus(frames, path, focus, trigger) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `trigger` re-arms it when a frame is replaced
  useEffect(() => {
    if (!focus) return undefined;
    const plan = planJump({ activePath: path, path, artboardId: focus, reducedMotion: true });
    const messages = plan.messages.filter((m) => !SELECTION_MESSAGES.has(m.dgn));
    const post = () => {
      for (const f of frames.current)
        for (const m of messages) f?.contentWindow?.postMessage(m, '*');
    };
    const timers = [0, ...JUMP_LADDER_MS].map((ms) => setTimeout(post, ms));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [focus, path, trigger, frames]);
}

/** The canvas frames start dark (no `dgn:'theme'` reaches a frame the shell does not track): tell both the chrome's theme on a
 *  short ladder (a frame mounts late) and again whenever it flips — 11 · pn-compare is the light canvas in light. */
export function useFrameTheme(frames, trigger) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `trigger` re-arms it when a frame is replaced
  useEffect(() => {
    const post = () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      for (const f of frames.current) {
        try {
          f?.contentWindow?.postMessage({ dgn: 'theme', theme }, '*');
        } catch {
          /* frame navigated away — the next rung re-posts */
        }
      }
    };
    const timers = [0, 300, 1200, 2500, 5000].map((ms) => setTimeout(post, ms));
    // a frame that loads late (bundling a canvas can take longer than the ladder) says `loaded`: ladder again from then
    const onMessage = (e) => {
      if (e.data?.dgn !== 'loaded' || !frames.current.some((f) => f?.contentWindow === e.source))
        return;
      for (const ms of [0, 300, 1200, 2500]) timers.push(setTimeout(post, ms));
    };
    window.addEventListener('message', onMessage);
    const mo = new MutationObserver(post);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      for (const t of timers) clearTimeout(t);
      window.removeEventListener('message', onMessage);
      mo.disconnect();
    };
  }, [frames, trigger]);
}

function Frame({ src, title, label, fref, testid }) {
  return (
    <div className="cmp-pane">
      <p className="cmp-cap" data-testid={`${testid}-cap`}>
        {label}
      </p>
      <iframe
        ref={fref}
        className="cmp-frame"
        src={src}
        title={title}
        tabIndex={-1}
        data-testid={testid}
      />
    </div>
  );
}

const capOf = (mark, w) =>
  `${mark} · ${w.title}${w.when ? ` · ${w.when}` : ''}${w.who ? ` · ${w.who}` : ''}`;

/**
 * @param p.state     the Compare store's state `{ path, a, b, mode, focus, rows, answer }`
 * @param p.cfg       `/_config` (the canvas URL needs the design root, tokens and the capability)
 * @param p.onMode    ('side' | 'overlay')
 * @param p.onFocus   (artboardId)
 * @param p.onRetry   re-read the changes
 */
export function CompareView({ state, cfg, onMode, onFocus, onRetry }) {
  const { path, a, b, mode, focus, rows, answer } = state;
  const srcA = useFrameSrc(path, cfg, a.at);
  const srcB = useFrameSrc(path, cfg, b.at);
  const frames = useRef([null, null]);
  const wipe = useRef(50);
  const stageRef = useRef(null);
  const viewRef = useRef(null);
  // S1.23: the A / B frames and the change list stay clear of the floating panels (V2-4.1 insets)
  const inset = useIslandInsets(viewRef);
  const groups = answer.status === 'ready' ? groupByArtboard(answer.changes, answer.labels) : [];
  const target = focusGroup(groups, focus);
  const focusId = target?.id ?? null;
  useFrameFocus(frames, path, focusId, `${srcA}|${srcB}|${mode}`);
  useFrameTheme(frames, `${srcA}|${srcB}|${mode}`);

  const setWipe = useCallback((v) => {
    wipe.current = v;
    stageRef.current?.style.setProperty('--cmp-wipe', `${v}%`);
  }, []);

  return (
    <section
      ref={viewRef}
      className="cmp-view"
      aria-label="Comparing two versions"
      data-testid="cmp-view"
      style={{
        '--cmp-in-t': `${inset.top}px`,
        '--cmp-in-r': `${inset.right}px`,
        '--cmp-in-b': `${inset.bottom}px`,
        '--cmp-in-l': `${inset.left}px`,
      }}
    >
      <div
        ref={stageRef}
        className={`cmp-stage cmp-${mode}`}
        data-mode={mode}
        data-testid="cmp-stage"
        style={{ '--cmp-wipe': `${wipe.current}%` }}
      >
        <Frame
          src={srcA}
          title={W.frameA}
          label={capOf('A', a)}
          fref={(el) => {
            frames.current[0] = el;
          }}
          testid="cmp-frame-a"
        />
        <Frame
          src={srcB}
          title={W.frameB}
          label={capOf('B', b)}
          fref={(el) => {
            frames.current[1] = el;
          }}
          testid="cmp-frame-b"
        />
      </div>
      <div className="cmp-bar">
        {/* biome-ignore lint/a11y/useSemanticElements: a two-way segmented control, not a form fieldset */}
        <span className="vh-seg cmp-seg" role="group" aria-label="How to compare">
          {[
            ['side', W.sideBySide],
            ['overlay', W.overlay],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="vh-seg-b"
              aria-pressed={mode === id}
              data-testid={`cmp-mode-${id}`}
              onClick={() => onMode?.(id)}
            >
              {label}
            </button>
          ))}
        </span>
        {mode === 'overlay' ? (
          <input
            type="range"
            className="cmp-wipe"
            min="0"
            max="100"
            defaultValue={wipe.current}
            aria-label={W.wipe}
            data-testid="cmp-wipe"
            onInput={(e) => setWipe(Number(e.currentTarget.value))}
          />
        ) : null}
        <span className="cmp-n" data-testid="cmp-summary" role="status">
          {answer.status === 'ready'
            ? summaryLine(groups, answer.changes?.length ?? 0)
            : answer.status === 'loading'
              ? W.loading
              : answer.status === 'legacy'
                ? W.legacy
                : `${W.failed}. ${W.failedNote}`}
        </span>
        {answer.status === 'error' ? (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="cmp-retry"
            onClick={() => onRetry?.()}
          >
            {W.retry}
          </button>
        ) : null}
      </div>
      {answer.status === 'ready' && groups.length ? (
        <div className="cmp-scroll">
          <ChangeList
            groups={groups}
            blame={answer.blame}
            rows={rows}
            detail={answer.detail}
            focus={focusId}
            onFocus={onFocus}
          />
        </div>
      ) : null}
    </section>
  );
}

/** Read the changes between A and B. A new pair (or Retry) reads again; an old read never lands late. */
export function useChanges({ state, fetchImpl }) {
  const path = state?.path;
  const from = state?.a.at;
  const to = state?.b.at;
  const nonce = useRef(0);
  const run = useCallback(async () => {
    if (!path || !from || !to) return;
    const me = ++nonce.current;
    compareStore.setAnswer({ status: 'loading' });
    let answer;
    try {
      const f = fetchImpl || ((...x) => fetch(...x));
      const r = await f(changesUrl({ path, from, to }), { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (j?.ok)
        answer = {
          status: 'ready',
          changes: j.changes ?? [],
          detail: j.detail ?? {},
          blame: j.blame ?? {},
          labels: j.labels ?? {},
        };
      else answer = { status: j?.reason === 'legacy' ? 'legacy' : 'error' };
    } catch {
      answer = { status: 'error' };
    }
    if (me === nonce.current) compareStore.setAnswer(answer);
  }, [path, from, to, fetchImpl]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a pair of versions is the "read again" signal
  useEffect(() => {
    run();
    return () => {
      nonce.current += 1;
    };
  }, [run]);
  return run;
}

/**
 * Compare in the canvas area: nothing unless a Compare is on AND the hold still stands (esc, another canvas in
 * front, or a restore ends Viewing — and Compare with it).
 */
export function CompareHost({ cfg, fetchImpl }) {
  const state = useCompare();
  const viewing = useViewing();
  const live = !!state && !!viewing && viewing.path === state.path;
  useEffect(() => {
    if (state && !live) compareStore.stop();
  }, [state, live]);
  const retry = useChanges({ state: live ? state : null, fetchImpl });
  if (!live) return null;
  return (
    <CompareView
      state={state}
      cfg={cfg}
      onMode={(m) => compareStore.setMode(m)}
      onFocus={(id) => compareStore.setFocus(id)}
      onRetry={retry}
    />
  );
}
