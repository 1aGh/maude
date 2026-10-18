// agent-runs.ts — the hook routes' view of the AI run registry (V2-1.11 §5.4, V2-1.15 §5.4).
//
// A run is keyed by Claude Code's `session_id` (or, from a Maude chat, by its `chat`): run/begin
// opens it, run/end closes it, and every Edit/Write the PreToolUse hook clears CLAIMS the
// artboards it reaches — "one AI per artboard" (A4). Since S5.3 this is a VIEW: the runs, their
// claims (= leases) and their touched files live in ai/runs.ts, the one registry; nothing here
// keeps a second map. The API stays synchronous for routes/agent.ts — a claim is reserved in the
// registry at once (so the next hook call already sees it) and settled on the lease home after.
//
// `changedArtboards` is the pure "which artboards does this edit reach" map, shared by edit/check
// (before the write) and edit/touched (after it).

import { parseSync } from 'oxc-parser';

import { createLocalLeaseHome } from './ai/lease-home.ts';
import type { RunRecord } from './ai/run-lifecycle.ts';
import { createRunRegistry, type RunRegistry } from './ai/runs.ts';

export const RUN_ACTORS = ['maude-chat', 'claude-code'] as const;
export const RUN_OUTCOMES = ['done', 'stopped', 'failed', 'warnings'] as const;
export type RunActor = (typeof RUN_ACTORS)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** A ⌘/ selection-scoped run (G-AI-6): it may change only these artboards of this canvas. */
export interface RunScope {
  /** designRoot-relative canvas */
  canvas: string;
  /** empty = the whole canvas */
  artboards: string[];
}

export interface AgentRun {
  run: string;
  session: string;
  actor: RunActor;
  label: string | null;
  state: 'open' | 'ended';
  outcome?: RunOutcome;
  startedAt: number;
  endedAt?: number;
  promptIds: string[];
  /** designRoot-relative path → artboards touched + last touch */
  touched: Record<string, { artboards: string[]; at: number }>;
  /** `${canvas}#${artboard}`, or `${canvas}#*` for a change at module scope */
  claims: Set<string>;
  /** set by a ⌘/ chat (G-AI-6); edit/check denies `out-of-scope` outside it */
  scope: RunScope | null;
}

/** Side effects of the run lifecycle (http.ts wires them; all optional). */
export interface RunBracket {
  begin?(run: AgentRun): void;
  touch?(run: AgentRun, path: string): void;
  end?(run: AgentRun, outcome: RunOutcome): void;
}

export interface RunConflict {
  artboard: string;
  run: string;
  who: RunActor;
  label: string | null;
  /** the holder is a run of this Mac's person (`mine`) — else a member's, by its home `actor` */
  mine: boolean;
  /** a member's run: the home's actor identity (never shown raw — routes/agent.ts names it) */
  actor?: string;
}

export type AgentRuns = ReturnType<typeof createAgentRuns>;

/** A change at module scope rides as the artboard key `*`: it reaches every artboard. */
const WHOLE = '*';

const hitOf = (held: string, artboards: string[] | '*') =>
  artboards === WHOLE
    ? held
    : held === WHOLE
      ? (artboards[0] ?? null)
      : artboards.includes(held)
        ? held
        : null;

const toScope = (s: RunScope | null | undefined) =>
  s ? { canvas: s.canvas, artboards: s.artboards.length ? s.artboards : ('*' as const) } : null;

export function createAgentRuns(
  bracket: RunBracket = {},
  now: () => number = Date.now,
  registry?: RunRegistry
) {
  const reg =
    registry ??
    createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you', now }),
      now,
      autoRenew: false,
    });
  const promptIds = new Map<string, string[]>();
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* a bracket side effect never fails the hook */
    }
  };
  const keyPrefix = reg.canvasKey('');
  const relOf = (key: string) => (key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key);
  const actorOf = (origin: RunRecord['origin']): RunActor =>
    origin === 'maude-chat' ? 'maude-chat' : 'claude-code';

  function asAgentRun(r: RunRecord): AgentRun {
    const outcome: RunOutcome | undefined = r.outcome
      ? r.outcome === 'done' || r.outcome === 'failed'
        ? r.outcome
        : 'stopped'
      : undefined;
    return {
      run: r.runId,
      session: r.sessionId ?? '',
      actor: actorOf(r.origin),
      label: r.label || null,
      state: r.state === 'ended' ? 'ended' : 'open',
      ...(outcome ? { outcome } : {}),
      startedAt: r.startedAt ?? r.createdAt,
      ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
      promptIds: promptIds.get(r.runId) ?? [],
      touched: Object.fromEntries(
        Object.entries(r.touched).map(([p, a]) => [
          p,
          { artboards: a, at: r.hookAt ?? r.createdAt },
        ])
      ),
      claims: new Set(r.leases.map((l) => `${relOf(l.canvas)}#${l.artboard}`)),
      scope: r.scope?.canvas
        ? {
            canvas: r.scope.canvas,
            artboards: r.scope.artboards === WHOLE ? [] : [...r.scope.artboards],
          }
        : null,
    };
  }

  /**
   * V2-1.15 §5.4 "Binding the hook run key": every hook call resolves `(chat ?? session)` to a
   * run. The run each key resolved to last is remembered, so a run that ENDED under the key
   * (`lease-lost`) can still be named by the next hook call of the same turn.
   */
  const last = new Map<string, string>();
  const keysOf = (session: string, chat?: string | null) =>
    chat ? [`c:${chat}`, `s:${session}`] : [`s:${session}`];
  function resolve(session: string, chat?: string | null): RunRecord | null {
    const r = reg.resolve({ chat: chat ?? null, session });
    if (r) remember(session, chat, r.runId);
    return r;
  }
  function remember(session: string, chat: string | null | undefined, runId: string) {
    for (const k of keysOf(session, chat)) {
      last.delete(k);
      last.set(k, runId);
    }
    // insertion order = recency: keep the newest keys (one per session / chat in practice)
    while (last.size > 1000) last.delete(last.keys().next().value as string);
  }

  const open = (session: string, chat?: string | null) => {
    const r = resolve(session, chat);
    return r ? asAgentRun(r) : null;
  };

  /**
   * The run this hook key lost its turn on (§5.9.4 / §5.6: outcome `lease-lost`), while no live
   * run answers the key. The next prompt opens a new run, which clears it.
   */
  function lost(session: string, chat?: string | null): RunRecord | null {
    if (resolve(session, chat)) return null;
    for (const k of keysOf(session, chat)) {
      const id = last.get(k);
      const r = id ? reg.get(id) : null;
      if (r) return r.outcome === 'lease-lost' ? r : null;
    }
    return null;
  }

  function begin(b: {
    session: string;
    promptId?: string;
    actor: RunActor;
    label?: string;
    scope?: RunScope | null;
    /** MAUDE_CHAT_ID — binds to that chat's live run instead of opening a second one (H5) */
    chat?: string;
  }): AgentRun {
    const cur = resolve(b.session, b.chat);
    if (cur) {
      if (b.promptId) {
        const ids = promptIds.get(cur.runId) ?? [];
        if (!ids.includes(b.promptId)) promptIds.set(cur.runId, [...ids, b.promptId]);
      }
      const bound =
        reg.hookEvent(cur.runId, {
          sessionId: b.session,
          ...(b.scope !== undefined ? { scope: toScope(b.scope) } : {}),
        }) ?? cur;
      return asAgentRun(bound);
    }
    const { rec } = reg.open({
      chatId: b.chat ?? null,
      sessionId: b.session,
      origin: b.actor === 'maude-chat' ? 'maude-chat' : 'claude-code',
      label: b.label,
      scope: toScope(b.scope),
      agent: 'Claude Code',
    });
    if (b.promptId) promptIds.set(rec.runId, [b.promptId]);
    remember(b.session, b.chat, rec.runId);
    // a hook run is lazy: it leases what each edit reaches, at that edit's claim
    void reg.admit(rec, { lazy: true }).catch(() => null);
    const run = asAgentRun(reg.get(rec.runId) ?? rec);
    safe(() => bracket.begin?.(run));
    return run;
  }

  /** The open run of `session` / `chat`, opening one when the prompt hook never ran. */
  function ensure(session: string, chat?: string | null): AgentRun {
    return (
      open(session, chat) ??
      begin({ session, actor: chat ? 'maude-chat' : 'claude-code', ...(chat ? { chat } : {}) })
    );
  }

  /** Another live run's lease that `artboards` (or `'*'` = the whole canvas) would cross. */
  function conflict(
    session: string,
    canvas: string,
    artboards: string[] | '*',
    chat?: string | null
  ): RunConflict | null {
    const self = resolve(session, chat);
    const key = reg.canvasKey(canvas);
    for (const r of reg.live()) {
      if (r.runId === self?.runId) continue;
      for (const l of r.leases) {
        const hit = l.canvas === key ? hitOf(l.artboard, artboards) : null;
        if (hit)
          return {
            artboard: hit,
            run: r.runId,
            who: actorOf(r.origin),
            label: r.label || null,
            mine: true,
          };
      }
    }
    for (const o of reg.view().others)
      for (const a of o.artboards) {
        const hit = a.canvas === key ? hitOf(a.artboard, artboards) : null;
        if (hit)
          return {
            artboard: hit,
            run: o.runId,
            who: actorOf(o.origin),
            label: o.label || null,
            mine: false,
            actor: o.actor,
          };
      }
    return null;
  }

  function claim(session: string, canvas: string, artboards: string[] | '*', chat?: string | null) {
    const r = ensure(session, chat);
    const key = reg.canvasKey(canvas);
    const keys = (artboards === WHOLE ? [WHOLE] : artboards).map((a) => ({
      canvas: key,
      artboard: a,
    }));
    const need = reg.reserve(r.run, keys);
    void reg.settle(r.run, need).catch(() => null);
  }

  /** An edit was denied `artboard-busy`: the end of the turn continues that artboard (§5.5). */
  function noteBusy(session: string, canvas: string, artboard: string, chat?: string | null) {
    const r = resolve(session, chat);
    if (r && artboard !== WHOLE) reg.noteBusy(r.runId, { canvas: reg.canvasKey(canvas), artboard });
  }

  function touch(session: string, path: string, artboards: string[], chat?: string | null) {
    const r = ensure(session, chat);
    const rec = reg.hookEvent(r.run, { touched: [path, artboards] });
    if (rec) safe(() => bracket.touch?.(asAgentRun(rec), path));
  }

  function end(session: string, outcome: RunOutcome, chat?: string | null): AgentRun | null {
    const r = resolve(session, chat);
    if (!r) return null;
    // the hook's end closes the run now; its leases go back to the home after
    const closed = reg.endNow(
      r.runId,
      outcome === 'failed' ? 'failed' : outcome === 'stopped' ? 'stopped' : 'done'
    );
    const run = asAgentRun(closed ?? r);
    run.outcome = outcome;
    safe(() => bracket.end?.(run, outcome));
    return run;
  }

  /** The one open run on this project, or null when there are none or several. */
  function soleOpen(): AgentRun | null {
    const live = reg.live().filter((r) => !r.behind);
    return live.length === 1 ? asAgentRun(live[0] as RunRecord) : null;
  }

  /** Every open run — V2-3.4: `GET /_api/shell/status` counts them (routes/shell.ts). */
  function openRuns(): AgentRun[] {
    return reg.live().map(asAgentRun);
  }

  return {
    begin,
    ensure,
    conflict,
    claim,
    touch,
    end,
    get: open,
    lost,
    noteBusy,
    soleOpen,
    openRuns,
    registry: reg,
  };
}

// ── which artboards an edit reaches ──────────────────────────────────────────────────────────

interface Span {
  id: string;
  start: number;
  end: number;
}

type AstNode = { type?: string; start?: number; end?: number; [k: string]: unknown };

/** Every `<DCArtboard id="…">…</DCArtboard>` element span (literal ids only), in source order. */
export function artboardSpans(source: string): Span[] | null {
  const parsed = parseSync('canvas.tsx', source, { sourceType: 'module', lang: 'tsx' });
  if (parsed.errors.length) return null;
  const out: Span[] = [];
  const stack: unknown[] = [parsed.program];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    const node = n as AstNode;
    if (node.type === 'JSXElement') {
      const open = node.openingElement as AstNode | undefined;
      const name = open?.name as (AstNode & { name?: string }) | undefined;
      if (name?.type === 'JSXIdentifier' && name.name === 'DCArtboard') {
        const attrs = (open?.attributes as AstNode[] | undefined) ?? [];
        const idAttr = attrs.find(
          (a) => a.type === 'JSXAttribute' && (a.name as AstNode & { name?: string })?.name === 'id'
        );
        const v = idAttr?.value as (AstNode & { value?: unknown }) | undefined;
        if (v?.type === 'Literal' && typeof v.value === 'string')
          out.push({ id: v.value, start: node.start ?? 0, end: node.end ?? 0 });
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The artboards a [from, to) range of `source` reaches; `outside` = it also changes code outside every artboard. */
function reach(source: string, spans: Span[], from: number, to: number) {
  const ids: string[] = [];
  if (from === to) {
    for (const s of spans) if (s.start < from && from < s.end) ids.push(s.id);
    return { ids, outside: false };
  }
  let outside = false;
  let pos = from;
  for (const s of spans) {
    if (s.end <= from || s.start >= to) continue;
    ids.push(s.id);
    if (s.start > pos && source.slice(pos, s.start).trim()) outside = true;
    pos = Math.max(pos, s.end);
  }
  if (pos < to && source.slice(pos, to).trim()) outside = true;
  return { ids, outside };
}

/**
 * Which artboards turning `before` into `after` reaches. `before` null = a new file (every
 * artboard it has). A change outside every artboard (imports, shared consts, styles) — or a side
 * that does not parse — reaches the whole file. Pure.
 */
export function changedArtboards(
  before: string | null,
  after: string
): { scope: 'artboards' | 'file' | 'new'; artboards: string[] } {
  const afterSpans = artboardSpans(after);
  if (before === null) return { scope: 'new', artboards: (afterSpans ?? []).map((s) => s.id) };
  const beforeSpans = artboardSpans(before);
  const all = [...new Set([...(beforeSpans ?? []), ...(afterSpans ?? [])].map((s) => s.id))];
  if (!beforeSpans || !afterSpans) return { scope: 'file', artboards: all };
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)
  )
    s++;
  const b = reach(before, beforeSpans, p, before.length - s);
  const a = reach(after, afterSpans, p, after.length - s);
  if (b.outside || a.outside) return { scope: 'file', artboards: all };
  const ids = new Set([...b.ids, ...a.ids]);
  return { scope: 'artboards', artboards: all.filter((id) => ids.has(id)) };
}
