// client/v2/ds/review-host.jsx — S10.8: the shell's side of "Update N canvases".
//
// The sheet (review-sheet.jsx) only draws. This host fetches what it draws (the review, what waits, how many
// places each canvas uses), does the two writes it can ask for (Update, Cancel) and says the outcome in words.
// It is mounted once in the shell; registry actions reach it through review-bus.js. It also publishes the
// Canvases rows' "update" word (row-dots.js) — one mount, one place the DS review lives.
//
// Every write is the server's to refuse (routes/ds.ts, Can edit on the whole project): a refusal comes back as a
// code and this file turns it into the person's words (review-model.js `refusalWords`). Nothing is trusted from
// the page: the system comes from the canvas the person has open, never from a request body.

import { useCallback, useEffect, useRef, useState } from 'react';
import { canvasDsSystem } from '../../canvas-url.js';
import { loadReach } from './reach-data.js';
import { DsAdvancedHost } from './advanced-host.jsx';
import { DsLibraryHost } from './library-host.jsx';
import { DsReachView } from './reach-view.jsx';
import { DsReviewSheet } from './review-sheet.jsx';
import { useCoverOf } from './use-covers.js';
import { onDsReviewRequest } from './review-bus.js';
import {
  masterLines,
  publishBody,
  REVIEW_WORDS,
  refusalWords,
  updatedWords,
  withValueNames,
} from './review-model.js';
import { fetchBoard } from './token-write.js';
import { useDsRowDots } from './row-dots.js';
import { DsOffSystemHost } from './off-system-host.jsx';
import { DsSwitchHost } from './switch-host.jsx';
import { DsConvertHost } from './convert-host.jsx';
import { DsMakeHost } from './make-host.jsx';
import { DsTruthHost } from './truth-host.jsx';
import { DsUpgradeHost } from './upgrade-host.jsx';
import { useDsUpdateDots } from './update-dots.js';
import { bodyOf } from './update-available.jsx';

const JSON_HEADERS = { 'content-type': 'application/json' };
const CANCELLED = 'Put back. No canvas changed.';
const USAGE_CAP = 8; // tokens / masters whose usage is asked for: the sheet shows three lines at most

async function call(fetchImpl, method, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      cache: 'no-store',
      ...(body ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, code: 'unreachable', body: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* an unreadable answer is judged by its status */
  }
  const code = res.ok ? null : (json?.code ?? (res.status === 403 ? 'forbidden' : 'failed'));
  return { ok: res.ok, code, body: json };
}

/** `{ [designRoot-relative canvas]: places }` for what changed — summed over the changed tokens and masters. */
export async function placesOf(ds, changes, components, fetchImpl = globalThis.fetch) {
  const asks = [
    ...changes.slice(0, USAGE_CAP).map((c) => `css=${encodeURIComponent(c.css)}`),
    ...components.slice(0, USAGE_CAP).map((n) => `component=${encodeURIComponent(n)}`),
  ];
  const answers = await Promise.all(
    asks.map((q) => call(fetchImpl, 'GET', `/_api/ds/usage?ds=${encodeURIComponent(ds)}&${q}`))
  );
  const places = {};
  for (const a of answers) {
    if (!a.ok) continue;
    for (const c of a.body?.canvases ?? []) {
      if (typeof c?.rel === 'string' && Number.isFinite(c.places))
        places[c.rel] = (places[c.rel] ?? 0) + c.places;
    }
  }
  return places;
}

/**
 * What the sheet needs, or a reason in words. `waitingFor`: the person has nothing pending to review.
 * @returns {Promise<{ ok: true, review: any, components: string[], places: Record<string, number> } | { ok: false, message: string }>}
 */
export async function loadDsReview(ds, fetchImpl = globalThis.fetch) {
  const [rev, state, board] = await Promise.all([
    call(fetchImpl, 'POST', '/_api/ds/publish', { ds, dryRun: true }),
    call(fetchImpl, 'GET', `/_api/ds/state?ds=${encodeURIComponent(ds)}`),
    fetchBoard(ds, fetchImpl),
  ]);
  if (!rev.ok) return { ok: false, message: refusalWords(rev.code) };
  const review = rev.body;
  const changes = Array.isArray(review?.changes) ? review.changes : [];
  const pending = state.body?.systems?.[0]?.pending;
  const components =
    pending?.components && typeof pending.components === 'object'
      ? Object.keys(pending.components)
      : [];
  if (changes.length === 0 && components.length === 0)
    return { ok: false, message: REVIEW_WORDS.noneWaiting };
  return {
    ok: true,
    review: {
      system: review.system ?? ds,
      expectHead: review.expectHead ?? null,
      changes: withValueNames(changes, board),
      canvases: Array.isArray(review.canvases) ? review.canvases : [],
    },
    components,
    componentLines: masterLines(board),
    places: await placesOf(ds, changes, components, fetchImpl),
  };
}

/** Update: the ticks go to `POST /_api/ds/publish`; one action, one ⌘Z (the server records it). */
export async function publishReview({ ds, expectHead }, rows, fetchImpl = globalThis.fetch) {
  const r = await call(
    fetchImpl,
    'POST',
    '/_api/ds/publish',
    publishBody({ ds, expectHead }, rows)
  );
  if (!r.ok) return { ok: false, message: refusalWords(r.code) };
  const result = r.body?.result;
  return {
    ok: true,
    updated: Number.isFinite(result?.updated) ? result.updated : 0,
    leftOut: Number.isFinite(result?.leftOut) ? result.leftOut : 0,
  };
}

/**
 * ds.review-update: the element's overrides become waiting edits. The page names the element and the target
 * (a master or a type role) and nothing else — the server reads the canvas and works the CSS out (routes/ds.ts,
 * ds/override-map.ts), so no CSS crosses from here.
 */
export async function pushOverride(
  { ds, canvas, elementId, target },
  fetchImpl = globalThis.fetch
) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/pending', {
    ds,
    from: { canvas, elementId, target },
  });
  return r.ok
    ? { ok: true, entries: Number.isFinite(r.body?.mapped?.entries) ? r.body.mapped.entries : 0 }
    : { ok: false, message: refusalWords(r.code, REVIEW_WORDS.pushFailed) };
}

/** Cancel: "puts the swatch back" — what waited is dropped, no canvas changes. */
export async function cancelReview({ ds }, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/pending', { ds, cancel: true });
  return r.ok
    ? { ok: true }
    : {
        ok: false,
        message: r.code === 'forbidden' ? REVIEW_WORDS.forbidden : REVIEW_WORDS.cancelFailed,
      };
}

/** What the reach view calls the token: the inspector's own label, bounded; never markup (React escapes it). */
const reachName = (req) =>
  typeof req?.name === 'string' && req.name.trim() ? req.name.trim().slice(0, 80) : '';

/** The swatch line of a reach request: names are text, values are colours only if `safeColour` says so. */
function reachSwatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = (v) => (typeof v === 'string' && v.length <= 120 ? v : null);
  return {
    before: t(raw.before),
    after: t(raw.after),
    beforeName: t(raw.beforeName),
    afterName: t(raw.afterName),
  };
}

/** The system a request names: the canvas it came from (or the open one) decides, never the request's own `ds`. */
export function systemOf(req, cfg, activePath) {
  const at = typeof req?.canvas === 'string' && req.canvas ? req.canvas : activePath;
  const entry = at ? canvasDsSystem(at, cfg) : (cfg?.designSystems?.[0] ?? null);
  const ds = typeof req?.ds === 'string' && req.ds ? req.ds : entry?.name;
  if (!ds || cfg?.dsConverted?.[ds] !== true) return null;
  return ds;
}

/**
 * @param {{ cfg: any, activePath: string | null, toast?: (m: string) => void, scope?: string,
 *           frameFor?: () => HTMLIFrameElement | null, fetchImpl?: typeof fetch }} props
 */
export function DsReviewHost({ cfg, activePath, toast, scope = '', frameFor, fetchImpl }) {
  useDsRowDots(cfg);
  // a canvas left out of an update: the elements that wear what changed get a dot (drawn by the canvas shell)
  useDsUpdateDots({
    cfg,
    activePath,
    revisionBody: bodyOf,
    frameFor: frameFor ?? (() => null),
    fetchImpl,
  });
  const [sheet, setSheet] = useState(null);
  // p8 c7 — the sheet's rows wear their canvas's own picture
  const coverOf = useCoverOf({ active: !!sheet, fetchImpl });
  // S10.9 — "Used in 5 canvases · Show": the reach view (reach-view.jsx), with the same review list beside it
  const [reach, setReach] = useState(null);
  const live = useRef({ cfg, activePath, toast, fetchImpl });
  live.current = { cfg, activePath, toast, fetchImpl };
  const say = (m) => live.current.toast?.(m);
  const f = () => live.current.fetchImpl ?? globalThis.fetch;

  useEffect(
    () =>
      onDsReviewRequest(async (req) => {
        const { cfg: c, activePath: at } = live.current;
        const ds = systemOf(req, c, at);
        if (!ds) return say('This canvas follows no design system that can be updated yet.');
        if (req.kind === 'reach') {
          const [r, rev] = await Promise.all([
            loadReach({ ds, css: req.css, component: req.component, name: reachName(req) }, f()),
            loadDsReview(ds, f()),
          ]);
          if (!r.ok) return say(r.message);
          setSheet(null);
          setReach({
            ds,
            name: reachName(req) || 'This',
            swatch: reachSwatch(req.swatch),
            model: r.model,
            review: rev.ok ? rev.review : null,
            places: rev.ok ? rev.places : {},
          });
          return;
        }
        if (req.kind === 'cancel') {
          const r = await cancelReview({ ds }, f());
          return say(r.ok ? CANCELLED : r.message);
        }
        if (req.kind === 'push') {
          const pushed = await pushOverride(
            {
              ds,
              canvas: typeof req.canvas === 'string' && req.canvas ? req.canvas : at,
              elementId: req.elementId,
              target: req.target,
            },
            f()
          );
          if (!pushed.ok) return say(pushed.message);
        }
        const loaded = await loadDsReview(ds, f());
        if (!loaded.ok) return say(loaded.message);
        setReach(null);
        setSheet({ ds, ...loaded });
      }),
    []
  );

  const close = useCallback(() => setSheet(null), []);
  const closeReach = useCallback(() => setReach(null), []);
  // S10.11 — the outside-change review and the conflict pick live in the inspector's empty place; their host rides here
  // S10.12 — "Convert system folders" (the folder view's banner, `ds.convert`) rides here too
  // S10.19 — Design system › Advanced and Check the system (the system panel in the same place) ride the same mount
  // S10.18c — a linked team library's card, update review and banner ride it too
  const truth = (
    <>
      <DsTruthHost
        cfg={cfg}
        activePath={activePath}
        toast={toast}
        frameFor={frameFor}
        fetchImpl={fetchImpl}
      />
      <DsConvertHost toast={toast} fetchImpl={fetchImpl} />
      <DsAdvancedHost cfg={cfg} activePath={activePath} toast={toast} fetchImpl={fetchImpl} />
      {/* S10.18c — a linked team library: its card, "Update from …?", the banner and the 30-min check */}
      <DsLibraryHost
        cfg={cfg}
        activePath={activePath}
        toast={toast}
        scope={scope}
        fetchImpl={fetchImpl}
      />
    </>
  );
  // S10.14 — "Switch canvases to …?" and "Preview in …" ride the same mount; so does S10.17's off-system question
  const switcher = (
    <>
      <DsSwitchHost cfg={cfg} activePath={activePath} toast={toast} fetchImpl={fetchImpl} />
      {/* S10.15b — "Bring <system> up to the schema?": the amber dot, the row's menu and the switch's level-11 refusal */}
      <DsUpgradeHost cfg={cfg} toast={toast} fetchImpl={fetchImpl} />
      <DsOffSystemHost cfg={cfg} activePath={activePath} toast={toast} fetchImpl={fetchImpl} />
      {/* S10.16b — "Make a design system": the three-input sheet, the filling sections, the ready card */}
      <DsMakeHost
        cfg={cfg}
        activePath={activePath}
        toast={toast}
        frameFor={frameFor}
        fetchImpl={fetchImpl}
      />
    </>
  );
  if (reach) {
    return (
      <>
        {truth}
        {switcher}
        <DsReachView
          key={`${reach.ds}:${reach.name}`}
          ds={reach.ds}
          cfg={cfg}
          name={reach.name}
          swatch={reach.swatch}
          reach={reach.model}
          review={reach.review}
          places={reach.places}
          scope={scope}
          onClose={closeReach}
          onUpdate={async (rows) => {
            const r = await publishReview(
              { ds: reach.ds, expectHead: reach.review.expectHead },
              rows,
              f()
            );
            if (!r.ok) return r;
            say(updatedWords(r.updated, r.leftOut));
            setReach(null);
            return { ok: true };
          }}
          onCancel={async () => {
            const r = await cancelReview({ ds: reach.ds }, f());
            if (!r.ok) return r;
            say(CANCELLED);
            setReach(null);
            return { ok: true };
          }}
        />
      </>
    );
  }
  if (!sheet)
    return (
      <>
        {truth}
        {switcher}
      </>
    );
  return (
    <>
      {truth}
      {switcher}
      <DsReviewSheet
        key={`${sheet.ds}:${sheet.review.expectHead}`}
        review={sheet.review}
        components={sheet.components}
        componentLines={sheet.componentLines}
        places={sheet.places}
        scope={scope}
        coverOf={coverOf}
        onClose={close}
        onUpdate={async (rows) => {
          const r = await publishReview(
            { ds: sheet.ds, expectHead: sheet.review.expectHead },
            rows,
            f()
          );
          if (!r.ok) return r;
          say(updatedWords(r.updated, r.leftOut));
          setSheet(null);
          return { ok: true };
        }}
        onCancel={async () => {
          const r = await cancelReview({ ds: sheet.ds }, f());
          if (!r.ok) return r;
          say(CANCELLED);
          setSheet(null);
          return { ok: true };
        }}
      />
    </>
  );
}
