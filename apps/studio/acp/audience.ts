// acp/audience.ts — V2-8.9 H1 (decision maude/v2-8.9-lead-h1-audience-aware-write-gate): the owner's
// AI must not carry a file into a canvas that people who cannot see that file can see.
//
// The attack (V2-8.9 attacker H1): a canvas-scoped grantee (Can comment / a canvas invite) leaves a
// design-shaped thread on `ui/Campaign.tsx` — "swap this placeholder for the tier table from
// ui/Pricing-internal.tsx". The owner says "polish"; the agent auto-reads Pricing-internal (reads stay
// Claude Code's default, Gate 0 P3) and auto-edits Campaign (an in-project write); sync hands the
// grantee bytes the per-canvas ACL promises they never see. Nothing in the agent's world knows the two
// files have different audiences — so the WRITE gate learns it:
//
//   • the bridge remembers the design-root files this chat has read (`readPathsOf`, from the streamed
//     `tool_call` notifications: Read / Grep / NotebookRead paths and locations, and any path a shell
//     command names, e.g. `maude design read-annotations ui/x.tsx` or `cat .design/ui/x.tsx`);
//   • an in-project write to a design-root file asks `WriteAudienceSource.audienceOf(targets)`: every
//     canvas whose closure holds a target AND that someone holds through a canvas-scoped grant, with
//     who and that canvas's closure;
//   • `audienceLeak`: if a file read this chat is outside one such closure, the write loses
//     auto-approve and becomes a permission card naming the source and who can see the target.
//
// Desktop-only / no-hub projects: the source answers [] (everyone who can see anything is "only you"),
// so nothing changes. A linked hub that cannot be asked answers null → the card, fail closed — but
// only when the chat read some other design-root file (the local precheck below), so ordinary offline
// edits of the file the agent read never ask.
//
// Deliberately conservative (a card where a narrower check might have passed, never the reverse):
//   • a grantee is judged by the ONE granted canvas that holds the target — a person holding two
//     canvases may get a card for a file they could in fact see;
//   • a Grep over a folder counts as reading every file under it.
// Round 2 (decision maude/v2-8.9-round2-writer-verbs-audience): canvas copies under `_history/`,
// `_trash/`, `_versions` and the path-less `history show|diff` count as reading the whole design
// folder; the auto-tier writer verbs (annotate, canvas-edit, …) are judged too — on a hub-linked
// project their allow rules leave the session, so each call reaches the bridge (`writerVerbCall`).
// Residual, named: other runtime state (`_comments/`, `_chat/`, …) is not tracked, and a verb whose
// output names no path on its command line (`comments list`) is not a tracked read; the
// open-comments step of /design:edit (H1 part c, plugin copy) is the layer for thread text. A
// person's own `~/.claude` allow rule (`Bash(maude:*)`) or a bypassPermissions mode skips the bridge
// for these verbs exactly as it does for Edit — their call.

import { isAbsolute, relative, resolve, sep } from 'node:path';

import { agentPath } from './agent-path.ts';
import { resolveRealPath } from './write-scope.ts';

/** One canvas-scoped audience of a write target. */
export interface AudienceGrant {
  /** The granted canvas whose closure holds the target (designRoot-relative). */
  canvas: string;
  /** Who holds it through a canvas-scoped grant (display names; may be invitations). */
  who: string[];
  /** That canvas's closure (designRoot-relative), the canvas itself included. */
  closure: ReadonlySet<string>;
}

export interface WriteAudienceSource {
  /**
   * The canvas-scoped audiences of `targets` (designRoot-relative). `[]` = nobody beyond the
   * project's own people (no hub, or no canvas grant holds a target). `null` = not knowable now
   * (a linked hub that could not be asked) — the caller fails closed.
   */
  audienceOf(targets: readonly string[]): Promise<AudienceGrant[] | null>;
  /**
   * V2-8.9 round 2 — can anyone beyond the project's own people see something here at all (a linked
   * hub)? Synchronous: decides at session spawn whether the writer verbs keep their allow rules.
   * Absent = yes (fail closed).
   */
  linked?(): boolean;
}

/** A file or folder this chat has read, designRoot-relative. */
export interface TrackedRead {
  rel: string;
  dir: boolean;
  /**
   * V2-8.9 M1 — read OUTSIDE the project and Maude's own folders (a folder the person let AI read,
   * the temp folder, home…): `rel` is then the absolute path. Nobody on the hub can see it, so on a
   * hub-linked project it is a private source for every design-root write (`privateLeak`).
   */
  outside?: boolean;
}

export interface AudienceLeak {
  canvas: string;
  who: string[];
  /** The files read this chat that `who` cannot see (designRoot-relative). */
  sources: string[];
}

const READ_TOOLS = new Set(['Read', 'Grep', 'NotebookRead']);
const PATH_KEYS = ['file_path', 'notebook_path', 'path', 'abs_path', 'filePath'] as const;

interface ToolCallLike {
  rawInput?: unknown;
  locations?: unknown;
}

/** A path → designRoot-relative (posix), or null when it is not under any spelling of the root. */
export function designRelOf(
  p: string,
  base: string,
  designRoots: readonly string[]
): string | null {
  const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
  const real = resolveRealPath(abs, base);
  for (const root of designRoots) {
    for (const cand of [abs, real]) {
      const r = relative(root, cand);
      if (r === '') return '';
      if (!r.startsWith('..') && !isAbsolute(r)) return r.split(sep).join('/');
    }
  }
  return null;
}

/** Runtime state (`_comments/…`, `_chat/…`) is not a design file anyone is granted. */
const isRuntime = (rel: string) => rel.split('/')[0]?.startsWith('_') === true;

/**
 * V2-8.9 round 2 (M-R2-1) — runtime folders holding whole-file copies of canvases (the safety
 * snapshots, the Trash, version pictures). A read there is a read of SOME canvas, so it counts as
 * reading the whole design folder (fails toward the card).
 */
const COPY_DIRS = new Set(['_history', '_trash', '_versions']);
const isCopyStore = (rel: string) => COPY_DIRS.has(rel.split('/')[0] ?? '');

const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const GLOB_CHAR = /[*?[{]/;

/**
 * Shell words that look like a path. A `--flag=value` counts by its value, a loopback URL by its
 * decoded `?canvas=` (`screenshot --url …?canvas=ui%2Fx.tsx`), a glob by its base folder (defender
 * R2-L3). Any other URL names no design file.
 */
export function shellPathWords(command: string): string[] {
  const out: string[] = [];
  for (let w of command.split(/[\s;&|()<>`"']+/)) {
    if (!w || w.startsWith('$')) continue;
    if (w.startsWith('-')) {
      const eq = w.indexOf('=');
      if (eq < 0) continue;
      w = w.slice(eq + 1);
      if (!w || w.startsWith('$')) continue;
    }
    if (w.includes('://')) {
      try {
        const u = new URL(w);
        if (LOOPBACK_HOST.test(u.hostname))
          for (const v of u.searchParams.getAll('canvas')) if (v) out.push(v);
      } catch {
        // not a URL: names nothing
      }
      continue;
    }
    if (GLOB_CHAR.test(w)) {
      const segs = w.split('/');
      const base = segs
        .slice(
          0,
          segs.findIndex((x) => GLOB_CHAR.test(x))
        )
        .join('/');
      out.push(base || (w.startsWith('/') ? '/' : '.'));
      continue;
    }
    if (w.includes('/') || /\.(tsx|ts|jsx|js|json|css|svg|md)$/i.test(w)) out.push(w);
  }
  return out;
}

/** `history show <ref>` / `history diff` print project-wide content when no canvas is named. */
const PATHLESS_HISTORY_RE =
  /(?:^|[\s;&|()`$])(?:maude|mdcc)\s+design\s+history\s+(?:show|diff)(?![\w-])/;

const insideRoot = (p: string, root: string) => {
  const r = relative(root, p);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};

/**
 * The design-root files/folders one streamed tool call reads. `exists` tells a folder from a file
 * (and keeps a shell word that names nothing out). Paths in the project outside the design root, and
 * in `ownRoots`, are not tracked; anything else is tracked as an `outside` read (V2-8.9 M1).
 */
export function readPathsOf(
  toolName: string | undefined,
  toolCall: ToolCallLike | null | undefined,
  repoRoot: string,
  designRoots: readonly string[],
  kindOf: (abs: string) => 'file' | 'dir' | null,
  /** V2-8.9 M1 — roots whose files are not private (Maude's plugins/package, this chat's scratch). */
  ownRoots: readonly string[] = []
): TrackedRead[] {
  if (!toolName) return [];
  const raw = (toolCall?.rawInput ?? {}) as Record<string, unknown>;
  const words: Array<{ p: string; bases: string[] }> = [];
  if (READ_TOOLS.has(toolName)) {
    for (const k of PATH_KEYS)
      if (typeof raw[k] === 'string' && raw[k])
        words.push({ p: raw[k] as string, bases: [repoRoot] });
    if (Array.isArray(toolCall?.locations)) {
      for (const l of toolCall.locations as Array<{ path?: unknown }>)
        if (typeof l?.path === 'string' && l.path) words.push({ p: l.path, bases: [repoRoot] });
    }
    // A Grep with no path searches the working directory — the whole project.
    if (toolName === 'Grep' && !words.length) words.push({ p: '.', bases: [repoRoot] });
  } else if (toolName === 'Bash' && typeof raw.command === 'string') {
    // A verb names a canvas designRoot-relative (`ui/x.tsx`), a shell command repo-relative.
    for (const w of shellPathWords(raw.command))
      words.push({ p: w, bases: [repoRoot, ...designRoots] });
  } else {
    return [];
  }
  const out = new Map<string, TrackedRead>();
  const whole = () => out.set('d:', { rel: '', dir: true });
  const owned = [repoRoot, ...ownRoots];
  const isOwned = (abs: string, base: string) => {
    const real = resolveRealPath(abs, base);
    return owned.some((r) => [abs, real].some((c) => c === r || insideRoot(c, r)));
  };
  for (const { p, bases } of words) {
    let outside: TrackedRead | null = null;
    for (const base of bases) {
      // V2-8.9 H1 — spelled as Claude Code (and a shell) opens it: `~/x` is the home folder's x.
      const a = agentPath(p, base);
      if (!a) break;
      const abs = a.abs;
      const kind = kindOf(abs);
      if (!kind) continue;
      const rel = designRelOf(abs, base, designRoots);
      if (rel === null) {
        // A folder that holds the design root (a Grep with no path, `cat **/*.tsx`): all of it.
        if (kind === 'dir' && designRoots.some((r) => insideRoot(r, abs))) {
          whole();
          outside = null;
          break;
        }
        if (!outside && !isOwned(abs, base))
          outside = { rel: abs, dir: kind === 'dir', outside: true };
        continue;
      }
      outside = null;
      if (rel !== '' && isRuntime(rel)) {
        if (isCopyStore(rel)) whole();
        break;
      }
      const key = `${kind === 'dir' ? 'd' : 'f'}:${rel}`;
      if (!out.has(key)) out.set(key, { rel, dir: kind === 'dir' });
      break;
    }
    if (outside) out.set(`o:${outside.rel}`, outside);
  }
  if (toolName === 'Bash' && out.size === 0 && PATHLESS_HISTORY_RE.test(String(raw.command)))
    whole();
  return [...out.values()];
}

/**
 * Does carrying what this chat read into `targets` reach someone who could not see it? The first
 * audience with a source outside its closure, or null. A folder read counts as every file under it,
 * so it leaks unless it is empty of anything outside the closure — which this cannot know: it leaks.
 */
export function audienceLeak(
  reads: Iterable<TrackedRead>,
  targets: readonly string[],
  audiences: readonly AudienceGrant[]
): AudienceLeak | null {
  const list = [...reads];
  for (const a of audiences) {
    const sources: string[] = [];
    for (const r of list) {
      if (r.dir) sources.push(r.rel === '' ? '(the whole design folder)' : `${r.rel}/`);
      else if (!a.closure.has(r.rel) && !targets.includes(r.rel)) sources.push(r.rel);
    }
    if (sources.length) return { canvas: a.canvas, who: a.who, sources };
  }
  return null;
}

/**
 * V2-8.9 M1 — on a hub-linked project, a file read from outside the project (a folder the person let
 * AI read, the temp folder…) is something nobody on the hub can see, whatever the canvas grants say.
 * Writing into a design-root file after such a read is the person's card, naming those sources.
 */
export function privateLeak(reads: Iterable<TrackedRead>, canvas: string): AudienceLeak | null {
  const sources: string[] = [];
  for (const r of reads) if (r.outside) sources.push(r.dir ? `${r.rel}/` : r.rel);
  return sources.length ? { canvas, who: [], sources } : null;
}

/** The local precheck: did this chat read any design-root file other than the targets? */
export function readsBeyond(reads: Iterable<TrackedRead>, targets: readonly string[]): boolean {
  for (const r of reads) if (r.dir || !targets.includes(r.rel)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------
// V2-8.9 round 2 H-R2-1 (decision maude/v2-8.9-round2-writer-verbs-audience) — the auto-tier
// `maude design` verbs that write a versioned design-root file with text the agent chose. An allowed
// tool never reaches the bridge's requestPermission, so on a hub-linked project these verbs' allow
// rules leave the session (`withoutWriterRules`) and the bridge judges each call itself.

/** The `Bash(maude design <rule>:*)` rules a hub-linked session is spawned without. */
export const AUDIENCE_WRITER_RULES: readonly string[] = [
  'annotate',
  'canvas-edit',
  'handoff',
  'import-tokens',
  'captions',
  'captions add',
  'cut-words',
  'cut-to-beat',
  'reel-place',
  'ds-check',
];

export function withoutWriterRules(allowed: readonly string[]): {
  kept: string[];
  dropped: string[];
} {
  const gated = new Set(AUDIENCE_WRITER_RULES.map((v) => `Bash(maude design ${v}:*)`));
  return {
    kept: allowed.filter((t) => !gated.has(t)),
    dropped: allowed.filter((t) => gated.has(t)),
  };
}

const WRITER_FIRST = new Set(AUDIENCE_WRITER_RULES.map((r) => r.split(' ')[0] as string));
const WRITER_MENTION_RE =
  /(?:^|[\s;&|()`$=])(?:maude|mdcc)\s+design\s+(annotate|canvas-edit|handoff|import-tokens|captions|cut-words|cut-to-beat|reel-place|ds-check)(?![\w-])/;
/** Anything that makes a command more than one plain `maude design …` call. */
const SHELL_META = /[;&|<>`$()\\\n\r]/;

export interface WriterVerbCall {
  /** The allow rule that would have covered it (`captions add`, `ds-check`, …). */
  rule: string;
  /** Does this form write (`ds-check` only with --fix/--emit; `captions list|export` never)? */
  writes: boolean;
  /**
   * The write lands where no named path says (a design system's files, the EDL's own canvas): the
   * audience is not knowable from the command, so a chat that read anything gets the card.
   */
  implicitTarget: boolean;
  /** The arguments after the verb (quotes removed). */
  args: string[];
}

/**
 * A Bash command as a gated writer verb: the call, `'compound'` when it mentions one inside anything
 * but one plain `maude design <verb> …` (the card, never the bridge's own approval), or null when it
 * mentions none.
 */
export function writerVerbCall(command: string): WriterVerbCall | 'compound' | null {
  if (!WRITER_MENTION_RE.test(command)) return null;
  const t = command.trim();
  if (SHELL_META.test(t) || !/^maude\s+design\s/.test(t)) return 'compound';
  const words: string[] = [];
  for (const m of t.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push(m[1] ?? m[2] ?? m[3] ?? '');
  const first = words[2] ?? '';
  if (!WRITER_FIRST.has(first)) return 'compound';
  let args = words.slice(3);
  let rule = first;
  let writes = true;
  if (first === 'captions') {
    const sub = args[0];
    if (sub === 'add') rule = 'captions add';
    writes = sub !== 'list' && sub !== 'export';
    args = args.slice(1);
  } else if (first === 'ds-check') {
    writes = args.some((a) => /^--(?:fix|emit)(?:=|$)/.test(a));
  }
  const implicitTarget =
    first === 'import-tokens' ||
    first === 'ds-check' ||
    (first === 'reel-place' && !args.some((a) => /^--canvas(?:=|$)/.test(a)));
  return { rule, writes, implicitTarget, args };
}

// ---------------------------------------------------------------------------------------------------
// The hub-backed source (wired in server.ts). The hub decides who holds what; this asks it with the
// one credential this Mac stored at sign-in, GET only, the same way routes/share.ts does.

export interface HubAudienceDeps {
  /** The linked hub + this Mac's credential for it, or null (desktop-only: no audience). */
  hub(): { url: string; token: string } | null;
  /** Every candidate canvas (designRoot-relative .tsx files, routes/canvas-source.ts listCanvases). */
  canvases(): string[];
  /** The closure of one canvas grant (designRoot-relative), or null when it cannot be computed. */
  closureOf(canvas: string): ReadonlySet<string> | null;
  /** Is this file a canvas (renders DesignCanvas)? A canvas is only ever in its own closure. */
  isCanvas(rel: string): boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
}

interface PersonRow {
  id?: unknown;
  name?: unknown;
  state?: unknown;
}

const MAX_PEOPLE_BYTES = 1024 * 1024;

export function createHubWriteAudience(deps: HubAudienceDeps): WriteAudienceSource {
  const ttl = deps.ttlMs ?? 30_000;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; rows: PersonRow[] }>();

  async function people(
    hub: { url: string; token: string },
    canvas: string | null
  ): Promise<PersonRow[] | null> {
    const key = `${hub.url}\u0000${canvas ?? ''}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.rows;
    const q = canvas === null ? '' : `?canvas=${encodeURIComponent(canvas)}`;
    let res: Response;
    try {
      res = await (deps.fetchImpl ?? fetch)(
        `${hub.url.replace(/\/+$/, '')}/api/access/people${q}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${hub.token}`, accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
        }
      );
    } catch {
      return null;
    }
    if (res.status !== 200) return null;
    let body: unknown;
    try {
      const text = await res.text();
      if (text.length > MAX_PEOPLE_BYTES) return null;
      body = JSON.parse(text);
    } catch {
      return null;
    }
    const rows = (body as { people?: unknown })?.people;
    if (!Array.isArray(rows)) return null;
    cache.set(key, { at: now(), rows: rows as PersonRow[] });
    return rows as PersonRow[];
  }

  return {
    linked: () => deps.hub() !== null,
    async audienceOf(targets) {
      const hub = deps.hub();
      if (!hub) return [];
      // Which canvases hold a target: a canvas holds only itself (a frame never inlines another
      // canvas, gate-b-c4j); anything else, every canvas whose closure has it.
      const holders = new Map<string, ReadonlySet<string>>();
      for (const t of targets) {
        if (deps.isCanvas(t)) {
          const c = deps.closureOf(t);
          holders.set(t, c ?? new Set([t]));
          continue;
        }
        for (const canvas of deps.canvases()) {
          if (holders.has(canvas)) continue;
          const c = deps.closureOf(canvas);
          if (c?.has(t)) holders.set(canvas, c);
        }
      }
      if (!holders.size) return [];
      const project = await people(hub, null);
      if (!project) return null;
      const projectIds = new Set(project.map((r) => String(r.id)));
      const out: AudienceGrant[] = [];
      for (const [canvas, closure] of holders) {
        const rows = await people(hub, canvas);
        if (!rows) return null;
        // On the canvas's list but not the project's = holds it through a canvas grant (or is
        // invited to it). An open Ask to edit (`requested`) holds nothing yet.
        const who = rows
          .filter((r) => r.state !== 'requested' && !projectIds.has(String(r.id)))
          .map((r) => (typeof r.name === 'string' && r.name ? r.name : 'someone invited'));
        if (who.length) out.push({ canvas, who, closure });
      }
      return out;
    },
  };
}
