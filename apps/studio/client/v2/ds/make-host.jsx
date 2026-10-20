// client/v2/ds/make-host.jsx — S10.16b: the shell's side of making a design system (13 · 13 … 17).
//
// Mounted once in the shell (inside the DS review host, with the switch and truth hosts). It does four things:
//   1  answers the door — `ds.make` (the pinned row's "Make a design system", Home's starter, ⌘K) dispatches
//      `maude:ds-make`; the host takes it and opens the three-input sheet (make-sheet.jsx);
//   2  "Make three directions" — `POST /_api/ds/make {action:'make'}` creates the outline (a config entry, the
//      folder, the Design system canvas with `ds-dir-*` and seven outlines), then the brief goes to AI through the
//      composer with origin `ds-make` (the person's gesture: every composer gate applies), and the new canvas opens;
//   3  while the open canvas is the Design system canvas of a system that is being made, reads `GET make-state`
//      every few seconds and tells the canvas which sections wait, are being drawn or are done
//      (`maude:ds-make-states` — a message to the canvas origin, never `*`);
//   4  the ready card (13 · ds-make-done): "<name> system is ready." with one button that publishes the first
//      revision and makes it the project's style (`POST … {action:'done'}`, then switch-bus `finishedMaking` so the
//      existing canvases get one review).
//
// Nothing here is trusted from the page: the server judges the role (Can edit on the whole project), every name and
// every direction. A refusal comes back as a code and becomes the person's words.

import { useCallback, useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { getPaletteEnv } from '../search/search-env.js';
import { menuRunner } from '../shell/menu-runner.js';
import { DS_MAKE_EVENT } from './default-write.js';
import {
  makeBrief,
  MAKE_WORDS,
  READY_WORDS,
  readiness,
  sectionsToPost,
  systemLabelFor,
  systemNameFor,
} from './make-model.js';
import { DsMakeSheet } from './make-sheet.jsx';
import { finishMaking, makeSystem, readMakeState, uploadLogo } from './make-write.js';
import { finishedMaking } from './switch-bus.js';
import { ownSystemOf } from './truth-model.js';

export const MAKE_POLL_MS = 2500;

/** How many canvases the project has that a system could learn from (a system's own folder is not one). */
export function canvasCount(cfg) {
  const root = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
  return Object.keys(cfg?.canvasDesignSystems ?? {}).filter((file) => {
    const rel = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    return /\.tsx$/i.test(rel) && !rel.startsWith('system/');
  }).length;
}

/**
 * The ready card (13 · ds-make-done). Draws what it is given.
 * @param {{ label: string, complete: boolean, missing: string[], busy?: boolean, note?: string | null, onUse: () => void }} props
 */
export function MakeReadyBanner({ label, complete, missing, busy = false, note = null, onUse }) {
  return (
    <div className="island dsm-ready" role="status" data-testid="ds-make-ready">
      <span className="dsm-ready-ic" aria-hidden="true">
        <StIcon name="layers" size={16} />
      </span>
      <span className="dsm-ready-t">
        <b data-testid="ds-make-ready-title">
          {complete ? READY_WORDS.ready(label) : READY_WORDS.partly(label)}
        </b>
        <em data-testid="ds-make-ready-sub">
          {missing.length ? `Still missing: ${missing.join(', ')}.` : READY_WORDS.sub}
        </em>
        {note ? (
          <em className="dsm-ready-note" data-testid="ds-make-ready-note" data-tone="warn">
            {note}
          </em>
        ) : null}
      </span>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        disabled={busy}
        data-testid="ds-make-use"
        onClick={onUse}
      >
        {busy ? READY_WORDS.busy : READY_WORDS.use(label)}
      </button>
    </div>
  );
}

/**
 * @param {{ cfg: any, activePath: string | null, toast?: (m: string) => void, frameFor?: () => (HTMLIFrameElement | null),
 *           fetchImpl?: typeof fetch, pollMs?: number, openSystem?: (ds: string) => void }} props
 */
export function DsMakeHost({ cfg, activePath, toast, frameFor, fetchImpl, pollMs, openSystem }) {
  const [sheet, setSheet] = useState(null); // { project }
  const [state, setState] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState(null);
  const live = useRef({});
  live.current = { cfg, activePath, toast, frameFor, fetchImpl, openSystem };
  const f = () => live.current.fetchImpl ?? globalThis.fetch;
  const say = (m) => live.current.toast?.(m);
  const opening = useRef(null);

  // 1 — the door
  useEffect(() => {
    const onDoor = (ev) => {
      ev.preventDefault();
      const env = getPaletteEnv();
      const project = String(ev.detail?.project || env.projectName || '').trim();
      setSheet({ project });
    };
    window.addEventListener(DS_MAKE_EVENT, onDoor);
    return () => window.removeEventListener(DS_MAKE_EVENT, onDoor);
  }, []);

  // 2 — the new system's canvas opens as soon as the studio knows the system
  useEffect(() => {
    const ds = opening.current;
    if (!ds || !(cfg?.designSystems ?? []).some((d) => d.name === ds)) return;
    opening.current = null;
    const open = live.current.openSystem ?? ((name) => menuRunner.run('ds.go-to', { ds: name }));
    open(ds);
  }, [cfg?.designSystems]);

  const onMake = useCallback(
    async ({ sentence, audience, refs }) => {
      const { cfg: c } = live.current;
      const project = systemLabelFor(sheet?.project);
      const taken = (c?.designSystems ?? []).map((d) => d.name);
      const ds = systemNameFor(project, taken);
      const made = await makeSystem({ ds, label: project }, f());
      if (!made.ok) return { ok: false, message: made.message };
      const env = getPaletteEnv();
      const brief = makeBrief({
        ds,
        label: project,
        sentence,
        audience,
        refs,
        canvases: canvasCount(c),
      });
      // the person's own gesture: the run starts from a brief they can read in the composer
      env.askAI?.(brief, { send: true, origin: 'ds-make' });
      opening.current = ds;
      say(MAKE_WORDS.started(project));
      setSheet(null);
      // the studio may already know the system (its index refreshed first)
      if ((c?.designSystems ?? []).some((d) => d.name === ds)) {
        opening.current = null;
        (live.current.openSystem ?? ((name) => menuRunner.run('ds.go-to', { ds: name })))(ds);
      }
      return { ok: true };
      // biome-ignore lint/correctness/useExhaustiveDependencies: reads the live ref; `sheet` is the project's name
    },
    [sheet?.project]
  );

  const onLogo = useCallback(async (file) => {
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return { ok: false, message: 'Couldn’t open that file.' };
    }
    return uploadLogo(bytes, f());
  }, []);

  // 3 — the open Design system canvas of a system that is being made
  const ds = ownSystemOf(activePath, cfg);
  useEffect(() => {
    if (!ds) {
      setState(null);
      return undefined;
    }
    let off = false;
    let was = false;
    const look = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const s = await readMakeState(ds, f());
      if (off || !s) return;
      setState(s);
      const sections = sectionsToPost(s);
      if (!sections && !was) return;
      was = !!sections;
      const frame = live.current.frameFor?.();
      try {
        frame?.contentWindow?.postMessage(
          { type: 'maude:ds-make-states', sections: sections ?? {} },
          live.current.cfg?.canvasOrigin || window.location.origin
        );
      } catch {
        /* the frame went away */
      }
    };
    look();
    const t = setInterval(look, pollMs ?? MAKE_POLL_MS);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [ds, pollMs]);

  // 4 — "Use as <name>'s style"
  const label =
    (cfg?.designSystems ?? []).find((d) => d.name === state?.system)?.label || state?.system || '';
  const onUse = useCallback(async () => {
    if (!state || finishing) return;
    setFinishing(true);
    setNote(null);
    const r = await finishMaking({ ds: state.system }, f());
    setFinishing(false);
    if (!r.ok) return setNote(r.message);
    const result = r.body ?? {};
    const miss = readiness(state).missing;
    say(miss.length ? READY_WORDS.usedMissing(label, miss) : READY_WORDS.used(label));
    // a system that has become the default offers the existing canvases one review
    finishedMaking(result);
    const next = await readMakeState(state.system, f());
    return setState(next);
    // biome-ignore lint/correctness/useExhaustiveDependencies: `say` and `f` read the live ref
  }, [state, finishing, label]);

  const ready = readiness(state);
  return (
    <>
      {sheet ? (
        <DsMakeSheet
          project={sheet.project || 'this project'}
          canvases={canvasCount(cfg)}
          canAskAI={!!getPaletteEnv().canAskAI?.()}
          onMake={onMake}
          onLogo={onLogo}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {ds && state && ready.show ? (
        <MakeReadyBanner
          label={label}
          complete={ready.complete}
          missing={ready.missing}
          busy={finishing}
          note={note}
          onUse={onUse}
        />
      ) : null}
    </>
  );
}
