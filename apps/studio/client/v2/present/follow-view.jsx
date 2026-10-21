// client/v2/present/follow-view.jsx — S3.7a: the Present follower page (S3-present-session §4, 04 Modes
// md-present-link). `/?open=<rel>&present=follow[&sid=<sid>][&audience=1]`.
//
// A SEPARATE ROOT, like embed-view.jsx (DDR-247) and for the same reason: the studio shell persists view
// prefs, rewrites the address bar, mounts panels, chat and export — none of which a person watching a
// presentation should get. One root serves both followers: the local audience window (`audience=1`, the
// Mac's second display, S3.6a) and a presentation-link viewer (the hub's `/present/<canvas>`, S3.7b).
//
// The canvas frame is read-only whatever the role: `canvasUrl(…, { follow: true })` → `ro=1&comments=0&
// follow=1`, and the capability comes from `/_config?follow=1&canvas=<rel>` (S3.7c): in a cell the hub
// mints a receive-only FOLLOW capability for that one canvas — read-only like the embed's, so the canvas
// door refuses every write, but it may join that canvas's collab room (sync dropped, awareness kept to
// `watching`), which the embed's may not (DDR-247). The frame is seeded into Present · Artboards with NO caps (it never
// publishes a position) and told which session to follow (`present-follow`). It follows the presenter's
// collab awareness itself (present-stage.tsx `usePresentFollow`) and reports back `present-follow-state`;
// this page draws the bar from that — names as TEXT only, re-clamped (follow-model.js).
//
// No esc handler: in a browser, esc first leaves the browser's full screen, which is the browser's own.
import { useEffect, useRef, useState } from 'react';

import { NO_CAPS } from '../../../bridge/canvas-modes.ts';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { canvasTokenRefreshDelay, canvasUrl, setLiveCanvasToken } from '../../canvas-url.js';
import { encodeOpenPath, normalizeOpenPath } from '../../share-link.js';
import { setModeMessage } from '../shell/canvas-mode.js';
import { readFollowParams } from './follow-location.js';
import { followBarModel } from './follow-model.js';

// S3.7c (lead decision `v2-lead-cloud-follow-capability`) — the follower asks for the FOLLOW capability
// of the canvas it follows. A canvas the session may not read gets no capability, like a missing one.
export function followConfigUrl(rel) {
  return `/_config?follow=1&canvas=${encodeURIComponent(rel ?? '')}`;
}
const SEED_LADDER_MS = [0, 150, 500, 1200, 2500];
const LOAD_TIMEOUT_MS = 20_000;
const CANVAS_EXT_RE = /\.tsx$/i;

function originOf(value) {
  try {
    return new URL(value, location.href).origin;
  } catch {
    return null;
  }
}

async function readJson(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!r.ok) throw Object.assign(new Error(`${url} → ${r.status}`), { status: r.status });
  return r.json();
}

/** The follow bar (04 md-present-link): Live · avatar · "<name> is on 6 of 14 · you're on 5" · Catch up. */
export function FollowBar({ state, openHref, onCatchUp }) {
  const m = followBarModel(state);
  const initial = m.name.slice(0, 1).toUpperCase();
  return (
    <>
      <div className="st-follow island" role="status" aria-live="polite" data-testid="follow-bar">
        {m.phase === 'waiting' ? (
          <span>Waiting for the presenter…</span>
        ) : m.phase === 'ended' ? (
          <>
            <span>{m.name} ended the presentation</span>
            {openHref && (
              <a className="btn btn--sm" href={openHref} data-testid="follow-open-canvas">
                Open the canvas
              </a>
            )}
          </>
        ) : (
          <>
            <span
              className={`st-follow-live${m.live ? '' : ' st-follow-live--off'}`}
              data-testid="follow-live"
            >
              <i aria-hidden="true" />
              Live
            </span>
            <span className="st-follow-av" aria-hidden="true">
              {initial}
            </span>
            <span>
              {m.name} is on <strong>{m.presenterAt}</strong>
              {m.phase === 'drifted' && <> · you're on {m.youAt}</>}
            </span>
            {m.action === 'catch-up' && (
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={onCatchUp}
                data-testid="follow-catch-up"
              >
                Catch up
              </button>
            )}
          </>
        )}
      </div>
      {m.phase !== 'waiting' && (
        <span className="st-follow-watch" data-testid="follow-watchers">
          {m.watchers}
        </span>
      )}
    </>
  );
}

export default function FollowView() {
  // loading | canvas | missing | signed-out
  // An audience URL that is not a follower URL is refused before anything is fetched (S3.6a review).
  const [view, setView] = useState(() =>
    readFollowParams(location).ok ? { phase: 'loading' } : { phase: 'refused' }
  );
  const [followState, setFollowState] = useState(null);
  const frameRef = useRef(null);
  const paramsRef = useRef(readFollowParams(location));
  const audience = paramsRef.current.audience;
  // Follow the OS theme for the little chrome there is. Never persisted.
  const [theme] = useState(() =>
    window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Boot: config → resolve the identity against the project index → frame it (embed-view's path).
  // biome-ignore lint/correctness/useExhaustiveDependencies: boots once
  useEffect(() => {
    if (view.phase === 'refused') return undefined;
    let cancelled = false;
    const miss = () => {
      if (!cancelled) setView({ phase: 'missing' });
    };
    (async () => {
      let data;
      const asked = paramsRef.current.open;
      try {
        data = await readJson(followConfigUrl(asked));
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 401) setView({ phase: 'signed-out' });
        else miss();
        return;
      }
      const designRel = (data.designRoot || '.design').replace(/^\/+|\/+$/g, '');
      const params = readFollowParams(location, designRel);
      paramsRef.current = params;
      if (!params.ok || !params.open) return miss();
      // A design root other than the default names the canvas differently: ask again for THAT one.
      if (params.open !== asked) {
        try {
          data = {
            ...data,
            canvasToken: (await readJson(followConfigUrl(params.open)))?.canvasToken,
          };
        } catch {
          return miss();
        }
      }
      let index;
      try {
        index = await readJson('/_index-data');
      } catch {
        return miss();
      }
      const path = (index.groups ?? [])
        .flatMap((g) => g.paths || [])
        .find((p) => normalizeOpenPath(p, designRel) === params.open);
      if (!path || !CANVAS_EXT_RE.test(path)) return miss();
      if (cancelled) return;
      const cfg = {
        designRel,
        tokensCssRel: data.tokensCssRel,
        designSystems: data.designSystems,
        canvasOrigin: data.canvasOrigin,
        canvasToken: data.canvasToken,
        // gate-b-c4 — the frame's capability is minted from this session's key (client/frame-cap.js)
        frameKey: data.frameKey,
        canvasDesignSystems: index.canvasDesignSystems ?? {},
        // S10.4 — a follower sees the revision the presenter's canvas renders
        canvasDsRevs: index.canvasDsRevs ?? {},
        systemHeads: index.systemHeads ?? {},
        dsConverted: index.dsConverted ?? {},
        dsRevGaps: index.dsRevGaps ?? {},
      };
      setView({
        phase: 'canvas',
        path,
        rel: params.open,
        cfg,
        src: canvasUrl(path, cfg, { follow: true }),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canvasOrigin =
    view.phase === 'canvas'
      ? view.cfg.canvasOrigin
        ? originOf(view.cfg.canvasOrigin)
        : location.origin
      : null;

  const postFollow = (live) => {
    const win = frameRef.current?.contentWindow;
    if (!win || !canvasOrigin) return;
    try {
      win.postMessage(
        { dgn: 'present-follow', sid: paramsRef.current.sid, live, locked: audience },
        canvasOrigin
      );
    } catch {
      /* frame navigated away — the next load re-seeds */
    }
  };

  // While the canvas is up: seed Present · Artboards (no caps) + the follow on every (re)load, and read
  // back what the canvas shows. Only the frame we built, from the origin we built it on (acceptFromCanvas).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the canvas identity; postFollow reads refs
  useEffect(() => {
    if (view.phase !== 'canvas' || !canvasOrigin) return undefined;
    const timers = [];
    let modeSeq = 0;
    let ready = false;
    let live = true;
    const seed = () => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      const messages = [
        { dgn: 'comments-set', comments: [] },
        { dgn: 'theme', theme },
        { dgn: 'view-chrome', minimap: false, zoom: false, present: true },
        setModeMessage({
          seq: ++modeSeq,
          mode: 'present',
          present: { kind: 'artboards', from: 'start' },
          caps: NO_CAPS,
        }),
      ];
      for (const m of messages) {
        try {
          win.postMessage(m, canvasOrigin);
        } catch {
          /* the next load re-seeds */
        }
      }
      // The audience window cannot look away (locked): it is always live.
      postFollow(audience || live);
    };
    const giveUp = setTimeout(() => {
      if (!ready) setView({ phase: 'missing' });
    }, LOAD_TIMEOUT_MS);
    function onMessage(e) {
      const m = acceptFromCanvas(e, {
        canvasOrigin,
        active: frameRef.current?.contentWindow ?? null,
      });
      // `loaded` is gated `any` in the table: it must come from the frame we built, too.
      if (!m || e.source !== frameRef.current?.contentWindow) return;
      if (m.dgn === 'loaded') {
        ready = true;
        for (const ms of SEED_LADDER_MS) timers.push(setTimeout(seed, ms));
      } else if (m.dgn === 'present-follow-state') {
        live = m.live;
        setFollowState(m);
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(giveUp);
      for (const t of timers) clearTimeout(t);
    };
  }, [view.phase, view.path, canvasOrigin]);

  // The read-only capability expires (render-token.mjs): re-mint the SAME read-only one, as embed-view does.
  useEffect(() => {
    if (view.phase !== 'canvas' || !view.cfg.canvasToken) return undefined;
    const target = originOf(view.cfg.canvasOrigin);
    let stopped = false;
    let timer = null;
    const schedule = (token) => {
      timer = setTimeout(refresh, canvasTokenRefreshDelay(token));
    };
    async function refresh() {
      let token = null;
      try {
        token = (await readJson(followConfigUrl(paramsRef.current.open)))?.canvasToken;
      } catch {
        /* retried below */
      }
      if (stopped) return;
      if (typeof token !== 'string' || !token) {
        timer = setTimeout(refresh, 30_000);
        return;
      }
      setLiveCanvasToken(token);
      if (target) {
        try {
          frameRef.current?.contentWindow?.postMessage({ dgn: 'canvas-cap', t: token }, target);
        } catch {}
      }
      schedule(token);
    }
    schedule(view.cfg.canvasToken);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [view.phase, view.cfg?.canvasToken, view.cfg?.canvasOrigin]);

  const openHref = view.phase === 'canvas' ? `/?open=${encodeOpenPath(view.rel)}` : null;

  return (
    <div className="maude" data-theme={theme}>
      <div
        className={`st-body--float st-follow-root${audience ? ' st-follow-root--audience' : ''}`}
        data-testid="follow-view"
        data-audience={audience ? '1' : undefined}
      >
        {view.phase === 'canvas' && (
          <iframe
            ref={frameRef}
            src={view.src}
            title={`Presentation: ${view.path}`}
            className="st-follow-frame"
            data-testid="follow-canvas-frame"
            {...(view.cfg.canvasOrigin
              ? { sandbox: 'allow-scripts allow-same-origin', allow: 'autoplay' }
              : {})}
          />
        )}
        {view.phase === 'canvas' && !audience && (
          <FollowBar state={followState} openHref={openHref} onCatchUp={() => postFollow(true)} />
        )}
        {/* The audience window shows nothing at all when it cannot follow; it never shows the editor. */}
        {(view.phase === 'missing' || view.phase === 'refused') && !audience && (
          <div className="st-follow-note" role="status">
            Nothing to follow — this design is not in the project, or it could not be loaded.
          </div>
        )}
        {view.phase === 'signed-out' && (
          <div className="st-follow-note" role="status">
            Sign in to the design hub to follow this presentation.
          </div>
        )}
      </div>
    </div>
  );
}
