// acp/may-scope.ts — P8 c7 follow-up (decision maude/v2-p8-c7-ai-may-enforced, EXTENDS
// maude/v2-p8-c7-ai-may-told-not-enforced): the AI chat's Advanced › "AI may" switches, held by the
// server instead of only told to the agent.
//
//   Search the web          off → WebFetch / WebSearch, the shell downloaders and the web verbs are denied
//   Use Assets and footage  off → reads under the project's assets folder (`<designRoot>/assets/`, where
//                                 footage lives too — footage-store.ts) and the asset/footage verbs are denied
//
// The state reaches the server on the main origin only: the panel reads its per-Mac switch
// (client/v2/ai/ai-may.js) and sends it as the `may` field of every `prompt` / `warm` frame on
// `/_ws/acp` — the same channel the ask-before mode rides (acp/index.ts). Never parsed out of the ask's
// text: the `[maude-may …]` line stays there as a hint that saves the agent wasted calls, and nothing
// reads it back.
//
// Two layers, because the bridge's permission gate does not see every tool call:
//
//   1. Spawn-time deny rules (`mayDenyRules` → the SDK's `disallowedTools`). A deny rule wins over every
//      allow rule (Maude's own allow-list, the person's ~/.claude) and over every mode, bypassPermissions
//      included. It is the only thing that can hold a Read inside the project: Claude Code approves those
//      itself and never asks the bridge. A running session keeps the rules it was spawned with, so a
//      change re-establishes the chat's session (close + load, history kept) before its next turn —
//      AcpBridge.sessionFor.
//   2. The live gate (`mayRefusal`, in AcpBridge's requestPermission). Every request that does reach the
//      bridge is checked against the CURRENT state and refused without a card — the shell commands
//      (curl/wget, `cat .design/assets/…`, an asset verb) that are not on the allow-list.
//
// Residual, named: a turn already running when a switch goes off keeps its spawn-time allow-list until
// it ends (WebFetch/WebSearch are name-allowed while web is on, and Claude Code approves those itself);
// the next ask holds. A shell command the gate cannot classify still goes to the person's permission
// card, as before — and under bypassPermissions (or the person's own Bash allow rules) the CLI approves
// a shell command without asking, so only the Bash deny rules for the verbs hold there, not an
// arbitrary `cat`. Grep/Glob over a folder that CONTAINS the assets folder are covered by Claude Code's
// own best-effort application of Read deny rules, not by this gate. A connected MCP server's own web
// tools are not classified.
//
// Pure + dependency-free (bar node:path and write-scope's path helpers): unit-tested without a session
// (test/acp-may-scope.test.ts); end to end in test/acp-may-gate.test.ts.

import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { isInsideRoot, resolveRealPath } from './write-scope.ts';

export interface AiMay {
  /** "Use Assets and footage" */
  assets: boolean;
  /** "Search the web" */
  web: boolean;
}

export const MAY_ALL: AiMay = Object.freeze({ assets: true, web: true });

/**
 * The frame's `may` field. Only an explicit `false` turns a switch off (both default ON, matching the
 * client's `readMay`). Anything that is not a plain object is "no news" — `null`, never a change — so an
 * older client that sends no field leaves the bridge's last-known state alone.
 */
export function parseMay(raw: unknown): AiMay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return { assets: o.assets !== false, web: o.web !== false };
}

export function mayKey(may: AiMay): string {
  return `assets=${may.assets ? 1 : 0};web=${may.web ? 1 : 0}`;
}

/** The two native web tools (bare names, as on `_meta.claudeCode.toolName`). */
export const WEB_TOOL_NAMES: readonly string[] = ['WebFetch', 'WebSearch'];

/**
 * `maude design` verbs that reach the web on a URL or query the agent chooses. `generate` /
 * `import-figma` / `transcribe` talk to a named provider the person set up and prompt anyway — not "the
 * web" this switch is about.
 */
export const WEB_VERBS: readonly string[] = ['fetch-asset', 'import-brand', 'audio-search'];

/** `maude design` verbs whose work is reading (or editing) the project's assets / footage. */
export const ASSET_VERBS: readonly string[] = [
  'assets',
  'asset-sweep',
  'probe-footage',
  'smart-frames',
  'ingest-footage',
  'import-asset',
  'fetch-asset',
  'transcribe-local',
  'transcribe',
  'beats',
  'captions',
  'cut-words',
  'cut-to-beat',
  'reel-place',
  'describe',
  'photo-adjust',
  'photo-bg-remove',
];

/**
 * The assets folder of a project, both as the design root names it and as it resolves on disk (a
 * `.design` that is a symlink to a shared design repo — the studyfi layout — has its files elsewhere).
 */
export function assetsRootsFor(repoRoot: string, designRoot: string): string[] {
  const lexical = resolve(repoRoot, designRoot, 'assets');
  const real = resolveRealPath(lexical, repoRoot);
  return real === lexical ? [lexical] : [lexical, real];
}

const verbRule = (v: string) => `Bash(maude design ${v}:*)`;

/** The `disallowedTools` a session is spawned with. Empty when everything is on. */
export function mayDenyRules(may: AiMay, assetsRoots: readonly string[]): string[] {
  const out: string[] = [];
  if (!may.web) out.push(...WEB_TOOL_NAMES, ...WEB_VERBS.map(verbRule));
  if (!may.assets) {
    // `//abs/path` is Claude Code's absolute-path form for a Read rule (`/x` would be settings-relative).
    for (const root of assetsRoots) out.push(`Read(/${root.split(sep).join('/')}/**)`);
    for (const v of ASSET_VERBS) {
      const rule = verbRule(v);
      if (!out.includes(rule)) out.push(rule);
    }
  }
  return out;
}

/** Maude's allow-list with every rule an off switch covers removed (a deny rule wins anyway). */
export function mayAllowedTools(allowed: readonly string[], may: AiMay): string[] {
  const deniedVerbs = new Set<string>([
    ...(may.web ? [] : WEB_VERBS),
    ...(may.assets ? [] : ASSET_VERBS),
  ]);
  return allowed.filter((t) => {
    if (!may.web && WEB_TOOL_NAMES.includes(t)) return false;
    const m = /^Bash\(maude design ([a-z0-9-]+)[ :]/.exec(t);
    return !(m && deniedVerbs.has(m[1] as string));
  });
}

interface ToolCallLike {
  kind?: unknown;
  rawInput?: unknown;
  locations?: unknown;
}

const PATH_KEYS = ['file_path', 'notebook_path', 'path', 'abs_path', 'filePath'] as const;
const VERB_RE = /(?:^|[\s;&|()`$])(?:maude|mdcc)\s+design\s+([a-z][a-z0-9-]*)/g;
// A downloader as a COMMAND word: `curl-local` (loopback-only, its own verb) is not one.
const DOWNLOADER_RE = /(?:^|[\s;&|()`$])(?:curl|wget|aria2c)(?![\w-])/;

function insideAny(p: string, repoRoot: string, roots: readonly string[]): boolean {
  const lexical = isAbsolute(p) ? resolve(p) : resolve(repoRoot, p);
  const real = resolveRealPath(p, repoRoot);
  return roots.some(
    (r) => r === lexical || r === real || isInsideRoot(lexical, r) || isInsideRoot(real, r)
  );
}

/** How a root can be spelled in a command or a glob: absolute, and repo-relative (`.design/assets`). */
function spellings(repoRoot: string, roots: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of roots) {
    out.add(r);
    const rel = relative(repoRoot, r);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) out.add(rel.split(sep).join('/'));
  }
  return [...out];
}

function verbsIn(command: string): string[] {
  return [...command.matchAll(VERB_RE)].map((m) => m[1] as string);
}

/**
 * The live gate: which switch, if any, refuses this permission request. `toolName` is the name from the
 * streamed `tool_call` (AcpBridge.toolNames) — unknown is fine here: refusing is the safe direction, so a
 * request whose name went missing is still refused by its shape (kind `fetch`, a path in the folder).
 */
export function mayRefusal(
  toolName: string | undefined,
  toolCall: ToolCallLike | null | undefined,
  may: AiMay,
  repoRoot: string,
  assetsRoots: readonly string[]
): 'web' | 'assets' | null {
  if (may.web && may.assets) return null;
  const raw = (toolCall?.rawInput ?? {}) as Record<string, unknown>;
  const command = typeof raw.command === 'string' ? raw.command : '';

  if (!may.web) {
    if (toolName && WEB_TOOL_NAMES.includes(toolName)) return 'web';
    if (!toolName && toolCall?.kind === 'fetch') return 'web';
    if (
      command &&
      (DOWNLOADER_RE.test(command) || verbsIn(command).some((v) => WEB_VERBS.includes(v)))
    )
      return 'web';
  }

  if (!may.assets) {
    if (command) {
      if (verbsIn(command).some((v) => ASSET_VERBS.includes(v))) return 'assets';
      if (spellings(repoRoot, assetsRoots).some((s) => command.includes(s))) return 'assets';
    }
    const paths: string[] = [];
    for (const k of PATH_KEYS)
      if (typeof raw[k] === 'string' && raw[k]) paths.push(raw[k] as string);
    if (Array.isArray(toolCall?.locations)) {
      for (const l of toolCall.locations as Array<{ path?: unknown }>) {
        if (typeof l?.path === 'string' && l.path) paths.push(l.path);
      }
    }
    if (paths.some((p) => insideAny(p, repoRoot, assetsRoots))) return 'assets';
    // A glob that names the folder (`.design/assets/**/*.mp4`, or `assets/**` under `path: .design`).
    for (const g of [raw.pattern, raw.glob]) {
      if (typeof g !== 'string' || !g || (toolName === 'Grep' && g === raw.pattern)) continue;
      const base = typeof raw.path === 'string' && raw.path ? raw.path : '.';
      const joined = isAbsolute(g) ? g : join(base, g);
      if (spellings(repoRoot, assetsRoots).some((s) => g.includes(s) || joined.includes(s)))
        return 'assets';
      const prefix = joined.split(/[*?[{]/)[0] ?? '';
      if (prefix && insideAny(prefix, repoRoot, assetsRoots)) return 'assets';
    }
  }
  return null;
}
