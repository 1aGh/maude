// client/v2/ds/convert-host.jsx — S10.12: the shell's side of "Convert system folders". It answers `ds.convert` (the
// banner on today's folder view, the registry row) through DS_CONVERT_EVENT, reads the server's dry run, draws the
// dialog and does the one write. Mounted next to the other design-system hosts (review-host.jsx). The server judges
// the role and re-plans under its locks: what the dialog showed is what it converts, or it refuses and says why.
//
// p8-v1-drop (decision maude/v2-michal-drop-v1-auto-convert): folder → canvas also runs BY ITSELF when an editable
// project opens — it is deterministic and backed up (`_history/_ds-convert/`, Restore in Version history), so there
// is nothing to decide. It runs once per project per app session (sessionStorage; a failure is not retried in a
// loop — the dialog stays the way to try again by hand), only when every folder can convert (one run converts all
// or none), and says so: "Design systems moved onto canvases."

import { useCallback, useEffect, useRef, useState } from 'react';
import { menuRunner } from '../shell/menu-runner.js';
import { DsConvertDialog } from './convert-dialog.jsx';
import {
  CONVERT_WORDS,
  convertSystems,
  DS_CONVERT_EVENT,
  dialogModel,
  fetchConvertPlan,
} from './convert-model.js';

/** The once-per-session guard for the automatic run (per project). */
export function autoConvertKey(project) {
  return `maude-ds-auto-convert:${project ?? ''}`;
}
function claimAutoRun(project) {
  try {
    if (sessionStorage.getItem(autoConvertKey(project)) === '1') return false;
    sessionStorage.setItem(autoConvertKey(project), '1');
    return true;
  } catch {
    return true; // private window: the in-page guard below still runs it once
  }
}
const ranThisPage = new Set();

/**
 * The automatic folder → canvas run (pure over its seams): the dry run, then — only when there is something to
 * convert and nothing is refused — the one all-or-nothing write. Returns what happened, for the caller's notice.
 */
export async function autoConvertSystems({ fetchImpl = globalThis.fetch } = {}) {
  const plan = await fetchConvertPlan(null, { fetchImpl });
  if (!plan.ok) return { ran: false };
  const m = dialogModel(plan.body);
  if (!m.rows.length || !m.canConvert) return { ran: false };
  const r = await convertSystems(
    m.rows.map((x) => x.name),
    { fetchImpl }
  );
  return r.ok ? { ran: true, ok: true, message: CONVERT_WORDS.autoDone } : { ran: true, ok: false };
}

/**
 * `cfg` + `reloadTree` + `goTo`: once a convert finishes the studio reads the project again, and as soon as it
 * knows the system is a Design system canvas the open view switches to that canvas — the person never has to
 * open another canvas and come back (r4 #10). `goTo({ ds })` defaults to the `ds.go-to` action.
 */
export function DsConvertHost({
  toast,
  fetchImpl,
  target = globalThis.window,
  auto = null,
  cfg = null,
  reloadTree = null,
  goTo = null,
}) {
  const [model, setModel] = useState(null);
  // the system to open once the studio knows it is converted: { ds }
  const [pendingOpen, setPendingOpen] = useState(null);
  const askedFor = useRef(null); // the folder the banner sat on
  const reloadRef = useRef(reloadTree);
  reloadRef.current = reloadTree;
  const goRef = useRef(goTo);
  goRef.current = goTo;
  const f = useCallback(() => ({ fetchImpl: fetchImpl ?? globalThis.fetch }), [fetchImpl]);
  const say = useCallback((m, ok = true) => toast?.(m, ok), [toast]);

  useEffect(() => {
    if (!target?.addEventListener) return undefined;
    const on = async (ev) => {
      ev.preventDefault();
      askedFor.current = typeof ev.detail?.ds === 'string' ? ev.detail.ds : null;
      const r = await fetchConvertPlan(null, f());
      if (!r.ok) return say(r.message, false);
      const m = dialogModel(r.body);
      if (!m.rows.length) return say(CONVERT_WORDS.nothing);
      setModel(m);
    };
    target.addEventListener(DS_CONVERT_EVENT, on);
    return () => target.removeEventListener(DS_CONVERT_EVENT, on);
  }, [target, f, say]);

  // `auto` = { project } once the project is editable here (format 2, not view only); null holds it back.
  const autoProject = auto?.project ?? null;
  useEffect(() => {
    if (autoProject === null || ranThisPage.has(autoProject)) return;
    ranThisPage.add(autoProject);
    if (!claimAutoRun(autoProject)) return;
    void autoConvertSystems(f()).then((r) => {
      if (r.ran && r.ok) {
        say(r.message);
        void reloadRef.current?.();
      }
    });
  }, [autoProject, f, say]);

  // r4 #10 — the convert finished and the studio has read the project again: open the Design system canvas now
  const converted = cfg?.dsConverted;
  useEffect(() => {
    if (!pendingOpen || converted?.[pendingOpen.ds] !== true) return;
    setPendingOpen(null);
    const go = goRef.current ?? ((p) => menuRunner.run('ds.go-to', p));
    go({ ds: pendingOpen.ds });
  }, [pendingOpen, converted]);

  if (!model) return null;
  return (
    <DsConvertDialog
      model={model}
      onClose={() => setModel(null)}
      onConvert={async () => {
        const r = await convertSystems(
          model.rows.map((x) => x.name),
          f()
        );
        if (!r.ok) return r;
        say(r.message);
        const done = (r.result?.systems ?? []).map((x) => x.name);
        const want = done.includes(askedFor.current) ? askedFor.current : (done[0] ?? null);
        setModel(null);
        if (want) setPendingOpen({ ds: want });
        void reloadRef.current?.();
        return { ok: true };
      }}
    />
  );
}

/** Test seam. */
export function resetAutoConvert() {
  ranThisPage.clear();
}
