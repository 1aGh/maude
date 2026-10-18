// runs.ts — the studio's AI run registry (V2-1.15 §5.4–5.6, §5.9). One per project.
//
// THE one map of AI runs on this Mac. Everything that asks "is AI working?" reads it: the
// `/_api/ai/runs` routes, the hook routes (agent-runs.ts is a view of it), `runningChats()` /
// `activitySnapshot()` (acp/running.ts) and the v1 `ai-activity` banner, which it derives.
//
// - Records: `<designRoot>/_state/runs/<runId>.json`, written tmp + rename BEFORE any lease-home
//   call, so a crash between the two leaves a record the boot scan ends as `interrupted`.
// - Lease home (lease-home.ts): the hub (linked + `runs-v1`) or the in-process store.
// - Lifecycle: run-lifecycle.ts `reduceRun` decides; this file carries out the effects.
// - Renewal: one timer per project, every 10 s, one `renew` call for every live run. A hook run
//   with no hook event for 120 s is no longer renewed (Q4) and lapses on the home.
// - Hub unreachable (§5.6): a claim that misses its 250 ms budget is granted provisionally at the
//   last fence this registry saw; it is confirmed by CAS before anything is published.
//
// The hooks this registry calls (`turns`, `stage`) must never await a registry method: they run
// inside a transition, and the registry does not re-enter itself.

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { type Busy, type Granted, type LeaseHome, leaseKeyId } from './lease-home.ts';
import {
  ASK_ID_RE,
  cleanLabel,
  isLive,
  type LeaseKey,
  publicRun,
  RUN_ID_RE,
  type RunEffect,
  type RunEvent,
  type RunOrigin,
  type RunPublic,
  type RunRecord,
  type RunScope,
  type RunView,
  reduceRun,
  runView,
} from './run-lifecycle.ts';

export const RENEW_MS = 10_000;
export const HOOK_LAPSE_MS = 120_000;
export const CLAIM_BUDGET_MS = 250;
export const STOP_ALL_BUDGET_MS = 5_000;
export const TURN_SETTLE_MS = 2_000;
export const END_BUDGET_MS = 1_000;
export const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_RECORDS = 500;

export interface RunsView {
  seq: number;
  mine: RunView[];
  others: RunPublic[];
  needsYou: number;
  live: number;
}

export interface AskInput {
  askId?: string;
  chatId?: string | null;
  sessionId?: string | null;
  origin: RunOrigin;
  label?: string;
  prompt?: string;
  scope?: RunScope | null;
  resumeOf?: string;
  continuationOf?: string;
  copyOf?: LeaseKey;
  agent?: string;
  /** lease nothing up front: each edit claims what it reaches (terminal Claude, /design:edit) */
  lazy?: boolean;
}

export interface PublishResult {
  status: 'accepted' | 'rejected' | 'queued';
  code?: string;
}

export interface RegistryOptions {
  /** absolute design root; null = records in memory only (tests, a table built from stubs) */
  designRoot: string | null;
  /** `.design` — the v1 banner keys files `${designRel}/${canvas}` */
  designRel?: string;
  actor?: string;
  device?: string;
  home: LeaseHome;
  /** Diagnostics › AI setup line (Q2), from `selectLeaseHome` */
  diagnostics?: string | null;
  now?: () => number;
  /** false = no renew timer (tests drive `renewNow`) */
  autoRenew?: boolean;
  /** the lease key's canvas for a designRoot-relative path (the kernel entry once it has one) */
  canvasKey?: (rel: string) => string;
  /** the artboard ids of a canvas, for a whole-canvas ask */
  artboardsOf?: (rel: string) => string[];
  /** the agent turn (ACP, S5.6). `text` = a generated continuation turn, else the ask's prompt */
  turns?: {
    send?(rec: RunRecord, text: string | null): void | Promise<void>;
    cancel?(rec: RunRecord): void | Promise<void>;
  };
  /** the run's V2-1.5 stage (S5.5) */
  stage?: {
    publish?(
      rec: RunRecord,
      o: {
        partial: boolean;
        fence: { runId: string; leases: Array<{ entry: string; artboard: string; token: number }> };
      }
    ): PublishResult | undefined | Promise<PublishResult | undefined>;
    hold?(rec: RunRecord): void | Promise<void>;
  };
  /** ctx.bus.emit — `ai:runs {seq}` and the derived v1 `ai-activity` */
  emit?: (event: string, payload: unknown) => void;
}

const newId = (p: 'r' | 'a') => `${p}_${randomBytes(6).toString('hex')}`;

const withTimeout = <T>(p: Promise<T> | T, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise<T>((r) => setTimeout(() => r(fallback), ms).unref?.()),
  ]);

const sameKey = (a: LeaseKey, b: LeaseKey) => a.canvas === b.canvas && a.artboard === b.artboard;

export type RunRegistry = ReturnType<typeof createRunRegistry>;

export function createRunRegistry(opts: RegistryOptions) {
  const now = opts.now ?? Date.now;
  const actor = opts.actor ?? 'you';
  const device = opts.device ?? 'studio';
  const designRel = opts.designRel ?? '.design';
  const canvasKey = opts.canvasKey ?? ((rel: string) => `path:${path.posix.join(designRel, rel)}`);
  const dir = opts.designRoot ? path.join(opts.designRoot, '_state', 'runs') : null;
  let home = opts.home;
  let diagnostics = opts.diagnostics ?? null;

  const records = new Map<string, RunRecord>();
  let others: RunPublic[] = [];
  let homeSeq: number | undefined;
  let seq = 0;
  /** the last fence this registry saw per key (§5.6 provisional claims) */
  const lastFence = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const bannerFiles = new Set<string>();

  // ── persistence ───────────────────────────────────────────────────────────────────────────

  function persist(rec: RunRecord) {
    records.set(rec.runId, rec);
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${rec.runId}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec));
    renameSync(tmp, file);
  }

  function loadAll(): RunRecord[] {
    if (!dir) return [];
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const out: RunRecord[] = [];
    for (const n of names) {
      const m = /^(r_[A-Za-z0-9_-]{6,64})\.json$/.exec(n);
      if (!m) {
        if (n.endsWith('.tmp')) safeUnlink(path.join(dir, n));
        continue;
      }
      try {
        const rec = JSON.parse(readFileSync(path.join(dir, n), 'utf8')) as RunRecord;
        if (rec?.v === 1 && rec.runId === m[1]) out.push(rec);
      } catch {
        /* a torn or foreign file is not a run */
      }
    }
    return out;
  }

  function safeUnlink(file: string) {
    try {
      unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  /** Ended records: 30 days, except each chat's latest; never more than 500 files. */
  function prune() {
    const t = now();
    const latest = new Map<string, RunRecord>();
    for (const r of records.values())
      if (r.chatId && (latest.get(r.chatId)?.createdAt ?? -1) < r.createdAt)
        latest.set(r.chatId, r);
    const keep = (r: RunRecord) => isLive(r) || (r.chatId !== null && latest.get(r.chatId) === r);
    const drop = (r: RunRecord) => {
      records.delete(r.runId);
      if (dir) safeUnlink(path.join(dir, `${r.runId}.json`));
    };
    for (const r of [...records.values()])
      if (!keep(r) && (r.endedAt ?? r.createdAt) < t - RETAIN_MS) drop(r);
    if (records.size > MAX_RECORDS) {
      const old = [...records.values()]
        .filter((r) => !keep(r))
        .sort((a, b) => (a.endedAt ?? a.createdAt) - (b.endedAt ?? b.createdAt));
      for (const r of old.slice(0, records.size - MAX_RECORDS)) drop(r);
    }
  }

  // ── change feed ───────────────────────────────────────────────────────────────────────────

  function changed() {
    seq += 1;
    opts.emit?.('ai:runs', { seq });
    deriveBanner();
  }

  /** The v1 `ai-activity` banner, derived from hook-driven runs (`/design:edit`, terminal Claude). */
  function bannerEntries() {
    const out = new Map<
      string,
      { file: string; author: string; startedAt: number; lastHeartbeat: number }
    >();
    for (const r of records.values()) {
      if (!isLive(r) || r.origin === 'maude-chat' || r.state === 'waiting') continue;
      const canvases = new Set(Object.keys(r.touched));
      if (r.scope?.canvas) canvases.add(r.scope.canvas);
      for (const c of canvases) {
        const file = path.posix.join(designRel, c);
        out.set(file, {
          file,
          author: r.agent ?? 'Claude Code',
          startedAt: r.startedAt ?? r.createdAt,
          lastHeartbeat: r.hookAt ?? r.startedAt ?? r.createdAt,
        });
      }
    }
    return out;
  }

  function deriveBanner() {
    if (!opts.emit) return;
    const now2 = bannerEntries();
    for (const [file, entry] of now2) {
      bannerFiles.add(file);
      opts.emit('ai-activity', { file, entry });
    }
    for (const file of [...bannerFiles])
      if (!now2.has(file)) {
        bannerFiles.delete(file);
        opts.emit('ai-activity', { file, entry: null });
      }
  }

  // ── keys ──────────────────────────────────────────────────────────────────────────────────

  function wantsOf(scope: RunScope | null | undefined): LeaseKey[] {
    if (!scope?.canvas) return [];
    const ids =
      scope.artboards === '*' ? (opts.artboardsOf?.(scope.canvas) ?? []) : scope.artboards;
    const canvas = canvasKey(scope.canvas);
    return [...new Set(ids)].map((artboard) => ({ canvas, artboard }));
  }

  const hid = (rec: RunRecord) => rec.homeRunId ?? rec.runId;
  const mineLive = (runId: string) => {
    const r = records.get(runId);
    return r && isLive(r) ? r : null;
  };

  function noteTokens(list: Granted[]) {
    for (const g of list) lastFence.set(leaseKeyId(g), g.token);
  }

  function setLeases(rec: RunRecord, granted: Granted[], provisional = false): RunRecord {
    const leases = [...rec.leases];
    for (const g of granted) {
      const at = leases.findIndex((l) => sameKey(l, g));
      const lease = {
        canvas: g.canvas,
        artboard: g.artboard,
        token: g.token,
        ...(provisional ? { provisional: true as const } : {}),
      };
      if (at >= 0) leases[at] = lease;
      else leases.push(lease);
    }
    const waiting = rec.waiting.filter((w) => !granted.some((g) => sameKey(g, w)));
    return { ...rec, leases, waiting };
  }

  function setWaiting(rec: RunRecord, busy: Busy[]): RunRecord {
    const waiting = busy
      .filter((b) => b.position !== null)
      .map((b) => ({
        canvas: b.canvas,
        artboard: b.artboard,
        position: b.position as number,
        heldBy: b.heldBy ?? null,
      }));
    return { ...rec, waiting };
  }

  // ── transitions ───────────────────────────────────────────────────────────────────────────

  /** Apply one §5.5 event and carry out its effects. Refused events are no-ops. */
  /** The synchronous half of a transition: the record is next at once; `done` carries out the effects. */
  function transitionSync(
    runId: string,
    ev: RunEvent
  ): { rec: RunRecord; done: Promise<RunRecord> } | null {
    const prev = records.get(runId);
    if (!prev) return null;
    const r = reduceRun(prev, ev, now());
    if ('refused' in r) return null;
    persist(r.rec);
    changed();
    return { rec: r.rec, done: carryOut(prev, r.rec, r.effects) };
  }

  async function transition(runId: string, ev: RunEvent): Promise<RunRecord | null> {
    const t = transitionSync(runId, ev);
    return t ? t.done : null;
  }

  /** A hook's run/end: the run is ended now (the next hook call sees it); its effects follow. */
  function endNow(runId: string, outcome: 'done' | 'failed' | 'stopped'): RunRecord | null {
    const cur = records.get(runId);
    const ev: RunEvent =
      cur?.state === 'waiting'
        ? { type: 'cancel' }
        : outcome === 'done'
          ? { type: 'turn-end' }
          : outcome === 'failed'
            ? { type: 'fail' }
            : { type: 'stop', by: 'you' };
    const t = transitionSync(runId, ev);
    if (!t) return null;
    t.done.catch(() => null);
    return t.rec;
  }

  async function carryOut(prev: RunRecord, rec: RunRecord, effects: RunEffect[]) {
    let lost = false;
    for (const eff of effects) {
      if (lost && eff !== 'end-leases') continue;
      switch (eff) {
        case 'send-turn': {
          if (rec.origin !== 'maude-chat') break; // a hook run's turn is already in the terminal
          const text = rec.continuationOf ? continuationText(rec) : null;
          void Promise.resolve()
            .then(() => opts.turns?.send?.(rec, text))
            .catch(() => null);
          break;
        }
        case 'renew':
          queueMicrotask(() => void renewNow());
          break;
        case 'cancel-turn':
          await withTimeout(Promise.resolve(opts.turns?.cancel?.(prev)), TURN_SETTLE_MS, undefined);
          break;
        case 'confirm': {
          const ok = await confirmProvisional(prev);
          if (!ok) lost = true;
          break;
        }
        case 'publish':
        case 'publish-partial': {
          const fence = {
            runId: prev.runId,
            leases: prev.leases.map((l) => ({
              entry: l.canvas,
              artboard: l.artboard,
              token: l.token,
            })),
          };
          const res = await Promise.resolve(
            opts.stage?.publish?.(prev, { partial: eff === 'publish-partial', fence })
          ).catch(() => undefined);
          if (res?.code === 'lease-fenced') lost = true;
          break;
        }
        case 'hold':
          await Promise.resolve(opts.stage?.hold?.(prev)).catch(() => null);
          break;
        case 'end-leases':
          if (lost) {
            rec = { ...rec, outcome: 'lease-lost', stoppedBy: 'sleep' };
            persist(rec);
            await Promise.resolve(opts.stage?.hold?.(prev)).catch(() => null);
            changed();
          }
          await endOnHome(rec);
          break;
        case 'continuations':
          if (!lost) await continueBusy(prev);
          break;
      }
    }
    return rec;
  }

  function continuationText(rec: RunRecord) {
    const a = rec.scope && rec.scope.artboards !== '*' ? rec.scope.artboards[0] : null;
    return `${a ?? 'The artboard'} is free now — make the same change there.`;
  }

  /** `runsEnd` (best effort, 1 s), then hand the freed keys to their lines. */
  async function endOnHome(rec: RunRecord) {
    const ans = await withTimeout(home.end(hid(rec), rec.outcome ?? 'stopped'), END_BUDGET_MS, {
      refused: 'unreachable' as const,
    });
    if (!ans.refused) await applyGrants(ans.granted ?? []);
    await releaseChatLine(rec.chatId);
  }

  /** §5.6: every provisional lease is confirmed by CAS before a publish; false = lost. */
  async function confirmProvisional(rec: RunRecord): Promise<boolean> {
    const prov = rec.leases.filter((l) => l.provisional);
    if (!prov.length) return true;
    const expectFence: Record<string, number> = {};
    for (const l of prov) expectFence[leaseKeyId(l)] = l.token;
    const ans = await home.claim(hid(rec), {
      keys: prov.map(({ canvas, artboard }) => ({ canvas, artboard })),
      expectFence,
    });
    if (ans.refused) return false;
    if (ans.granted.length < prov.length) return false;
    noteTokens(ans.granted);
    const cur = records.get(rec.runId);
    if (cur) persist(setLeases(cur, ans.granted));
    // the fence the publish carries is the confirmed one
    for (const l of rec.leases) {
      const g = ans.granted.find((x) => sameKey(x, l));
      if (g) {
        l.token = g.token;
        delete l.provisional;
      }
    }
    return true;
  }

  /** At turn end: one continuation run per key this run could not get (§5.5 "Continuation"). */
  async function continueBusy(prev: RunRecord) {
    const keys: LeaseKey[] = [];
    for (const k of [...(prev.deferred ?? []), ...(prev.busyDenied ?? [])])
      if (!keys.some((x) => sameKey(x, k))) keys.push(k);
    if (!keys.length || !prev.scope) return;
    for (const k of keys)
      await ask({
        chatId: prev.chatId,
        sessionId: prev.sessionId,
        origin: prev.origin,
        label: prev.label,
        scope: { canvas: prev.scope.canvas, artboards: [k.artboard] },
        continuationOf: prev.runId,
        agent: prev.agent,
      });
  }

  /** Grants handed to a line (runsEnd / a pull): our waiting runs that now hold keys start. */
  async function applyGrants(granted: Array<Granted & { runId?: string }>) {
    noteTokens(granted);
    const byRun = new Map<string, Granted[]>();
    for (const g of granted) {
      const rid = g.runId;
      if (!rid) continue;
      const rec = [...records.values()].find((r) => hid(r) === rid && isLive(r));
      if (!rec) continue;
      byRun.set(rec.runId, [...(byRun.get(rec.runId) ?? []), g]);
    }
    for (const [runId, list] of byRun) {
      const rec = records.get(runId);
      if (!rec) continue;
      persist(setLeases(rec, list));
      if (rec.state === 'waiting') await transition(runId, { type: 'granted' });
      else changed();
    }
  }

  /** The chat-level line (§5.4): the next ask of this chat goes once its active run ended. */
  async function releaseChatLine(chatId: string | null) {
    if (!chatId) return;
    if ([...records.values()].some((r) => r.chatId === chatId && isLive(r) && !r.behind)) return;
    const next = [...records.values()]
      .filter((r) => r.chatId === chatId && isLive(r) && r.behind)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return;
    const rec = { ...next };
    delete rec.behind;
    persist(rec);
    await admit(rec);
  }

  // ── asking ────────────────────────────────────────────────────────────────────────────────

  /**
   * The synchronous half of an ask: mint (or find, by askId) the record and persist it. A chat
   * with a live run puts the new ask behind it (chat-level FIFO). Idempotent by `askId`.
   */
  function open(input: AskInput): { rec: RunRecord; fresh: boolean } {
    if (input.askId) {
      const prior = [...records.values()].find((r) => r.askId === input.askId);
      if (prior) return { rec: prior, fresh: false };
    }
    const askId = input.askId && ASK_ID_RE.test(input.askId) ? input.askId : newId('a');
    const chatId = input.chatId ?? null;
    const ahead = chatId
      ? [...records.values()].find((r) => r.chatId === chatId && isLive(r))
      : undefined;
    const rec: RunRecord = {
      v: 1,
      runId: newId('r'),
      askId,
      ...(input.resumeOf ? { resumeOf: input.resumeOf } : {}),
      ...(input.continuationOf ? { continuationOf: input.continuationOf } : {}),
      chatId,
      sessionId: input.sessionId ?? null,
      origin: input.origin,
      actor,
      device,
      label: cleanLabel(input.label),
      ...(input.prompt ? { prompt: input.prompt } : {}),
      scope: input.scope ?? null,
      ...(input.copyOf ? { copyOf: input.copyOf } : {}),
      state: 'waiting',
      leases: [],
      waiting: [],
      touched: {},
      objects: [],
      createdAt: now(),
      ...(ahead ? { behind: ahead.runId } : {}),
      ...(input.origin !== 'maude-chat' ? { hookAt: now() } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    };
    persist(rec);
    changed();
    return { rec, fresh: true };
  }

  /** Begin on the lease home: lease what is free, line up for the rest (§5.5 row 1). */
  async function admit(rec0: RunRecord, o: { lazy?: boolean } = {}): Promise<RunRecord> {
    const wants = o.lazy ? [] : wantsOf(rec0.scope);
    if (!wants.length) {
      // lazy (terminal Claude, a selection-less /design:edit): it starts at once and leases what
      // each edit reaches. The home learns of it in the background (renewal needs the row).
      const s = transitionSync(rec0.runId, { type: 'granted' });
      if (s && rec0.origin !== 'maude-chat') transitionSync(rec0.runId, { type: 'accepted' });
      void home
        .begin({
          runId: rec0.runId,
          askId: rec0.askId,
          chatId: rec0.chatId,
          origin: rec0.origin,
          label: rec0.label,
          device,
          wants: [],
          enqueue: false,
        })
        .catch(() => null);
      return records.get(rec0.runId) ?? rec0;
    }
    const multi = wants.length > 1;
    const ans = await home.begin({
      runId: rec0.runId,
      askId: rec0.askId,
      chatId: rec0.chatId,
      origin: rec0.origin,
      label: rec0.label,
      device,
      wants,
      enqueue: !multi,
    });
    let rec = records.get(rec0.runId) ?? rec0;
    if (!isLive(rec)) return rec;
    if (ans.refused === 'unreachable') {
      // §5.6: the hub is away — lease locally, provisionally, at the last fence seen
      const prov = wants.map((k) => ({ ...k, token: lastFence.get(leaseKeyId(k)) ?? 0 }));
      persist(setLeases(rec, prov, true));
      return (await startIfReady(rec0.runId, true)) ?? rec;
    }
    if (ans.refused) {
      persist({ ...rec, state: 'ended', outcome: 'failed', endedAt: now(), waiting: [] });
      changed();
      return records.get(rec0.runId) as RunRecord;
    }
    noteTokens(ans.granted);
    rec = setWaiting(setLeases(rec, ans.granted), ans.busy);
    if (multi && ans.granted.length) {
      rec.deferred = ans.busy.map(({ canvas, artboard }) => ({ canvas, artboard }));
    }
    persist(rec);
    if (multi && !ans.granted.length) {
      // nothing free: join every line (one run; it starts on the first grant)
      const c = await home.claim(hid(rec), { keys: wants, enqueue: true });
      rec = records.get(rec0.runId) ?? rec;
      if (!c.refused) {
        noteTokens(c.granted);
        rec = setWaiting(setLeases(rec, c.granted), c.busy);
        persist(rec);
      }
    }
    return (await startIfReady(rec0.runId, false)) ?? rec;
  }

  async function startIfReady(runId: string, provisional: boolean) {
    const rec = records.get(runId);
    if (!rec || rec.state !== 'waiting') return rec;
    const wants = wantsOf(rec.scope);
    const ready = !wants.length || provisional || rec.leases.length > 0;
    if (!ready) {
      changed();
      return rec;
    }
    const started = await transition(runId, { type: 'granted' });
    // a hook-driven run's turn is already running in the terminal
    if (started && rec.origin !== 'maude-chat')
      return await transition(runId, { type: 'accepted' });
    return started;
  }

  /** Ask: the record now, the lease home after. Resolves with the record once admitted. */
  async function ask(input: AskInput): Promise<RunRecord> {
    const { rec, fresh } = open(input);
    if (!fresh || rec.behind) return rec;
    return admit(rec, { lazy: input.lazy === true });
  }

  // ── mid-run claims (the hook path; S5.4 awaits these) ─────────────────────────────────────

  /**
   * Claim more artboards for a live run — synchronously reserved (so the next hook call in this
   * process already sees them held), then settled on the home. Within the 250 ms budget the home
   * decides: granted keys get their token, busy keys are dropped and remembered as `busyDenied`
   * (the end of the turn continues them). Past the budget the reservation stays provisional at
   * the last fence seen and is confirmed by CAS before any publish (§5.6).
   */
  function reserve(runId: string, keys: LeaseKey[]): LeaseKey[] {
    const rec = mineLive(runId);
    if (!rec) return [];
    const need = keys.filter((k) => !rec.leases.some((l) => sameKey(l, k)));
    if (!need.length) return [];
    const prov = need.map((k) => ({ ...k, token: lastFence.get(leaseKeyId(k)) ?? 0 }));
    persist(setLeases(rec, prov, true));
    changed();
    return need;
  }

  async function settle(runId: string, need: LeaseKey[]) {
    const rec = mineLive(runId);
    if (!rec || !need.length) return { granted: [] as Granted[], busy: [] as Busy[] };
    const ans = await home.claim(hid(rec), { keys: need }, CLAIM_BUDGET_MS);
    const cur = mineLive(runId);
    if (!cur) return { granted: [] as Granted[], busy: [] as Busy[] };
    if (ans.refused === 'unreachable')
      return { granted: [] as Granted[], busy: [] as Busy[], provisional: true };
    const drop = (r: RunRecord, keys: LeaseKey[]) => ({
      ...r,
      leases: r.leases.filter((l) => !(l.provisional && keys.some((k) => sameKey(k, l)))),
    });
    if (ans.refused) {
      persist(drop(cur, need));
      changed();
      return { granted: [] as Granted[], busy: [] as Busy[], refused: ans.refused };
    }
    noteTokens(ans.granted);
    let next = setLeases(drop(cur, need), ans.granted);
    if (ans.busy.length) {
      const denied = [...(next.busyDenied ?? [])];
      for (const b of ans.busy)
        if (!denied.some((d) => sameKey(d, b)))
          denied.push({ canvas: b.canvas, artboard: b.artboard });
      next = { ...next, busyDenied: denied };
    }
    persist(next);
    changed();
    return { granted: ans.granted, busy: ans.busy };
  }

  async function claim(runId: string, keys: LeaseKey[]) {
    return settle(runId, reserve(runId, keys));
  }

  /** Remember an artboard an edit was denied as busy: the end of the turn continues it. */
  function noteBusy(runId: string, key: LeaseKey) {
    const rec = mineLive(runId);
    if (!rec || (rec.busyDenied ?? []).some((d) => sameKey(d, key))) return;
    persist({ ...rec, busyDenied: [...(rec.busyDenied ?? []), key] });
  }

  /** The holder of a key, as anyone sees it — a run of mine or a member's (others' cache). */
  function holderOf(key: LeaseKey, exceptRunId?: string): RunPublic | null {
    for (const r of records.values())
      if (isLive(r) && r.runId !== exceptRunId && r.leases.some((l) => sameKey(l, key)))
        return publicRun(r);
    for (const o of others)
      if (o.runId !== exceptRunId && o.artboards.some((a) => sameKey(a, key))) return o;
    return null;
  }

  // ── renewal (§5.4) and the lapse re-claim (§5.9.4) ────────────────────────────────────────

  let renewing: Promise<void> | null = null;
  function renewNow(): Promise<void> {
    if (renewing) return renewing;
    renewing = (async () => {
      try {
        const t = now();
        const live = [...records.values()].filter(
          (r) =>
            isLive(r) &&
            !r.behind &&
            (r.origin === 'maude-chat' || t - (r.hookAt ?? r.createdAt) < HOOK_LAPSE_MS)
        );
        if (live.length) {
          const ans = await home.renew({
            device,
            runs: live.map((r) => ({
              runId: hid(r),
              ...(r.state === 'running' || r.state === 'needs-you' ? { state: r.state } : {}),
              objects: r.objects,
            })),
          });
          if (!ans.refused)
            for (const e of ans.runs)
              if ('ended' in e) {
                const rec = live.find((r) => hid(r) === e.runId);
                if (rec) await reclaim(rec);
              }
        }
        await pull();
      } finally {
        renewing = null;
      }
    })();
    return renewing;
  }

  /**
   * The home ended a run this Mac still has live (lapsed while asleep / hook-quiet). Re-claim
   * every key at its old token: a CAS — ok means nobody took it, so keep going silently;
   * otherwise `lease-lost`. The old home run is ended, so the claim goes on a fresh home run id.
   */
  async function reclaim(rec: RunRecord) {
    if (!rec.leases.length) {
      if (rec.state === 'waiting') await transition(rec.runId, { type: 'lease-lost' });
      return;
    }
    const fresh = newId('r');
    const begun = await home.begin({
      runId: fresh,
      askId: rec.askId,
      chatId: rec.chatId,
      origin: rec.origin,
      label: rec.label,
      device,
      wants: [],
      enqueue: false,
    });
    if (begun.refused) {
      if (begun.refused !== 'unreachable') await transition(rec.runId, { type: 'lease-lost' });
      return;
    }
    const expectFence: Record<string, number> = {};
    for (const l of rec.leases) expectFence[leaseKeyId(l)] = l.token;
    const keys = rec.leases.map(({ canvas, artboard }) => ({ canvas, artboard }));
    const c = await home.claim(fresh, { keys, expectFence });
    const cur = records.get(rec.runId);
    if (!cur || !isLive(cur)) return;
    if (!c.refused && c.granted.length === keys.length) {
      noteTokens(c.granted);
      persist({ ...setLeases(cur, c.granted), homeRunId: fresh });
      return;
    }
    persist({ ...cur, homeRunId: fresh });
    await transition(rec.runId, { type: 'lease-lost' });
  }

  /** Pull the members' runs (`GET runs?after=`); a waiting run of ours the home granted starts. */
  async function pull() {
    const ans = await home.list(homeSeq);
    if (ans.refused || ans.unchanged) return;
    homeSeq = ans.seq;
    const mine = new Set([...records.values()].map(hid));
    const next = (ans.runs ?? []).filter((r) => !mine.has(r.runId));
    const differs = JSON.stringify(next) !== JSON.stringify(others);
    others = next;
    // a waiting run of ours the home granted while we did not hear it (another Mac's end)
    for (const r of ans.runs ?? []) {
      if (!mine.has(r.runId) || !r.artboards.length) continue;
      const rec = [...records.values()].find((x) => hid(x) === r.runId);
      if (rec?.state === 'waiting') {
        const c = await home.claim(hid(rec), { keys: r.artboards });
        if (!c.refused) await applyGrants(c.granted.map((g) => ({ ...g, runId: hid(rec) })));
      }
    }
    if (differs) changed();
  }

  // ── what the shell does ───────────────────────────────────────────────────────────────────

  async function stop(runId: string, by: 'you' | 'quit' | 'close-tab' = 'you') {
    return transition(runId, { type: 'stop', by });
  }

  async function cancel(runId: string) {
    const r = mineLive(runId);
    if (!r || r.state !== 'waiting') return null;
    return transition(runId, { type: 'cancel' });
  }

  /** Keep going: a new ask on the same scope, `resumeOf` the ended run. It waits if busy (R12). */
  async function keepGoing(runId: string) {
    const r = records.get(runId);
    if (!r || isLive(r)) return null;
    return ask({
      chatId: r.chatId,
      sessionId: r.sessionId,
      origin: r.origin,
      label: r.label,
      scope: r.scope,
      resumeOf: r.runId,
      agent: r.agent,
    });
  }

  /** Quit / close tab (§5.9.2): every live run stops in parallel; 5 s in all. */
  async function stopAll(reason: 'quit' | 'close-tab') {
    const live = [...records.values()].filter(isLive);
    let published = 0;
    const one = async (r: RunRecord) => {
      const started = r.state !== 'waiting';
      const out = await stop(r.runId, reason);
      if (out && started && out.outcome === 'stopped') published += 1;
    };
    await withTimeout(Promise.all(live.map(one)), STOP_ALL_BUDGET_MS, []);
    return { stopped: live.length, published };
  }

  // ── boot ──────────────────────────────────────────────────────────────────────────────────

  /** Load records; every live one was cut off by a crash → `interrupted` (§5.9.3). */
  async function boot() {
    for (const rec of loadAll()) records.set(rec.runId, rec);
    const live = [...records.values()].filter(isLive);
    for (const r of live) await transition(r.runId, { type: 'crash' });
    prune();
    if (opts.autoRenew !== false && !timer) {
      timer = setInterval(() => void renewNow(), RENEW_MS);
      timer.unref?.();
    }
    return { interrupted: live.map((r) => r.runId) };
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    home.close?.();
  }

  function view(): RunsView {
    const mine = [...records.values()].sort((a, b) => a.createdAt - b.createdAt);
    const live = mine.filter(isLive);
    return {
      seq,
      mine: mine.map(runView),
      others,
      needsYou: live.filter((r) => r.state === 'needs-you').length,
      live: live.length,
    };
  }

  return {
    // asking + lifecycle
    open,
    ask,
    admit,
    claim,
    reserve,
    settle,
    noteBusy,
    started: (runId: string) => transition(runId, { type: 'accepted' }),
    needsYou: (runId: string, question: string) =>
      transition(runId, { type: 'ask-permission', question }),
    answered: (runId: string) => transition(runId, { type: 'answered' }),
    turnEnded: (runId: string, outcome: 'done' | 'failed') =>
      transition(runId, { type: outcome === 'done' ? 'turn-end' : 'fail' }),
    stop,
    cancel,
    keepGoing,
    stopAll,
    // records
    get: (runId: string) => records.get(runId) ?? null,
    /** the live run a hook event belongs to: the chat's run, else the session's */
    resolve(b: { chat?: string | null; session?: string | null }): RunRecord | null {
      const live = [...records.values()].filter((r) => isLive(r) && !r.behind);
      if (b.chat) {
        const c = live.find((r) => r.chatId === b.chat);
        if (c) return c;
      }
      return b.session ? (live.find((r) => r.sessionId === b.session) ?? null) : null;
    },
    /** a hook event on a run: bind its session, refresh its 120 s window */
    endNow,
    hookEvent(
      runId: string,
      patch: { sessionId?: string; touched?: [string, string[]]; scope?: RunScope | null }
    ) {
      const r0 = mineLive(runId);
      if (!r0) return null;
      const r = patch.scope !== undefined ? { ...r0, scope: patch.scope } : r0;
      const touched = { ...r.touched };
      if (patch.touched) {
        const [canvas, ids] = patch.touched;
        touched[canvas] = [...new Set([...(touched[canvas] ?? []), ...ids])];
      }
      const next = {
        ...r,
        touched,
        hookAt: now(),
        ...(patch.sessionId && !r.sessionId ? { sessionId: patch.sessionId } : {}),
      };
      persist(next);
      changed();
      return next;
    },
    holderOf,
    live: () => [...records.values()].filter(isLive),
    bannerEntries: () => [...bannerEntries().values()],
    // the home
    view,
    renewNow,
    pull,
    poke: (homeSeqNow: number) => {
      if (homeSeqNow !== homeSeq) void pull();
    },
    setHome(next: LeaseHome, line: string | null = null) {
      home.close?.();
      home = next;
      diagnostics = line;
      others = [];
      homeSeq = undefined;
    },
    diagnostics: () => ({ leaseHome: home.kind, line: diagnostics }),
    canvasKey,
    boot,
    close,
    isRunId: (v: unknown): v is string => typeof v === 'string' && RUN_ID_RE.test(v),
  };
}
