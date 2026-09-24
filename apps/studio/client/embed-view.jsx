// DDR-242 — the chromeless, read-only `?embed=1&open=<rel>[&artboard=<id>]`
// view another app frames (orbit showing a design next to a task).
//
// A SEPARATE ROOT, not a mode of <App>. The studio shell persists view prefs,
// rewrites the address bar, mounts panels, chat and export — every one of which
// an embed must not do. Rendering this instead of <App> means none of it runs,
// rather than each of it remembering to check a flag. What IS shared is the
// canvas: the same `canvasUrl()` and the same in-canvas Presentation Mode
// (`view-chrome` `present`), with `ro=1` + `comments=0` + `embed=1` on the URL.
//
// It speaks the one-way contract in `embed.js` to the parent and accepts
// nothing from it.
import { useEffect, useRef, useState } from 'react';

import { canvasTokenRefreshDelay, canvasUrl, setLiveCanvasToken } from './canvas-url.js';
import { postToEmbedder, readEmbedParams } from './embed.js';
import { normalizeOpenPath } from './share-link.js';

const CANVAS_EXT_RE = /\.(tsx|html?)$/i;
// DDR-242 — every config read this view makes says it is the embed, so a hub
// mints it a read-only canvas capability (the canvas door then refuses writes).
const EMBED_CONFIG_URL = '/_config?embed=1';
// Same order of magnitude as the studio's own compile cap (issue #115): past
// this the canvas is not coming, and the embedder deserves an answer.
const LOAD_TIMEOUT_MS = 20_000;
// `dgn:'loaded'` fires from the inline inspector script BEFORE the React canvas
// shell mounts its listener (app.jsx says the same), so the view is seeded on a
// short ladder rather than once. Every message on it is idempotent.
const SEED_LADDER_MS = [0, 150, 500, 1200, 2500];

const ROOT_STYLE = { position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--u-bg-0)' };
const FRAME_STYLE = { width: '100%', height: '100%', border: 0, display: 'block' };
const NOTE_STYLE = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  textAlign: 'center',
  color: 'var(--u-fg-2)',
};

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

export default function EmbedView() {
  // loading | canvas | missing | signed-out
  const [view, setView] = useState({ phase: 'loading' });
  const frameRef = useRef(null);
  // The allowlist and the echo travel in refs: posting must never wait on a render.
  const allowRef = useRef([]);
  const openRef = useRef('');
  const post = (type, title) => postToEmbedder(window, allowRef.current, type, openRef.current, title);

  // Follow the OS theme for the little chrome there is. Never persisted.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    document.documentElement.dataset.theme = mq?.matches ? 'light' : 'dark';
  }, []);

  // Escape pressed on this page itself (focus outside the canvas frame) goes
  // to the embedder too, when nothing here consumed it. This view never moves
  // focus on its own — keys only arrive here after the person clicked in.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      setTimeout(() => {
        if (!e.defaultPrevented) post('escape');
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Boot: config → resolve the identity against the project index → frame it.
  useEffect(() => {
    let cancelled = false;
    const miss = () => {
      if (cancelled) return;
      setView({ phase: 'missing' });
      post('not-found');
    };
    (async () => {
      let data;
      try {
        // `embed=1` asks the hub for a READ-ONLY canvas capability (DDR-242).
        data = await readJson(EMBED_CONFIG_URL);
      } catch (err) {
        if (cancelled) return;
        // The session ended between the hub letting the page through and this
        // fetch — the hub answers an API call 401 rather than redirecting it.
        if (err?.status === 401) {
          setView({ phase: 'signed-out' });
          post('auth-required');
        } else miss();
        return;
      }
      const designRel = (data.designRoot || '.design').replace(/^\/+|\/+$/g, '');
      allowRef.current = Array.isArray(data.embedOrigins) ? data.embedOrigins : [];
      const params = readEmbedParams(location, designRel);
      openRef.current = params.open ?? params.requested;
      if (!params.open) return miss();
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
      let title = null;
      try {
        const meta = await readJson(`/_api/canvas-meta?file=${encodeURIComponent(path)}`);
        if (typeof meta?.title === 'string' && meta.title.trim()) title = meta.title.trim().slice(0, 200);
      } catch {
        /* a canvas without a sidecar still renders — it just has no title */
      }
      if (cancelled) return;
      const cfg = {
        designRel,
        tokensCssRel: data.tokensCssRel,
        designSystems: data.designSystems,
        canvasOrigin: data.canvasOrigin,
        canvasToken: data.canvasToken,
        canvasDesignSystems: index.canvasDesignSystems ?? {},
      };
      setView({
        phase: 'canvas',
        path,
        title,
        artboard: params.artboard,
        cfg,
        src: canvasUrl(path, cfg, { embed: true }),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While the canvas is up: announce `ready` once, seed the view on every
  // (re)load, and give up with `not-found` if it never loads. Keyed on the
  // canvas identity; `post` reads refs only.
  useEffect(() => {
    if (view.phase !== 'canvas') return undefined;
    const canvasOrigin = view.cfg.canvasOrigin ? originOf(view.cfg.canvasOrigin) : location.origin;
    const timers = [];
    let ready = false;
    let giveUp = null;
    const seed = () => {
      const win = frameRef.current?.contentWindow;
      if (!win || !canvasOrigin) return;
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      const messages = [
        { dgn: 'comments-set', comments: [] },
        { dgn: 'theme', theme },
        { dgn: 'view-chrome', minimap: false, zoom: false, present: true },
        view.artboard ? { dgn: 'zoom', op: 'artboard', id: view.artboard } : { dgn: 'zoom', op: 'fit' },
      ];
      for (const m of messages) {
        try {
          win.postMessage(m, canvasOrigin);
        } catch {
          /* frame navigated away — the next load re-seeds */
        }
      }
    };
    const loaded = () => {
      if (!ready) {
        ready = true;
        clearTimeout(giveUp);
        post('ready', view.title ?? undefined);
      }
      for (const ms of SEED_LADDER_MS) timers.push(setTimeout(seed, ms));
    };
    giveUp = setTimeout(() => {
      if (ready) return;
      setView({ phase: 'missing' });
      post('not-found');
    }, LOAD_TIMEOUT_MS);
    function onMessage(e) {
      // Only the frame we built, from the origin we built it on.
      if (e.origin !== canvasOrigin || e.source !== frameRef.current?.contentWindow) return;
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.dgn === 'loaded') loaded();
      // An Escape the canvas did not consume (read-only-mode.ts) belongs to
      // the app around the embed — its dialog must still close.
      else if (e.data.dgn === 'embed-escape') post('escape');
    }
    window.addEventListener('message', onMessage);
    // A legacy `.html` canvas never posts `loaded`; its frame load is the signal.
    const frame = frameRef.current;
    const onFrameLoad = () => {
      if (!view.path.endsWith('.tsx')) loaded();
    };
    frame?.addEventListener('load', onFrameLoad);
    return () => {
      window.removeEventListener('message', onMessage);
      frame?.removeEventListener('load', onFrameLoad);
      clearTimeout(giveUp);
      for (const t of timers) clearTimeout(t);
    };
  }, [view.phase, view.path]);

  // THE CANVAS CAPABILITY EXPIRES (render-token.mjs). Same re-mint the studio
  // shell runs (app.jsx), for the one frame this view holds: an embed left open
  // on a task must keep loading after a teammate's edit re-imports the module.
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
        // Re-mint the SAME read-only capability — never a full one.
        token = (await readJson(EMBED_CONFIG_URL))?.canvasToken;
      } catch {
        /* retried below; the current capability may still be valid */
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

  return (
    <div style={ROOT_STYLE} data-testid="embed-view">
      {view.phase === 'canvas' && (
        <iframe
          ref={frameRef}
          src={view.src}
          title={view.title ? `Canvas: ${view.title}` : `Canvas: ${view.path}`}
          style={FRAME_STYLE}
          data-testid="embed-canvas-frame"
          // Same containment the studio shell gives a cross-origin canvas.
          {...(view.cfg.canvasOrigin
            ? { sandbox: 'allow-scripts allow-same-origin', allow: 'clipboard-write' }
            : {})}
        />
      )}
      {view.phase === 'missing' && (
        <div style={NOTE_STYLE} role="status">
          This design is not in the project, or it could not be loaded.
        </div>
      )}
      {view.phase === 'signed-out' && (
        <div style={NOTE_STYLE} role="status">
          Sign in to the design hub to see this design.
        </div>
      )}
    </div>
  );
}
