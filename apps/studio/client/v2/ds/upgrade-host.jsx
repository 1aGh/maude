// client/v2/ds/upgrade-host.jsx — S10.15b: the shell's side of "Bring <system> up to the schema?".
//
// The sheet (upgrade-sheet.jsx) only draws. This host asks the server what the system and its stages are
// (`POST /_api/ds/upgrade {step:'status'}`), starts the AI when the person presses "✦ Bring it up"
// (`askAI(brief, { send: true, origin: 'ds-upgrade' })` — the person's own gesture, every composer gate applies),
// watches the stage the AI makes while it is staged, checked (progress) and proved, and applies it — one action,
// one undo step — when the person presses the primary button. Cancel stops a proof in flight and puts a stage
// back. Mounted once in the shell (inside the DS review host); `ds.upgrade` (menu-runner.js), the amber dot and
// the switch sheet's level-11 refusal reach it through upgrade-bus.js.
//
// Nothing is trusted from the page: the server judges every step again (Can edit on the whole project).

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPaletteEnv } from '../search/search-env.js';
import { canvasesIn } from './switch-host.jsx';
import { dsRefresh } from './ds-refresh.js';
import { onDsUpgradeRequest } from './upgrade-bus.js';
import {
  appliedWords,
  refusalWords,
  UPGRADE_WORDS,
  upgradeBrief,
  viewOf,
} from './upgrade-model.js';
import { DsUpgradeSheet } from './upgrade-sheet.jsx';

const JSON_HEADERS = { 'content-type': 'application/json' };
/**
 * 2.0.5 (#205): the sheet asks again when something it shows may have moved — the window is looked at, the shell
 * wrote a system, the AI run registry moved (`maude:ai-runs`), an action landed (`maude:project-action`) — and
 * after a failed read (5 s doubling to 5 min). The ONE clock left is `TICK_MS`, only while the AI or the check is
 * working with the sheet open: a proof's progress ("2 of 6 canvases checked") has no push. A settled sheet reads
 * on events only.
 */
export const TICK_MS = 5000;
export const UPGRADE_EVENTS = ['maude:ai-runs', 'maude:project-action'];
/** A request the AI was sent off with is remembered this long, so closing and reopening does not ask twice. */
const ASKED_MS = 30 * 60 * 1000;
const askedAt = new Map();
/** Test seam. */
export const resetUpgradeAsked = () => askedAt.clear();

async function call(fetchImpl, body) {
  let res;
  try {
    res = await fetchImpl('/_api/ds/upgrade', {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
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

/** What the system is and every live stage of it, or a reason in words. */
export async function loadUpgradeStatus(ds, label, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, { ds, step: 'status' });
  if (!r.ok) return { ok: false, message: refusalWords(r.code, label) };
  return { ok: true, status: r.body };
}

/** The mechanical plan (what the four lines say before the AI has run), or null. */
export async function loadUpgradePlan(ds, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, { ds, step: 'analyse' });
  return r.ok ? r.body : null;
}

/** Apply a proved stage: one action, one undo step (the server records it). */
export async function applyUpgrade(ds, stage, label, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, { ds, step: 'apply', stage });
  if (!r.ok) return { ok: false, message: refusalWords(r.code, label) };
  return { ok: true, result: r.body };
}

export async function cancelUpgrade(ds, stage, fetchImpl = globalThis.fetch) {
  await call(fetchImpl, { ds, step: 'cancel', stage });
  return call(fetchImpl, { ds, step: 'discard', stage });
}

/**
 * @param {{ cfg: any, toast?: (m: string) => void, fetchImpl?: typeof fetch, tickMs?: number }} props
 */
export function DsUpgradeHost({ cfg, toast, fetchImpl, tickMs = TICK_MS }) {
  const [sheet, setSheet] = useState(null);
  const live = useRef({ cfg, toast, fetchImpl, sheet: null });
  live.current = { cfg, toast, fetchImpl, sheet };
  const say = (m) => live.current.toast?.(m);
  const f = () => live.current.fetchImpl ?? globalThis.fetch;
  const labelOf = (name) => {
    const d = (live.current.cfg?.designSystems ?? []).find((x) => x.name === name);
    return String(d?.label || name || '');
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `say`, `f` and `labelOf` read the live ref
  useEffect(
    () =>
      onDsUpgradeRequest(async (req) => {
        const ds = req.ds;
        if (!(live.current.cfg?.designSystems ?? []).some((d) => d.name === ds)) return;
        const label = labelOf(ds);
        const loaded = await loadUpgradeStatus(ds, label, f());
        if (!loaded.ok) return say(loaded.message);
        const idle = !loaded.status.converted && (loaded.status.stages ?? []).length === 0;
        const plan = idle ? await loadUpgradePlan(ds, f()) : null;
        setSheet({ ds, label, status: loaded.status, plan });
        return undefined;
      }),
    []
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `f` reads the live ref
  const refresh = useCallback(async (fx) => {
    const s = live.current.sheet;
    if (!s) return;
    const r = await loadUpgradeStatus(s.ds, s.label, typeof fx === 'function' ? fx : f());
    // the sheet may have been closed (or reopened on another system) while the answer was on its way
    if (r.ok && live.current.sheet?.ds === s.ds)
      setSheet((cur) => (cur && cur.ds === s.ds ? { ...cur, status: r.status } : cur));
  }, []);

  const asked = sheet ? Date.now() - (askedAt.get(sheet.ds) ?? 0) < ASKED_MS : false;
  const canAskAI = !!getPaletteEnv().canAskAI?.();
  const view = sheet
    ? viewOf({
        status: sheet.status,
        asked,
        plan: sheet.plan,
        label: sheet.label,
        canvases: canvasesIn(sheet.ds, cfg),
        canAskAI,
      })
    : null;

  // while the AI or the check works the sheet follows events, with one slow tick for the proof's progress; a
  // settled sheet (ask, review, converted) hears nothing between events
  const busyView = view?.kind === 'working' || view?.kind === 'proving';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `f` reads the live ref
  useEffect(() => {
    if (!busyView) return undefined;
    const r = dsRefresh((fx) => refresh(fx), {
      fetchImpl: () => live.current.fetchImpl ?? globalThis.fetch,
      events: UPGRADE_EVENTS,
      slowMs: tickMs,
      skipFirst: true,
      paused: () => false,
    });
    return () => r.stop();
  }, [busyView, refresh, tickMs]);

  const close = useCallback(() => setSheet(null), []);

  if (!sheet || !view) return null;
  return (
    <DsUpgradeSheet
      key={sheet.ds}
      label={sheet.label}
      view={view}
      canvases={canvasesIn(sheet.ds, cfg)}
      onAsk={async () => {
        const env = getPaletteEnv();
        // the person's own gesture: the run starts from a brief they can read in the composer
        env.askAI?.(upgradeBrief({ ds: sheet.ds, label: sheet.label }), {
          send: true,
          origin: 'ds-upgrade',
        });
        askedAt.set(sheet.ds, Date.now());
        // re-derive: `asked` is read from the map on the next render
        setSheet((cur) => (cur ? { ...cur } : cur));
        return { ok: true };
      }}
      onApply={async () => {
        const r = await applyUpgrade(sheet.ds, view.stamp, sheet.label, f());
        if (!r.ok) return r;
        askedAt.delete(sheet.ds);
        say(appliedWords(r.result, sheet.label));
        setSheet(null);
        return { ok: true };
      }}
      onCancel={async () => {
        // a proof in flight stops; a stage that was made is put back; waiting for the AI just closes
        if (view.stamp) {
          await cancelUpgrade(sheet.ds, view.stamp, f());
          say(UPGRADE_WORDS.discarded);
        }
        askedAt.delete(sheet.ds);
        setSheet(null);
      }}
      onClose={close}
    />
  );
}
