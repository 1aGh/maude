// AI runs and per-artboard leases over HTTP — V2-1.15 §5.3.
//
//   POST runs              begin (lease what is free, line up for the rest)
//   POST runs/:id/claim    more artboards mid-run (or confirm a provisional one)
//   POST runs/renew        keep this device's live runs alive (one call / 10 s)
//   POST runs/:id/end      release; the line moves up
//   GET  runs?after=<seq>  every live run, as members may see it (RunPublic)
//
// Under `/api/projects/:p/v1/`, bearer auth, in NEITHER canvas allowlist (the
// accepted-revisions dispatcher refuses the canvas origin before it gets here).
// Each route is ONE store call (L10): the store method is the transaction.
//
// Roles (rule 12 — hidden is not refused): begin / claim / renew / end need
// edit; a read-only bearer (Can comment, Can view) gets 403. A canvas-scoped
// member's keys must resolve inside their scope, or 403 — and GET shows them
// only the runs, artboards and objects on their canvases (V2-1.16).
//
// After a change the hub sends the coalesced stateless frame `{t:'runs', seq}`
// on `maude.files`; studios pull `GET runs?after=`. Old studios drop the
// unknown `t`. Also here: the awareness `holding` rule (§5.3 A10).

import { connectionClaimDecides } from './access-files.mjs';
import { documentMap, FILES_CTL_DOC } from './files-ctl.mjs';
import { matchesScope } from './tokens.mjs';

/** The `/health` capability a v2 studio looks for before it leases on this hub. */
export const RUNS_CAPABILITY = 'runs-v1';

export const RUNS_ROUTE =
  /^\/api\/projects\/([A-Za-z0-9._-]{1,128})\/v1\/runs(?:\/([A-Za-z0-9_-]{1,128})(?:\/(claim|end))?)?$/;

/** 200 keys + 200 element refs fit far inside this. */
export const RUNS_BODY_BYTES = 256 * 1024;
export const RUNS_POKE_COALESCE_MS = 100;

const STATUS = { invalid: 400, forbidden: 403, ended: 409, capacity: 429 };

/**
 * The runs poke: `{t:'runs', seq}` on the control document, coalesced to the
 * latest seq. Payload-free in the files-ctl sense — a receiver re-reads
 * `GET runs` and believes that. Project sessions hear every one; a canvas-only
 * connection only when the change touched a canvas its grants see
 * (`visibility.runsVisible`, V2-1.16 L3 — scoped like the votes poke). No
 * visibility wired, or a change whose canvases are unknown (a lapse found by
 * the store's own sweep) ⇒ such a connection hears nothing. Never throws.
 */
export function createRunsPoke({
  instance,
  visibility = null,
  coalesceMs = RUNS_POKE_COALESCE_MS,
  log = console,
  setTimeoutImpl = setTimeout,
}) {
  let timer = null;
  let pending = 0;
  let sentSeq = 0;
  let sent = 0;
  let canvases = new Set();
  const emit = () => {
    timer = null;
    const seq = pending;
    const touched = canvases;
    canvases = new Set();
    const doc = documentMap(instance)?.get(FILES_CTL_DOC);
    if (!doc) return;
    const frame = JSON.stringify({ t: 'runs', seq });
    try {
      let connections = [];
      try {
        connections = doc.getConnections?.() ?? [];
      } catch {
        connections = [];
      }
      doc.broadcastStateless(frame, (c) => !connectionClaimDecides(c));
      for (const c of connections) {
        if (!connectionClaimDecides(c) || !visibility) continue;
        if ([...touched].some((canvas) => visibility.runsVisible(c, canvas))) {
          c.sendStateless(frame);
        }
      }
      sentSeq = seq;
      sent += 1;
    } catch (err) {
      log.error?.(`[runs] poke broadcast failed: ${err.message}`);
    }
  };
  return {
    /** `touched`: the design-root-relative canvas paths the change named. */
    schedule(seq, touched = []) {
      if (!Number.isSafeInteger(seq) || seq <= sentSeq) return;
      for (const c of touched) if (typeof c === 'string' && c) canvases.add(c);
      if (seq > pending) pending = seq;
      if (timer !== null) return;
      timer = setTimeoutImpl(emit, coalesceMs);
      timer?.unref?.();
    },
    flushNow() {
      if (timer !== null) clearTimeout(timer);
      emit();
    },
    sent: () => sent,
  };
}

/**
 * Awareness (A10): a person's `holding` is advisory, but it must be honest.
 * A read-only connection holds nothing (`holding` and `editing` are dropped);
 * on every other one, `holding.actor` is the bearer's identity — whatever the
 * client claimed is overwritten. Mutates `states` in place, which is what the
 * re-encode downstream sees.
 *
 * @returns {number} how many states were changed (tests + logging)
 */
// S2.18 — the hub rebuilds a hold from its known keys and drops one that is not small and well-typed,
// so a peer can't fan an oversized or odd-shaped `holding` out to everyone in the room. The id grammar
// itself is the studio's (`sanitizeHoldingState`, use-collab.tsx); here: types and sizes only.
const HOLD_STR_MAX = 128;
const HOLD_PRINT_MAX = 512;
function holdOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { artboard, element, print, at } = raw;
  const okStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!okStr(artboard, HOLD_STR_MAX) || !okStr(element, HOLD_STR_MAX)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (print !== undefined && !okStr(print, HOLD_PRINT_MAX)) return null;
  return print === undefined ? { artboard, element, at } : { artboard, element, print, at };
}

export function sanitizeHoldingAwareness({ context, connection, states }) {
  if (!states || typeof states.forEach !== 'function') return 0;
  const user = context?.user;
  // Server-side state (no connection) is the hub's own; leave it.
  if (!user && !connection) return 0;
  const actor = user ? (user.actor ?? user.email ?? user.name ?? null) : null;
  const strip = !user || user.readOnly === true || !actor;
  let n = 0;
  for (const [id, state] of [...states.entries()]) {
    if (!state || typeof state !== 'object') continue;
    if (!('holding' in state) && !('editing' in state)) continue;
    const { holding, editing, ...rest } = state;
    let next = rest;
    if (!strip) {
      // only a small, well-typed hold crosses (S2.18); anything else is dropped like a non-object
      const hold = holdOf(holding);
      if (hold) {
        next = { ...rest, holding: { ...hold, actor: String(actor).slice(0, 200) } };
      } else if (holding === null) {
        next = { ...rest, holding: null };
      }
      if (editing !== undefined) next.editing = editing;
    }
    states.set(id, next);
    n += 1;
  }
  return n;
}

/**
 * @param {object} deps
 * @param {object} deps.store   the project store (runs* methods)
 * @param {(canvas: string) => Promise<string|null>} [deps.docNameFor]
 *   a lease key's `canvas` (an entry, or `path:<repoRel>`) or an ElementRef's
 *   canvas path → the document name scopes are written against; null = unknown.
 * @param {(canvas: string) => Promise<string|null>} [deps.canvasPathFor]
 *   a key's `canvas` → its design-root-relative canvas path (the scoped poke's
 *   target); null = unknown, which no canvas-only connection hears.
 * @param {{ schedule: (seq: number, canvases?: string[]) => void } | null} [deps.poke]
 */
export function createRunsRoutes({
  store,
  docNameFor = async () => null,
  canvasPathFor = async () => null,
  poke = null,
}) {
  const scoped = (who) => typeof who?.scope === 'string' && who.scope !== '*' && who.scope !== '';

  // One answer per canvas per request (`who` is minted per request): a GET of
  // many runs over a cell's store is one lookup per distinct canvas, not per key.
  const verdicts = new WeakMap();

  /** Fail closed: a key whose document cannot be named is outside every scope. */
  async function inScope(who, canvas) {
    if (!scoped(who)) return true;
    let memo = verdicts.get(who);
    if (!memo) {
      memo = new Map();
      verdicts.set(who, memo);
    }
    if (!memo.has(canvas)) {
      const name = await docNameFor(canvas);
      memo.set(
        canvas,
        typeof name === 'string' && name.length > 0 && matchesScope(who.scope, name)
      );
    }
    return memo.get(canvas);
  }

  async function allInScope(who, keys) {
    if (!scoped(who)) return true;
    if (!Array.isArray(keys)) return true; // the store refuses the shape
    for (const k of keys) {
      if (!(await inScope(who, typeof k?.canvas === 'string' ? k.canvas : ''))) return false;
    }
    return true;
  }

  /** A run as a scoped member may see it: only their canvases; null when none is. */
  async function projectRun(who, run) {
    if (!scoped(who)) return run;
    const ok = (canvas) => inScope(who, canvas);
    const keep = async (list) => {
      const out = [];
      for (const k of list ?? []) if (await ok(k.canvas)) out.push(k);
      return out;
    };
    const artboards = await keep(run.artboards);
    const waitingFor = await keep(run.waitingFor);
    if (!artboards.length && !waitingFor.length) return null;
    return { ...run, artboards, waitingFor, objects: await keep(run.objects) };
  }

  async function projectBusy(who, busy) {
    const out = [];
    for (const b of busy ?? []) {
      out.push(b.heldBy ? { ...b, heldBy: await projectRun(who, b.heldBy) } : b);
    }
    return out;
  }

  function refusal(respondJson, r) {
    const status = STATUS[r.refused] ?? 409;
    respondJson(status, {
      code: r.refused,
      ...(r.reason ? { error: r.reason } : {}),
      ...(r.outcome ? { outcome: r.outcome } : {}),
    });
    return true;
  }

  /** Every canvas key a store answer (and the request's own keys) names. */
  function keysOf(r, asked) {
    const out = new Set();
    const add = (list) => {
      for (const k of Array.isArray(list) ? list : []) {
        if (typeof k?.canvas === 'string' && k.canvas) out.add(k.canvas);
      }
    };
    const addRun = (run) => {
      if (!run || typeof run !== 'object') return;
      add(run.artboards);
      add(run.waitingFor);
      add(run.objects);
    };
    add(asked);
    addRun(r?.run);
    add(r?.granted);
    for (const b of Array.isArray(r?.busy) ? r.busy : []) {
      if (typeof b?.canvas === 'string') out.add(b.canvas);
      addRun(b?.heldBy);
    }
    for (const e of Array.isArray(r?.runs) ? r.runs : []) addRun(e?.run);
    if (Array.isArray(r?.ended)) add(r.ended);
    else addRun(r?.ended);
    return [...out];
  }

  const noted = async (r, asked = []) => {
    if (r && Number.isSafeInteger(r.seq) && poke) {
      const paths = [];
      for (const key of keysOf(r, asked)) {
        const p = await canvasPathFor(key).catch(() => null);
        if (typeof p === 'string' && p) paths.push(p);
      }
      poke.schedule(r.seq, paths);
    }
    return r;
  };

  async function body(request, readBody) {
    try {
      const v = JSON.parse(await readBody(request, RUNS_BODY_BYTES));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (err) {
      if (err?.status === 413) throw err;
      return null;
    }
  }

  /**
   * Handle a matched `RUNS_ROUTE` request whose bearer is already resolved.
   * `sub` is `renew` or a run id; `verb` is `claim` / `end` / undefined.
   */
  async function handle({ sub, verb, method, query, request, who, respondJson, readBody }) {
    if (!sub && method === 'GET') {
      const after = Number.parseInt(query?.after ?? '', 10);
      const r = await store.runsList(Number.isSafeInteger(after) ? { after } : {});
      if (r.unchanged) {
        respondJson(200, { seq: r.seq, unchanged: true });
        return true;
      }
      const runs = [];
      for (const run of r.runs ?? []) {
        const p = await projectRun(who, run);
        if (p) runs.push(p);
      }
      respondJson(200, { seq: r.seq, runs });
      return true;
    }
    if (method !== 'POST' || (sub === 'renew' && verb) || (sub && sub !== 'renew' && !verb)) {
      respondJson(405, { code: 'method-not-allowed' });
      return true;
    }
    // Every write needs edit (C30, rule 12): Can comment / Can view have no AI.
    if (who.readOnly) {
      respondJson(403, { code: 'forbidden', error: 'this account can view but not edit' });
      return true;
    }
    const b = await body(request, readBody);
    if (!b) {
      respondJson(400, { code: 'invalid', error: 'a JSON object body is required' });
      return true;
    }

    if (!sub) {
      if (!(await allInScope(who, b.wants))) {
        respondJson(403, { code: 'forbidden', error: 'an artboard outside your canvases' });
        return true;
      }
      const r = await noted(
        await store.runsBegin({
          runId: b.runId,
          actor: who.actor,
          device: b.device,
          askId: b.askId ?? null,
          chatId: b.chatId ?? null,
          origin: b.origin,
          label: b.label ?? '',
          wants: b.wants ?? [],
          enqueue: b.enqueue === true,
        }),
        b.wants
      );
      if (r.refused) return refusal(respondJson, r);
      respondJson(200, {
        run: (await projectRun(who, r.run)) ?? { ...r.run, artboards: [], waitingFor: [] },
        granted: r.granted,
        busy: await projectBusy(who, r.busy),
        seq: r.seq,
      });
      return true;
    }

    if (sub === 'renew') {
      let runs = b.runs;
      if (scoped(who) && Array.isArray(runs)) {
        // Objects outside the member's canvases are not theirs to announce.
        runs = [];
        for (const e of b.runs) {
          if (!e || typeof e !== 'object' || !Array.isArray(e.objects)) {
            runs.push(e);
            continue;
          }
          const objects = [];
          for (const o of e.objects) {
            if (await inScope(who, typeof o?.canvas === 'string' ? o.canvas : '')) objects.push(o);
          }
          runs.push({ ...e, objects });
        }
      }
      const r = await noted(
        await store.runsRenew({ actor: who.actor, device: b.device, runs }),
        (Array.isArray(runs) ? runs : []).flatMap((e) =>
          Array.isArray(e?.objects) ? e.objects : []
        )
      );
      if (r.refused) return refusal(respondJson, r);
      const out = [];
      for (const e of r.runs) {
        out.push(e.run ? { run: (await projectRun(who, e.run)) ?? e.run } : e);
      }
      respondJson(200, { runs: out, seq: r.seq });
      return true;
    }

    if (verb === 'claim') {
      if (!(await allInScope(who, b.keys))) {
        respondJson(403, { code: 'forbidden', error: 'an artboard outside your canvases' });
        return true;
      }
      const r = await noted(
        await store.runsClaim({
          runId: sub,
          actor: who.actor,
          keys: b.keys ?? [],
          enqueue: b.enqueue === true,
          expectFence: b.expectFence ?? undefined,
        }),
        b.keys
      );
      if (r.refused) return refusal(respondJson, r);
      respondJson(200, {
        granted: r.granted,
        busy: await projectBusy(who, r.busy),
        seq: r.seq,
      });
      return true;
    }

    // verb === 'end'
    const r = await noted(
      await store.runsEnd({ runId: sub, actor: who.actor, outcome: b.outcome })
    );
    if (r.refused) return refusal(respondJson, r);
    const granted = [];
    for (const g of r.granted ?? []) if (await inScope(who, g.canvas)) granted.push(g);
    respondJson(200, { ended: r.ended, granted, seq: r.seq });
    return true;
  }

  return { handle };
}
