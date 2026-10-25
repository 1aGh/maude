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
// Residual, named: runtime state (`_comments/`, `_chat/`, … — first segment `_`) is not tracked, and
// a verb whose output names no path on its command line (`comments list`) is not a tracked read;
// the open-comments step of /design:edit (H1 part c, plugin copy) is the layer for thread text.

import { isAbsolute, relative, resolve, sep } from 'node:path';

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
}

/** A file or folder this chat has read, designRoot-relative. */
export interface TrackedRead {
  rel: string;
  dir: boolean;
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

/** Shell words that look like a path (no flags, no URLs). */
function shellPathWords(command: string): string[] {
  const out: string[] = [];
  for (const w of command.split(/[\s;&|()<>`"']+/)) {
    if (!w || w.startsWith('-') || w.includes('://') || w.startsWith('$')) continue;
    if (w.includes('/') || /\.(tsx|ts|jsx|js|json|css|svg|md)$/i.test(w)) out.push(w);
  }
  return out;
}

/**
 * The design-root files/folders one streamed tool call reads. `exists` tells a folder from a file
 * (and keeps a shell word that names nothing out); paths outside the design root are not tracked —
 * nobody on the hub can see them, and the write gate's audience is a design-root question.
 */
export function readPathsOf(
  toolName: string | undefined,
  toolCall: ToolCallLike | null | undefined,
  repoRoot: string,
  designRoots: readonly string[],
  kindOf: (abs: string) => 'file' | 'dir' | null
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
  for (const { p, bases } of words) {
    for (const base of bases) {
      const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
      const kind = kindOf(abs);
      if (!kind) continue;
      const rel = designRelOf(abs, base, designRoots);
      if (rel === null || (rel !== '' && isRuntime(rel))) continue;
      const key = `${kind === 'dir' ? 'd' : 'f'}:${rel}`;
      if (!out.has(key)) out.set(key, { rel, dir: kind === 'dir' });
      break;
    }
  }
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

/** The local precheck: did this chat read any design-root file other than the targets? */
export function readsBeyond(reads: Iterable<TrackedRead>, targets: readonly string[]): boolean {
  for (const r of reads) if (r.dir || !targets.includes(r.rel)) return true;
  return false;
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
