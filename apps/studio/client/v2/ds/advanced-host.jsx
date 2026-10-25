// client/v2/ds/advanced-host.jsx — S10.19: the shell's side of Design system › Advanced and Check the system
// (13 · ds-advanced).
//
// Mounted once, inside DsReviewHost (which the shell already mounts). While the open canvas is a system's own
// Design system canvas it reads the system's files (`GET /_api/ds/system-files`), the answer the last check kept
// (`GET /_api/ds/check-system`) and the board's facts (name, canvases, modes), keeps them in a tiny store the
// inspector's empty place reads (advanced-store.js → advanced.jsx), and runs what the panel asks for:
//
//   Check the system     POST /_api/ds/check-system {ds}        (Can edit; the server judges)
//   Show                 ds.go-to {ds, token}                    the token, on the Design system canvas
//   Hand off tokens      ds.handoff-tokens                       the handoff sheet (target `tokens` is S8.10's)
//   Reveal in Finder     the Mac app's `project_reveal_path`     (a browser tab has no Finder: the button is absent)
//   Restore…             history.open                            Version history, where a publish is one step back
//   Ask AI to review     the AI chat's composer, filled          never sent: pressing send is the person's
//
// Registry actions reach it through advanced-bus.js (`ds.check-system`, `ds.reveal-files` from a system's own
// menu). Every write is the server's to refuse; a refusal comes back as a code and becomes the person's words.
// The system comes from the canvas the person has open, never from a message.

import { useEffect, useRef } from 'react';
import { dispatchCanvasOp } from '../left-panel/left-panel-bus.js';
import { menuRunner } from '../shell/menu-runner.js';
import { nativeDoors } from '../shell/native-doors.js';
import { onDsAdvancedRequest } from './advanced-bus.js';
import { ADVANCED_WORDS, askAiText, checkToast, revealRel } from './advanced-model.js';
import { setAdvanced, setAdvancedActions } from './advanced-store.js';
import { fetchBoard } from './token-write.js';
import { ownSystemOf } from './truth-model.js';

export const ADVANCED_POLL_MS = 8000;
const JSON_HEADERS = { 'content-type': 'application/json' };
const NO_FINDER = 'Open this project in the Mac app to work with its files.';

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

/** What a refusal says, in words. */
export function checkRefusalWords(code) {
  if (code === 'forbidden') return ADVANCED_WORDS.refused;
  return ADVANCED_WORDS.failed;
}

/**
 * Everything the panel draws for one system. `board` (the system's name, canvases, modes) is read once and kept —
 * the files and the last check are read every time.
 * @returns {Promise<{ ds, label, canvases, modes, files, check, board } | null>}
 */
export async function loadAdvanced(ds, fetchImpl = globalThis.fetch, board = null) {
  const q = encodeURIComponent(ds);
  const [files, last, b] = await Promise.all([
    call(fetchImpl, 'GET', `/_api/ds/system-files?ds=${q}`),
    call(fetchImpl, 'GET', `/_api/ds/check-system?ds=${q}`),
    board ? Promise.resolve(board) : fetchBoard(ds, fetchImpl),
  ]);
  if (!files.ok || files.body?.format !== 'maude.ds-system-files') return null;
  return {
    ds,
    label: typeof b?.label === 'string' && b.label ? b.label : ds,
    canvases: Number.isFinite(b?.canvases) ? b.canvases : null,
    modes: b?.themes ? { light: b.themes.light, dark: b.themes.dark } : null,
    files: files.body,
    check: last.ok ? (last.body?.check ?? null) : null,
    board: b,
  };
}

/** Run the check on `ds`. */
export async function runCheck(ds, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/check-system', { ds });
  return r.ok
    ? { ok: true, check: r.body }
    : { ok: false, message: checkRefusalWords(r.code), code: r.code };
}

/** Finder opens the system's folder. */
export async function revealSystem(cfg, ds, doors = nativeDoors()) {
  const entry = (Array.isArray(cfg?.designSystems) ? cfg.designSystems : []).find(
    (d) => d?.name === ds
  );
  const rel = revealRel(cfg?.designRel || '.design', entry?.path);
  if (!rel) return { ok: false, message: 'There is no folder to show.' };
  const r = await doors.revealPath(rel);
  if (r?.ok) return { ok: true };
  return {
    ok: false,
    message: r?.reason === 'browser' ? NO_FINDER : r?.error || 'Couldn’t do that.',
  };
}

/**
 * @param {{ cfg: any, activePath: string | null, toast?: (m: string) => void,
 *           fetchImpl?: typeof fetch, pollMs?: number }} props
 */
export function DsAdvancedHost({ cfg, activePath, toast, fetchImpl, pollMs = ADVANCED_POLL_MS }) {
  const ds = ownSystemOf(activePath, cfg);
  const live = useRef({ cfg, activePath, toast, fetchImpl });
  live.current = { cfg, activePath, toast, fetchImpl };
  const f = () => live.current.fetchImpl ?? globalThis.fetch;
  const say = (m) => live.current.toast?.(m);
  const board = useRef(null);

  // The registry actions reach the host from anywhere (a system's own menu), so this listener is not tied to the
  // open canvas. A check of ANOTHER system says the outcome and goes there, where the card shows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the listener reads everything through `live`
  useEffect(
    () =>
      onDsAdvancedRequest(async (req) => {
        const target = typeof req.ds === 'string' && req.ds ? req.ds : ds;
        if (!target) return say('There is no design system to check.');
        if (req.kind === 'reveal') {
          const r = await revealSystem(live.current.cfg, target);
          if (!r.ok) say(r.message);
          return;
        }
        const r = await runCheck(target, f());
        if (!r.ok) return say(r.message);
        say(checkToast(r.check));
        if (target !== ds) menuRunner.run('ds.go-to', { ds: target });
      }),
    [ds]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ds` and the poll rate are the triggers; the rest rides on `live`
  useEffect(() => {
    if (!ds) {
      setAdvanced(null);
      setAdvancedActions(null);
      board.current = null;
      return undefined;
    }
    let dead = false;
    let seq = 0;
    const native = nativeDoors().available;

    const refresh = async ({ withBoard = false } = {}) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const n = ++seq;
      const got = await loadAdvanced(ds, f(), withBoard ? null : board.current);
      if (dead || n !== seq) return;
      if (!got) {
        setAdvanced(null);
        return;
      }
      board.current = got.board;
      const { board: _b, ...rest } = got;
      setAdvanced((was) => ({
        ...rest,
        project: live.current.cfg?.cloud?.projectName || live.current.cfg?.name || '',
        native,
        busy: was?.ds === ds ? was.busy : false,
        note: was?.ds === ds ? was.note : null,
      }));
    };

    const check = async () => {
      setAdvanced((v) => (v ? { ...v, busy: true, note: null } : v));
      const r = await runCheck(ds, f());
      if (dead) return;
      if (!r.ok) {
        setAdvanced((v) => (v ? { ...v, busy: false, note: r.message } : v));
        return;
      }
      setAdvanced((v) => (v ? { ...v, busy: false, note: null, check: r.check } : v));
      say(checkToast(r.check));
    };

    setAdvancedActions({
      check,
      show: (css) => menuRunner.run('ds.go-to', { ds, token: css }),
      handoff: () => menuRunner.run('ds.handoff-tokens', { ds }),
      history: () => menuRunner.run('history.open'),
      reveal: async () => {
        const r = await revealSystem(live.current.cfg, ds);
        if (!r.ok) say(r.message);
      },
      askAi: () => {
        const label = board.current?.label;
        const path = live.current.activePath;
        if (path) dispatchCanvasOp('ask-ai-fix', path, askAiText(ds, label));
      },
    });

    refresh({ withBoard: true });
    const timer = setInterval(() => refresh(), pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh({ withBoard: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      setAdvancedActions(null);
      setAdvanced(null);
    };
  }, [ds, pollMs]);

  return null;
}
