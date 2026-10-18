/**
 * @file       presence/canvas-presence.tsx — S9.23: the canvas half of presence (retired out of
 *             participants-chrome.tsx, whose avatar stack stays for a canvas the shell does not host).
 * @purpose    The canvas owns the room's awareness, so it is where presence is published and acted on:
 *               · publishes   `artboard`, `idleSince` (3 min idle), `surface`, `inComments`
 *               · Follow      mirror the target's camera; esc / a scroll / a click ends it (co-follow)
 *               · Go to       frame the artboard they are on
 *               · Bring       `summon` + the glide; everyone who hears it follows until esc or Stop
 *                             (co-bring, co-spotlight)
 *             The shell asks over the parent-gated `run-action` lane (ids below); the state it needs for
 *             its faces rides back on `peers` (participants-chrome `peersPayload`).
 *
 * The hook takes its collaborators as arguments (no contexts) so a test drives it with stubs.
 * Pure rules live in model.ts; field grammar in fields.ts.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForeignAwareness } from '../use-collab.tsx';
import { IDLE_MS, newSummonId, type Surface } from './fields.ts';
import {
  endsFollow,
  type FollowState,
  FRAME_DRAW_MS,
  firstName,
  followersOf,
  type GlideStep,
  glidePlan,
  leaveFollow,
  NOT_FOLLOWING,
  pickSummon,
  syncFollow,
  toggleFollow,
} from './model.ts';
import { toneColor, toneFor, YOU_TONE } from './tones.ts';

/** The `run-action` ids the shell sends: the registry's `presence.*` rows (`peer.follow` is retired). */
export const PRESENCE_RUN_IDS = {
  follow: ['presence.follow'],
  goTo: ['presence.go-to'],
  bring: ['presence.bring-everyone'],
  stop: ['presence.stop'],
  context: ['presence.context'],
} as const;

/** Nobody followed me for this long after a Bring: the ask ends itself (Stop is still there before). */
export const SPOTLIGHT_EMPTY_MS = 6000;
/** Idle is judged on this cadence. */
const IDLE_POLL_MS = 15_000;

// ── what the hook needs ──────────────────────────────────────────────────────────────────────────

export interface PresenceDeps {
  /** Publish into my awareness (throttled by the provider). */
  publish(patch: Record<string, unknown>): void;
  myClientID(): number;
  /** My cursor in world coords, if I have one. */
  myCursor(): { x: number; y: number } | null;
  /** Mirror a camera (the controller's setViewport). */
  setViewport(v: { x: number; y: number; zoom: number }): void;
  /** Frame an artboard by id; false when it is not on this canvas. */
  frameArtboard(id: string): boolean;
  /** My camera now — to place a ghost on screen. */
  camera(): { x: number; y: number; zoom: number } | null;
  /** The middle of what I am looking at, in world coords (where a Bring lands without a cursor). */
  viewCentre(): { x: number; y: number } | null;
  /** May I Bring everyone here? (edit rights — the server also strips the field without `summon`.) */
  canSummon(): boolean;
  reducedMotion(): boolean;
  now(): number;
  /** How often idle is judged (default 15 s; a test shortens it). */
  idlePollMs?: number;
  /** How long an unanswered Bring waits before it ends itself (default 6 s). */
  spotlightEmptyMs?: number;
}

export interface PresenceView {
  follow: FollowState;
  followName: string | null;
  followTone: string;
  /** I am leading a Bring: the ask's id, and how many cameras are on me. */
  leading: { id: string; followers: number } | null;
  glide: { steps: GlideStep[]; peers: Record<number, string>; at: number } | null;
  toggle(clientID: number): void;
  goTo(clientID: number): void;
  bring(): boolean;
  stop(): void;
  setContext(ctx: { inComments?: boolean; active?: boolean }): void;
}

export interface PresencePublish {
  artboard: string | null;
  surface: Surface;
}

export function usePresence(
  peers: readonly ForeignAwareness[],
  deps: PresenceDeps,
  published: PresencePublish
): PresenceView {
  const [follow, setFollow] = useState<FollowState>(NOT_FOLLOWING);
  const [leading, setLeading] = useState<{ id: string; at: number } | null>(null);
  const [glide, setGlide] = useState<PresenceView['glide']>(null);
  const live = useRef({ peers, deps, follow, leading });
  live.current = { peers, deps, follow, leading };

  // ── publish: where I am, how I am connected ───────────────────────────────────────────────────
  useEffect(() => {
    deps.publish({ artboard: published.artboard, surface: published.surface });
  }, [deps, published.artboard, published.surface]);

  // ── idle: 3 minutes without pointer / key input greys the cursor (Q9) ─────────────────────────
  const lastInput = useRef(deps.now());
  const idlePublished = useRef(false);
  const touch = useCallback(() => {
    lastInput.current = live.current.deps.now();
    if (idlePublished.current) {
      idlePublished.current = false;
      live.current.deps.publish({ idleSince: null });
    }
  }, []);
  useEffect(() => {
    const opts = { capture: true, passive: true } as const;
    const evts = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
    for (const e of evts) window.addEventListener(e, touch, opts);
    const tick = () => {
      const d = live.current.deps;
      if (!idlePublished.current && d.now() - lastInput.current >= IDLE_MS) {
        idlePublished.current = true;
        d.publish({ idleSince: lastInput.current });
      }
    };
    const t = setInterval(tick, live.current.deps.idlePollMs ?? IDLE_POLL_MS);
    return () => {
      for (const e of evts) window.removeEventListener(e, touch, opts);
      clearInterval(t);
    };
  }, [touch]);

  // ── Follow: sync with the peers (a summon moves me; a departure releases me) ───────────────────
  useEffect(() => {
    setFollow((s) => syncFollow(s, peers, live.current.deps.now()));
  }, [peers]);

  // Mirror the target's camera (skip an unchanged one).
  const lastApplied = useRef<{ x: number; y: number; zoom: number } | null>(null);
  useEffect(() => {
    if (follow.target === null) {
      lastApplied.current = null;
      return;
    }
    const v = peers.find((p) => p.clientID === follow.target)?.viewport;
    if (!v) return;
    const last = lastApplied.current;
    if (last && last.x === v.x && last.y === v.y && last.zoom === v.zoom) return;
    lastApplied.current = { x: v.x, y: v.y, zoom: v.zoom };
    deps.setViewport(v);
  }, [deps, follow.target, peers]);

  // Tell the room whose camera mine follows (the spotlight counts these).
  useEffect(() => {
    deps.publish({ followTarget: follow.target });
  }, [deps, follow.target]);

  // esc / a scroll / a click ends it (CONTRACT §6 C33). Capture phase: the canvas's own handlers must
  // not eat the key.
  useEffect(() => {
    if (follow.target === null) return;
    const end = () => setFollow((s) => leaveFollow(s));
    const onKey = (e: KeyboardEvent) => {
      if (endsFollow({ kind: 'key', key: e.key })) end();
    };
    const onWheel = () => end();
    const onPointer = (e: PointerEvent) => {
      const keep = (e.target as Element | null)?.closest?.('[data-presence-keep]');
      if (endsFollow({ kind: 'pointer', insidePill: !!keep })) end();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [follow.target]);

  // ── Bring everyone here ───────────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    const { leading: lead, follow: f, deps: d } = live.current;
    if (lead) {
      d.publish({ summon: null });
      setLeading(null);
      setGlide(null);
    } else if (f.target !== null) {
      setFollow((s) => leaveFollow(s));
    }
  }, []);

  const bring = useCallback((): boolean => {
    const { peers: ps, deps: d } = live.current;
    if (!d.canSummon()) return false;
    const now = d.now();
    const id = newSummonId();
    const landing = d.myCursor() ?? d.viewCentre() ?? { x: 0, y: 0 };
    setFollow(NOT_FOLLOWING); // I lead; I follow no one
    setLeading({ id, at: now });
    d.publish({ summon: { id, at: now }, followTarget: null });
    const plan = glidePlan(ps, landing, d.reducedMotion());
    setGlide({
      steps: plan.steps,
      peers: Object.fromEntries(ps.map((p) => [p.clientID, p.name])),
      at: now,
    });
    return true;
  }, []);

  // The glide is a moment: it leaves the DOM when it has landed.
  useEffect(() => {
    if (!glide) return;
    const total = glide.steps.reduce(
      (m, s) => Math.max(m, s.delay + s.duration + (s.wake ? 160 : 0)),
      0
    );
    const t = setTimeout(() => setGlide(null), total + 50);
    return () => clearTimeout(t);
  }, [glide]);

  const followers = leading ? followersOf(peers, deps.myClientID()) : 0;
  // A Bring nobody answered ends itself (the pill would otherwise read "0 people" forever).
  useEffect(() => {
    if (!leading || followers > 0) return;
    const wait = Math.max(
      0,
      (deps.spotlightEmptyMs ?? SPOTLIGHT_EMPTY_MS) - (deps.now() - leading.at)
    );
    const t = setTimeout(() => {
      if (followersOf(live.current.peers, live.current.deps.myClientID()) === 0) stop();
    }, wait);
    return () => clearTimeout(t);
  }, [deps, leading, followers, stop]);

  // The latest Bring on the canvas wins (Q9): someone else's newer ask ends mine.
  useEffect(() => {
    if (!leading) return;
    const newer = pickSummon(peers, live.current.deps.now());
    if (newer && newer.summon.at > leading.at) {
      live.current.deps.publish({ summon: null });
      setLeading(null);
      setGlide(null);
    }
  }, [peers, leading]);

  // ── what the shell asks ───────────────────────────────────────────────────────────────────────
  const toggle = useCallback((clientID: number) => setFollow((s) => toggleFollow(s, clientID)), []);
  const goTo = useCallback((clientID: number) => {
    const { peers: ps, deps: d } = live.current;
    const target = ps.find((p) => p.clientID === clientID);
    if (target?.artboard) d.frameArtboard(target.artboard);
  }, []);
  const ctxRef = useRef<{ inComments?: boolean }>({});
  const setContext = useCallback(
    (ctx: { inComments?: boolean; active?: boolean }) => {
      if (typeof ctx.inComments === 'boolean' && ctxRef.current.inComments !== ctx.inComments) {
        ctxRef.current.inComments = ctx.inComments;
        live.current.deps.publish({ inComments: ctx.inComments });
      }
      if (ctx.active === true) touch(); // the shell had input (the chat, the inspector): not idle
    },
    [touch]
  );

  const target =
    follow.target === null ? null : (peers.find((p) => p.clientID === follow.target) ?? null);
  return useMemo(
    () => ({
      follow,
      followName: target ? target.name : null,
      followTone: target ? toneColor(toneFor(target.name)) : toneColor(YOU_TONE),
      leading: leading ? { id: leading.id, followers } : null,
      glide,
      toggle,
      goTo,
      bring,
      stop,
      setContext,
    }),
    [follow, target, leading, followers, glide, toggle, goTo, bring, stop, setContext]
  );
}

/** Route one `run-action` from the shell to the hook. Returns true when the id was presence's. */
export function runPresenceAction(
  view: Pick<PresenceView, 'toggle' | 'goTo' | 'bring' | 'stop' | 'setContext'>,
  id: string,
  params: Record<string, unknown> | undefined
): boolean {
  const cid = params?.clientID;
  const hasClient = typeof cid === 'number' && Number.isSafeInteger(cid) && cid >= 0;
  if ((PRESENCE_RUN_IDS.follow as readonly string[]).includes(id)) {
    if (hasClient) view.toggle(cid as number);
    return true;
  }
  if ((PRESENCE_RUN_IDS.goTo as readonly string[]).includes(id)) {
    if (hasClient) view.goTo(cid as number);
    return true;
  }
  if ((PRESENCE_RUN_IDS.bring as readonly string[]).includes(id)) {
    view.bring();
    return true;
  }
  if ((PRESENCE_RUN_IDS.stop as readonly string[]).includes(id)) {
    view.stop();
    return true;
  }
  if ((PRESENCE_RUN_IDS.context as readonly string[]).includes(id)) {
    view.setContext({
      inComments: typeof params?.inComments === 'boolean' ? params.inComments : undefined,
      active: params?.active === true,
    });
    return true;
  }
  return false;
}

// ── the view ─────────────────────────────────────────────────────────────────────────────────────

export const PRESENCE_CSS = `
.dc-presence-frame {
  position: fixed; inset: 0; z-index: 9990; pointer-events: none;
  border: 2px solid var(--presence-ring, currentColor);
  border-radius: 0 0 var(--radius-lg, 12px) var(--radius-lg, 12px);
  animation: dc-presence-frame ${FRAME_DRAW_MS}ms var(--ease-out, ease-out) both;
}
@keyframes dc-presence-frame { from { clip-path: inset(0 50% 50% 50%); opacity: 0; } to { clip-path: inset(0); opacity: 1; } }
.dc-presence-pill {
  position: fixed; left: 50%; top: var(--space-4, 16px); z-index: 9991; translate: -50% 0;
  display: inline-flex; align-items: center; gap: var(--space-2, 8px); height: 40px;
  padding: 0 var(--space-2, 8px) 0 var(--space-2, 8px);
  font: var(--w-medium, 500) var(--type-sm, 13px) / 1 var(--font-body, system-ui, sans-serif);
  color: var(--fg-0, #111); background: var(--island-bg, var(--bg-1, #fff));
  border: 0; border-radius: var(--radius-pill, 999px);
  box-shadow: var(--island-shadow, 0 2px 8px rgba(0,0,0,.18)), inset 0 0 0 1.5px var(--presence-ring, currentColor);
  pointer-events: auto; cursor: default; user-select: none;
}
.dc-presence-pill .dc-presence-face {
  width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
  font-size: 11px; font-weight: 600; color: var(--fg-0, #111); background: var(--presence-ring, currentColor);
}
.dc-presence-pill kbd {
  font: inherit; font-size: var(--type-xs, 12px); padding: 2px 6px; border-radius: var(--radius-sm, 6px);
  background: var(--bg-3, rgba(0,0,0,.08)); color: var(--fg-1, #444);
}
.dc-presence-pill button {
  font: inherit; height: 28px; padding: 0 var(--space-3, 12px); border: 0; cursor: pointer;
  border-radius: var(--radius-pill, 999px); color: var(--fg-0, #111); background: var(--bg-3, rgba(0,0,0,.08));
}
.dc-bring-glide { position: fixed; inset: 0; z-index: 9992; pointer-events: none; overflow: hidden; }
.dc-bring-ghost {
  position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 4px;
  font: 600 11px / 1 var(--font-body, system-ui, sans-serif); color: var(--fg-0, #111);
  animation: dc-bring-glide var(--glide-ms, 420ms) cubic-bezier(.34, 1.56, .64, 1) var(--glide-delay, 0ms) both;
}
.dc-bring-ghost i { width: 10px; height: 10px; border-radius: 50%; background: var(--ghost-tone, currentColor); }
@keyframes dc-bring-glide { from { translate: 0 0; } to { translate: var(--dx, 0px) var(--dy, 0px); } }
.dc-bring-wake { position: absolute; inset: 0; overflow: visible; }
.dc-bring-wake line {
  stroke: var(--ghost-tone, currentColor); stroke-width: 2; stroke-dasharray: 1 7; stroke-linecap: round;
  animation: dc-bring-wake 160ms linear calc(var(--glide-delay, 0ms) + var(--glide-ms, 420ms)) both;
}
@keyframes dc-bring-wake { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dc-presence-frame { animation: dc-presence-fade 1ms both; }
  .dc-bring-ghost { animation-duration: 1ms !important; animation-delay: 0ms !important; }
  .dc-bring-wake { display: none; }
}
@keyframes dc-presence-fade { from { opacity: 0; } to { opacity: 1; } }
`;

let stylesInjected = false;
export function ensurePresenceStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById('dc-presence-css')) {
    stylesInjected = true;
    return;
  }
  const s = document.createElement('style');
  s.id = 'dc-presence-css';
  s.textContent = PRESENCE_CSS;
  document.head.appendChild(s);
  stylesInjected = true;
}

const initialOf = (name: string) => (String(name).trim()[0] ?? '?').toUpperCase();

export function PresenceOverlay({
  view,
  camera,
}: {
  view: PresenceView;
  camera: { x: number; y: number; zoom: number } | null;
}): JSX.Element | null {
  ensurePresenceStyles();
  const following = view.follow.target !== null && view.followName !== null;
  const leading = view.leading;
  if (!following && !leading && !view.glide) return null;
  const ringStyle = (c: string) => ({ ['--presence-ring' as string]: c }) as React.CSSProperties;
  return (
    <>
      {following && (
        <>
          <span
            className="dc-presence-frame"
            data-testid="presence-frame"
            data-kind="follow"
            style={ringStyle(view.followTone)}
          />
          <span
            className="dc-presence-pill"
            data-testid="presence-follow-pill"
            role="status"
            style={ringStyle(view.followTone)}
          >
            <span className="dc-presence-face" aria-hidden="true">
              {initialOf(view.followName ?? '')}
            </span>
            Following {firstName(view.followName ?? '')}
            <kbd>esc</kbd>
          </span>
        </>
      )}
      {leading && (
        <>
          <span
            className="dc-presence-frame"
            data-testid="presence-frame"
            data-kind="spotlight"
            style={ringStyle(toneColor(YOU_TONE))}
          />
          <span
            className="dc-presence-pill"
            data-testid="presence-spotlight-pill"
            role="status"
            data-presence-keep=""
            style={ringStyle(toneColor(YOU_TONE))}
          >
            <span className="dc-presence-face" aria-hidden="true">
              Y
            </span>
            Everyone here is following you · {leading.followers}{' '}
            {leading.followers === 1 ? 'person' : 'people'}
            <button type="button" data-testid="presence-spotlight-stop" onClick={view.stop}>
              Stop
            </button>
          </span>
        </>
      )}
      {view.glide && camera && (
        <div className="dc-bring-glide" data-testid="presence-bring-glide" aria-hidden="true">
          <svg className="dc-bring-wake" width="100%" height="100%">
            <title>Everyone arriving</title>
            {view.glide.steps
              .filter((s) => s.wake)
              .map((s) => (
                <line
                  key={s.clientID}
                  x1={s.from.x * camera.zoom + camera.x}
                  y1={s.from.y * camera.zoom + camera.y}
                  x2={s.to.x * camera.zoom + camera.x}
                  y2={s.to.y * camera.zoom + camera.y}
                  style={
                    {
                      ['--ghost-tone' as string]: toneColor(
                        toneFor(view.glide?.peers[s.clientID] ?? '')
                      ),
                      ['--glide-ms' as string]: `${s.duration}ms`,
                      ['--glide-delay' as string]: `${s.delay}ms`,
                    } as React.CSSProperties
                  }
                />
              ))}
          </svg>
          {view.glide.steps.map((s) => {
            const name = view.glide?.peers[s.clientID] ?? '';
            const fx = s.from.x * camera.zoom + camera.x;
            const fy = s.from.y * camera.zoom + camera.y;
            const tx = s.to.x * camera.zoom + camera.x;
            const ty = s.to.y * camera.zoom + camera.y;
            return (
              <span
                key={s.clientID}
                className="dc-bring-ghost"
                data-testid={`presence-bring-ghost-${s.clientID}`}
                data-delay={s.delay}
                data-duration={s.duration}
                style={
                  {
                    left: fx,
                    top: fy,
                    ['--dx' as string]: `${tx - fx}px`,
                    ['--dy' as string]: `${ty - fy}px`,
                    ['--glide-ms' as string]: `${s.duration}ms`,
                    ['--glide-delay' as string]: `${s.delay}ms`,
                    ['--ghost-tone' as string]: toneColor(toneFor(name)),
                  } as React.CSSProperties
                }
              >
                <i />
                {firstName(name)}
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
