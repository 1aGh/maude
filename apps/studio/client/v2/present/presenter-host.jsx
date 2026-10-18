// client/v2/present/presenter-host.jsx — S3.6b: the presenter view, wired to today's shell.
//
// Mounted while the shell presents (app.jsx, next to <ShellPresentChrome>). It shows the view only when the
// person turned presenter view on (presenter-store.js `wanted`, set by a click on the Present ⌄ row or the
// controls' button), the desktop app reports another display, and Present is showing artboards one by one.
//
// THE AUDIENCE WINDOW. With the view up and the canvas reporting a presentation session (`sid` on
// `present-position`), the host asks the shell to open the audience window on the other display:
// `openAudience({ displayId, canvas, sid, lock: AUDIENCE_LOCK })` — the lock is the number the follower
// root declares (follow-location.js), never a literal; Rust builds the URL itself. This effect is the ONLY
// caller, and it reads only the person's preference (`wanted`) and the shell's own mode store: no message
// from a canvas can start it (S3-present-session §4). End, esc (the view going away with Present) and a
// display that disappears close it again.
//
// OFFLINE (S3.8, md-edge-offline). With the project offline (the Share cluster's own rule, `saveStatus`) the top
// bar's audience line becomes "Offline — kept on this Mac". The canvas reports the media files the presented
// clip uses (`present-media.sources`); a file that is not among the ones on this Mac (GET /_api/assets, the
// existing list — present/media-presence.ts) earns the Now box's "Clip isn't on this Mac …" notice with Skip.
// The audience screen already holds that clip's first frame — the engine in its own canvas does it.
//
// DATA. The artboards come from the canvas's `present-run` report when it sent one (names + world rects in
// canvas order), else the project index's list (names only → the map draws a plain grid). The order, skips
// and notes are the canvas's `.meta.json` (`GET /_api/canvas-meta`, readable by every role — a viewer who
// presents locally reads them too).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fetchLocalAssets, missingSources } from '../../../present/media-presence.ts';
import { syncPresentation } from '../../../sync/presentation.ts';
import { normalizeOpenPath } from '../../share-link.js';
import { basename, displayName } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { indexMeta } from '../canvases/tree-model.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { presentStep, shellMode } from '../shell/use-canvas-mode-lane.js';
import { closeAudience, openAudience } from './audience-window.js';
import { AUDIENCE_LOCK } from './follow-location.js';
import { presenterOffline, savedFromMeta } from './presenter-model.js';
import {
  chosenDisplay,
  presenterOn,
  usePresentRun,
  usePresenterDisplays,
} from './presenter-store.js';
import { PresenterView } from './presenter-view.jsx';

/** What the shell said no to, in the canvas's words. */
function openFailure(err) {
  const raw = String(err?.message ?? '')
    .replace(/^not-ready:?\s*/i, '')
    .trim();
  return raw && raw.length <= 140 ? raw : 'Couldn’t open the audience screen.';
}

/** The canvas's Present order / skips / notes from its `.meta.json`; re-read when the artboard changes. */
function useSavedPresent(file, enabled, artboardId) {
  const [saved, setSaved] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `artboardId` is the refresh trigger
  useEffect(() => {
    if (!enabled || !file) return undefined;
    let live = true;
    fetch(`/_api/canvas-meta?file=${encodeURIComponent(file)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (live && meta) setSaved(savedFromMeta(meta));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file, enabled, artboardId]);
  return saved;
}

const subscribeOnline = (fn) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};
const onlineNow = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** How often a missing clip is looked for again: its file may arrive while the slide is up. */
const RECHECK_MS = 5000;

/**
 * Is the presented clip's media missing from this Mac? `media` is the canvas's `present-media` report. The
 * list of files that are here is re-read when the clip's files change, when the network comes back, and
 * slowly while one is missing. No list (the route did not answer) is no verdict.
 */
function useClipMissing(media, enabled, designRel) {
  const [seen, setSeen] = useState({ key: '', local: null });
  const key = (media?.sources ?? []).join('\n');
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads on a network change or the slow check
  useEffect(() => {
    if (!enabled || !key) return undefined;
    let live = true;
    fetchLocalAssets().then((local) => live && setSeen({ key, local }));
    return () => {
      live = false;
    };
  }, [enabled, key, tick]);
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const missing = useMemo(
    () =>
      enabled && seen.key === key
        ? missingSources(media?.sources, seen.local, { designRel, hosts: host ? [host] : [] })
            .length > 0
        : false,
    [enabled, seen, key, designRel, host, media?.sources]
  );
  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('online', bump);
    const h = missing ? setInterval(bump, RECHECK_MS) : null;
    return () => {
      window.removeEventListener('online', bump);
      if (h) clearInterval(h);
    };
  }, [enabled, missing]);
  return missing;
}

function useClock(running) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [running]);
  return now;
}

export function PresenterViewHost() {
  const {
    shellCore: { activePath, cfg, cloudLinkedHub, syncStatus, project },
    photoAndTimeline: { exitPresent },
  } = useShellStore();
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  const pv = usePresenterDisplays();
  const run = usePresentRun();
  const startedAt = useRef(Date.now());

  const visible = snap.mode === 'present' && snap.present?.kind === 'artboards' && presenterOn(pv);
  const display = chosenDisplay(pv);
  const position = snap.position;
  const sid = position?.sid ?? null;
  const canvasRel = useMemo(
    () => (activePath ? normalizeOpenPath(activePath, cfg?.designRel) : null),
    [activePath, cfg?.designRel]
  );

  const indexSnapshot = useCanvasIndex({ stamp: activePath });
  const boards = useMemo(
    () => indexMeta(indexSnapshot, cfg?.designRel).get(activePath)?.boards ?? [],
    [indexSnapshot, cfg?.designRel, activePath]
  );
  const artboards = run && run.file === activePath ? run.artboards : boards;
  const saved = useSavedPresent(activePath, visible, position?.artboardId);
  const nowMs = useClock(visible);

  // ── offline (S3.8) ──
  const online = useSyncExternalStore(subscribeOnline, onlineNow, () => true);
  const linked =
    !!cfg?.cloud || !!cloudLinkedHub?.credentialed || (!!syncStatus && syncStatus.linked !== false);
  const phase = useMemo(
    () =>
      syncPresentation(syncStatus, { project: cfg?.cloud?.projectName || project })?.phase ?? null,
    [syncStatus, cfg?.cloud?.projectName, project]
  );
  const offline = presenterOffline({ linked, online, phase });
  const clipMissing = useClipMissing(snap.media, visible, cfg?.designRel);

  // ── the audience window ──
  const [audience, setAudience] = useState({ status: 'waiting' });
  const [retries, setRetries] = useState(0);
  const displayId = display?.id ?? null;
  const displayName_ = display?.name ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `retries` re-runs the open on "Try again"
  useEffect(() => {
    if (!visible || !displayId || !canvasRel) return undefined;
    if (!sid) {
      setAudience({ status: 'waiting', displayName: displayName_ });
      return undefined;
    }
    let live = true;
    setAudience({ status: 'opening', displayName: displayName_ });
    openAudience({ displayId, canvas: canvasRel, sid, lock: AUDIENCE_LOCK }).then(
      () => live && setAudience({ status: 'on', displayName: displayName_ }),
      (err) =>
        live &&
        setAudience({ status: 'failed', displayName: displayName_, message: openFailure(err) })
    );
    return () => {
      live = false;
    };
  }, [visible, displayId, displayName_, canvasRel, sid, retries]);

  // The window lives exactly as long as the view: it closes when the view goes (End, esc → Present ends →
  // this unmounts, presenter view turned off, a mode change) — never left open on the other display.
  useEffect(() => {
    if (!visible) return undefined;
    return () => {
      void closeAudience();
    };
  }, [visible]);

  // The canvas only reports a session while it is allowed to publish one; a viewer who just turned the
  // view on gets it on the next step — so ask for the one we are on.
  const nudged = useRef(false);
  useEffect(() => {
    if (!visible) {
      nudged.current = false;
      return;
    }
    if (sid || nudged.current || !position) return;
    nudged.current = true;
    presentStep(position.index);
  }, [visible, sid, position]);

  if (!visible) return null;
  const onEnd = () => {
    void closeAudience();
    exitPresent?.();
  };
  return (
    <PresenterView
      canvasName={activePath ? displayName(basename(activePath)) : ''}
      position={position}
      artboards={artboards}
      saved={saved}
      elapsedMs={nowMs - startedAt.current}
      now={new Date(nowMs)}
      audience={audience}
      offline={offline}
      clipMissing={clipMissing}
      onStep={presentStep}
      onEnd={onEnd}
      onRetry={() => setRetries((n) => n + 1)}
    />
  );
}
