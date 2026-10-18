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

  const open = (session: string) => {
    const r = reg.resolve({ session });
    return r ? asAgentRun(r) : null;
  };

  function begin(b: {
    session: string;
    promptId?: string;
    actor: RunActor;
    label?: string;
    scope?: RunScope | null;
    /** MAUDE_CHAT_ID — binds to that chat's live run instead of opening a second one (H5) */
    chat?: string;
  }): AgentRun {
    const cur = reg.resolve({ chat: b.chat ?? null, session: b.session });
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
    // a hook run is lazy: it leases what each edit reaches, at that edit's claim
    void reg.admit(rec, { lazy: true }).catch(() => null);
    const run = asAgentRun(reg.get(rec.runId) ?? rec);
    safe(() => bracket.begin?.(run));
    return run;
  }

  /** The open run of `session`, opening one (actor claude-code) when the prompt hook never ran. */
  function ensure(session: string): AgentRun {
    return open(session) ?? begin({ session, actor: 'claude-code' });
  }

  /** Another live run's lease that `artboards` (or `'*'` = the whole canvas) would cross. */
  function conflict(
    session: string,
    canvas: string,
    artboards: string[] | '*'
  ): RunConflict | null {
    const self = reg.resolve({ session });
    const key = reg.canvasKey(canvas);
    for (const r of reg.live()) {
      if (r.runId === self?.runId) continue;
      for (const l of r.leases) {
        const hit = l.canvas === key ? hitOf(l.artboard, artboards) : null;
        if (hit)
          return { artboard: hit, run: r.runId, who: actorOf(r.origin), label: r.label || null };
      }
    }
    for (const o of reg.view().others)
      for (const a of o.artboards) {
        const hit = a.canvas === key ? hitOf(a.artboard, artboards) : null;
        if (hit)
          return { artboard: hit, run: o.runId, who: actorOf(o.origin), label: o.label || null };
      }
    return null;
  }

  function claim(session: string, canvas: string, artboards: string[] | '*') {
    const r = ensure(session);
    const key = reg.canvasKey(canvas);
    const keys = (artboards === WHOLE ? [WHOLE] : artboards).map((a) => ({
      canvas: key,
      artboard: a,
    }));
    const need = reg.reserve(r.run, keys);
    void reg.settle(r.run, need).catch(() => null);
  }

  function touch(session: string, path: string, artboards: string[]) {
    const r = ensure(session);
    const rec = reg.hookEvent(r.run, { touched: [path, artboards] });
    if (rec) safe(() => bracket.touch?.(asAgentRun(rec), path));
  }

  function end(session: string, outcome: RunOutcome): AgentRun | null {
    const r = reg.resolve({ session });
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
