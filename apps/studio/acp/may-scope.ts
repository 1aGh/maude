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
// V2-8.9 M1 (decisions maude/v2-8.9-lead-m1-canvas-navigation-gate, maude/v2-8.9-m1-tab-web-flag-tauri-command)
// — "Search the web: off" also holds a canvas the agent wrote: in the desktop app the studio page tells
// the shell (`set_tab_web`, client ai-may.js) and windows.rs `navigation_allowed_for` keeps every frame of
// that tab on loopback; and the session carries MAUDE_NO_EGRESS=1 (`mayEnv`), so the headless browsers the
// `maude design` helpers start resolve only loopback (bin/_no-egress.sh for agent-browser, bin/_pw-launch.mjs
// for Playwright; perf's Safari lane is refused). Residual, named: a canvas opened in a plain BROWSER tab
// (`maude design serve`, a cloud cell) has no shell gate — there the canvas CSP holds fetch/img/media but
// not navigation; renders the SERVER starts (export, thumbnails) do not carry the session's env; and the
// shell's flag is per tab as the page last told it, so a page that never loads its bundle (an older client)
// leaves the default (on). Round 2 (L-R2-2): neither the navigation gate nor the CSP covers DNS from a
// resource hint, so the canvas shell (plugins/design/templates/_shell.html) turns prefetch control off
// and strips `rel=dns-prefetch|preconnect|prefetch|prerender` in EVERY canvas frame, web on or off; a
// nested same-origin frame inside a canvas keeps its own prototypes (named, like WebRTC there), and
// whether the shipping WKWebView honours the meta was not checked on a real Mac.
//
// V2-8.9 M2 adds a third, switch-independent part below: the credential-store deny rules + their live
// refusal (`credentialDenyRules` / `credentialRefusal`); and a fourth, the read boundary
// (`readBoundaryRoots` / `readAllowRules` / `readVerdict`, decision maude/v2-michal-m2-read-boundary).
//
// Pure + dependency-free (bar node:path and write-scope's path helpers): unit-tested without a session
// (test/acp-may-scope.test.ts); end to end in test/acp-may-gate.test.ts.

import { homedir, tmpdir } from 'node:os';
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

/**
 * V2-8.9 M1 (decision maude/v2-8.9-lead-m1-canvas-navigation-gate) — the env var a web-off session's
 * `claude` (and every command it runs) carries. The `maude design` helpers that start a headless browser
 * read it: agent-browser goes through a dead loopback proxy (bin/_no-egress.sh), Playwright gets
 * host-resolver rules (bin/_pw-launch.mjs), so a canvas the agent wrote cannot reach a website from a
 * screenshot / canvas-rects / perf render.
 */
export const NO_EGRESS_ENV = 'MAUDE_NO_EGRESS';

/** The session env for `may` (the SDK's `options.env`, merged over the adapter's process env). */
export function mayEnv(may: AiMay): Record<string, string> {
  return may.web ? {} : { [NO_EGRESS_ENV]: '1' };
}

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

// ---------------------------------------------------------------------------------------------------
// V2-8.9 M2 (decision maude/v2-8.9-lead-m2-deny-credential-reads-only) — credential stores are never
// read by the agent: these folders get a deny rule, on EVERY session whatever the "AI may" switches
// say. Any other read outside the project is bounded by the M2 read boundary at the bottom of this
// file (Michal's decision maude/v2-michal-m2-read-boundary, which superseded P3's "reads stay Claude
// Code's default"); the deny rules win over its allow rules and over a consented folder.
//
//   • Maude's own config: `~/.config/maude/**` AND `$XDG_CONFIG_HOME/maude/**` — every profile's
//     cloud.json / hubs.json / keys.json / project-links.json (`profiles/<id>/…` sit under it), plus
//     the two files this server's own profile env names (MAUDE_CLOUD_CONFIG / HUBS_CONFIG_PATH)
//     wherever they are. The agent's env no longer carries those two pointers (acp/env.ts).
//   • ~/.ssh, ~/.aws, ~/.gnupg, ~/Library/Keychains.
//
// Two layers, as above: the deny rules (Read — Claude Code applies Read rules to Grep/Glob
// best-effort) and the live gate (`credentialRefusal`) for a request that does reach the bridge — a
// shell command that NAMES one of these paths is refused without a card. Residual, named: under
// bypassPermissions (or the person's own Bash allow rules) a shell command that reaches a credential
// file WITHOUT naming its path (a glob, a variable, `cd ~ && cat .ssh/*`) is approved by the CLI
// itself and reaches neither layer. Round 2 (R2-L2): the live refusal folds case; the deny rules
// cannot (Claude Code's matcher is in the native binary, unverified offline) — so a case-variant
// `Read` (`~/.CONFIG/Maude/…`, allow-listed, never reaching the bridge) rests on that matcher alone.

export interface CredentialPaths {
  /** Folders — every file under them is a credential store. */
  dirs: string[];
  /** Single files (the profile pointers of this server's own env). */
  files: string[];
}

/** The credential folders/files for an env (absolute; the real path too when it differs). */
export function credentialPathsFor(
  env: Record<string, string | undefined> = process.env,
  home: string = env.HOME || homedir()
): CredentialPaths {
  const dirs = new Set<string>();
  const files = new Set<string>();
  const addDir = (p: string) => {
    const abs = resolve(p);
    dirs.add(abs);
    const real = resolveRealPath(abs, abs);
    if (real !== abs) dirs.add(real);
  };
  addDir(join(home, '.config', 'maude'));
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0 && isAbsolute(xdg)) addDir(join(xdg, 'maude'));
  for (const d of ['.ssh', '.aws', '.gnupg', join('Library', 'Keychains')]) addDir(join(home, d));
  for (const k of ['MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH']) {
    const f = env[k];
    if (!f || !isAbsolute(f)) continue;
    const abs = resolve(f);
    if (![...dirs].some((d) => abs === d || isInsideRoot(abs, d))) files.add(abs);
  }
  return { dirs: [...dirs], files: [...files] };
}

const posixAbs = (p: string) => p.split(sep).join('/');

/** The deny rules every session is spawned with (`Read(//abs/**)`, Claude Code's absolute form). */
export function credentialDenyRules(paths: CredentialPaths): string[] {
  return [
    ...paths.dirs.map((d) => `Read(/${posixAbs(d)}/**)`),
    ...paths.files.map((f) => `Read(/${posixAbs(f)})`),
  ];
}

/** How a credential path can be spelled in a shell command: absolute, and `~/…` / `$HOME/…`. */
function credentialSpellings(paths: CredentialPaths, home: string): string[] {
  const out = new Set<string>();
  for (const p of [...paths.dirs, ...paths.files]) {
    out.add(posixAbs(p));
    const rel = relative(home, p);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      const r = posixAbs(rel);
      out.add(`~/${r}`);
      out.add(`$HOME/${r}`);
      out.add(`\${HOME}/${r}`);
    }
  }
  return [...out];
}

/**
 * The live gate's credential half: a request whose path (rawInput / locations / an absolute glob's
 * base) lies in a credential store, or a shell command that names one, is refused without a card.
 */
export function credentialRefusal(
  toolCall: ToolCallLike | null | undefined,
  paths: CredentialPaths,
  repoRoot: string,
  home: string = process.env.HOME || homedir()
): 'credentials' | null {
  const raw = (toolCall?.rawInput ?? {}) as Record<string, unknown>;
  // V2-8.9 round 2 R2-L2 — case-folded: a case-insensitive volume (the macOS default) opens
  // `~/.CONFIG/Maude/cloud.json` as the same file, and the deny rules are exact-case.
  const command = typeof raw.command === 'string' ? raw.command.toLowerCase() : '';
  if (command && credentialSpellings(paths, home).some((s) => command.includes(s.toLowerCase())))
    return 'credentials';
  const roots = [...paths.dirs, ...paths.files];
  const candidates: string[] = [];
  for (const k of PATH_KEYS)
    if (typeof raw[k] === 'string' && raw[k]) candidates.push(raw[k] as string);
  if (Array.isArray(toolCall?.locations)) {
    for (const l of toolCall.locations as Array<{ path?: unknown }>) {
      if (typeof l?.path === 'string' && l.path) candidates.push(l.path);
    }
  }
  for (const g of [raw.pattern, raw.glob]) {
    if (typeof g === 'string' && isAbsolute(g)) candidates.push(g.split(/[*?[{]/)[0] ?? '');
  }
  const expand = (p: string) => (p.startsWith('~/') ? join(home, p.slice(2)) : p);
  return candidates.some((p) => p && insideAnyFolded(expand(p), repoRoot, roots))
    ? 'credentials'
    : null;
}

/** `insideAny`, with the lexical and the real path compared case-folded (R2-L2). */
function insideAnyFolded(p: string, repoRoot: string, roots: readonly string[]): boolean {
  const lexical = (isAbsolute(p) ? resolve(p) : resolve(repoRoot, p)).toLowerCase();
  const real = resolveRealPath(p, repoRoot).toLowerCase();
  return roots.some((root) => {
    const r = root.toLowerCase();
    return r === lexical || r === real || isInsideRoot(lexical, r) || isInsideRoot(real, r);
  });
}

// ---------------------------------------------------------------------------------------------------
// M2 read boundary (decision maude/v2-michal-m2-read-boundary — SUPERSEDES, for reads, Gate 0 P3's
// maude/v2-lead-ai-reads-stay-claude-code-default). The AI chat's Read / Glob / Grep / NotebookRead are
// auto-approved ONLY inside:
//   (a) the project (the repo root and the design root, as named and as they resolve on disk — a
//       `.design` symlinked to a shared design repo is project content);
//   (b) the folders the person said yes to ("Let AI read <folder>?", ai/attach-grants.ts) while they
//       are attached to THIS chat — read live per request, so a yes mid-chat counts at once and Remove
//       (the chip's ×, Advanced's Reset) puts the folder back behind the card on the very next call;
//   (c) what the agent needs to work: the bundled plugin trees (their skills and references), Maude's
//       own package root (the `maude design` helpers, templates, canvas-lib), and the temp folders
//       ($TMPDIR, /tmp — the skills screenshot to `/tmp/x.png` and read it back).
// Everything else reaches Claude Code's permission card, with "Always allow" taken off (the adapter
// turns it into a session-wide rule the folder consent would no longer bound). The credential deny
// rules above stay and still win: they are checked first and refuse without a card.
//
// Two layers, like the switches:
//   1. Spawn-time ALLOW rules (`readAllowRules` → `allowedTools`): `Read(//abs/**)` per (a)+(c) root,
//      replacing the bare `Read`/`Glob`/`Grep` names that allowed every path. Claude Code approves those
//      reads itself (and applies Read rules to Glob/Grep).
//   2. The live gate (`readVerdict`, AcpBridge.requestPermission): a read that does reach the bridge is
//      approved once when every path it names lies, as resolved on disk, inside an (a)/(b)/(c) root,
//      and otherwise goes to the person.
//
// Residual, named: under bypassPermissions, or with the person's own `Read` allow rule in ~/.claude
// (settingSources ['user'], P3), Claude Code approves every read itself — that is the person's call;
// only the credential deny rules hold there. A symlink INSIDE the project that points elsewhere is
// read through Claude Code's own working-directory rule. A skill the person installed themselves
// (outside the bundled plugins) asks before reading its own files.

/** The file-reading tools the boundary covers (bare names, as on `_meta.claudeCode.toolName`). */
export const READ_TOOL_NAMES: readonly string[] = ['Read', 'Glob', 'Grep', 'NotebookRead'];

export interface ReadBoundaryInput {
  repoRoot: string;
  designRoot?: string;
  /** The bundled plugin trees injected into the session (DDR-143). */
  pluginRoots?: readonly string[];
  /** Maude's own package root: the `maude design` helpers' files. Absent → none. */
  packageRoot?: string | null;
  /** The agent's temp folders. Default: this process's $TMPDIR (os.tmpdir) and /tmp. */
  tmpRoots?: readonly string[];
}

/** The (a)+(c) roots, absolute, each as named and as it resolves (deduped, never the disk root). */
export function readBoundaryRoots(input: ReadBoundaryInput): string[] {
  const out = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (!p || !isAbsolute(p)) return;
    const abs = resolve(p);
    for (const r of [abs, resolveRealPath(abs, abs)]) if (r !== resolve(sep)) out.add(r);
  };
  add(input.repoRoot);
  if (input.designRoot) add(resolve(input.repoRoot, input.designRoot));
  for (const p of input.pluginRoots ?? []) add(p);
  add(input.packageRoot ?? null);
  for (const t of input.tmpRoots ?? [tmpdir(), '/tmp']) add(t);
  return [...out];
}

/** The spawn-time allow rules: `Read(//abs/**)` per root (Claude Code's absolute form). */
export function readAllowRules(roots: readonly string[]): string[] {
  return roots.map((r) => `Read(/${posixAbs(r)}/**)`);
}

const climbs = (p: string) => p.split(/[\\/]/).includes('..');

/**
 * The paths a read tool call touches, resolved against the project root, or `null` when it is not a
 * read tool / names nothing it can be judged by. A glob is judged by its literal prefix; a pattern
 * that climbs (`..` anywhere) cannot be judged and is `null` (the card).
 */
export function readTargets(
  toolName: string | undefined,
  toolCall: ToolCallLike | null | undefined,
  repoRoot: string
): string[] | null {
  if (!toolName || !READ_TOOL_NAMES.includes(toolName)) return null;
  const raw = (toolCall?.rawInput ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : '');
  const abs = (p: string) => (isAbsolute(p) ? resolve(p) : resolve(repoRoot, p));
  const named: string[] = [];
  if (toolName === 'Read' || toolName === 'NotebookRead') {
    const f = str('file_path') || str('notebook_path');
    if (!f) return null;
    named.push(f);
  } else {
    const base = str('path') || '.';
    named.push(base);
    const g = str(toolName === 'Glob' ? 'pattern' : 'glob');
    if (g) {
      if (climbs(g)) return null;
      const joined = isAbsolute(g) ? g : join(base, g);
      named.push(joined.split(/[*?[{]/)[0] || base);
    }
  }
  if (Array.isArray(toolCall?.locations)) {
    for (const l of toolCall.locations as Array<{ path?: unknown }>) {
      if (typeof l?.path === 'string' && l.path) named.push(l.path);
    }
  }
  if (named.some(climbs)) return null;
  return named.map(abs);
}

/**
 * The live gate's read half. `null` — not a read tool, nothing to say. `inside` — every path it names
 * lies, as RESOLVED on disk (a symlink is judged by where it points), in a boundary root or a folder
 * this chat may read: approve once. `outside` — the person's card, without "Always allow".
 */
export function readVerdict(
  toolName: string | undefined,
  toolCall: ToolCallLike | null | undefined,
  repoRoot: string,
  roots: readonly string[]
): 'inside' | 'outside' | null {
  if (!toolName || !READ_TOOL_NAMES.includes(toolName)) return null;
  const targets = readTargets(toolName, toolCall, repoRoot);
  if (!targets?.length) return 'outside';
  const ok = targets.every((t) => {
    const real = resolveRealPath(t, repoRoot);
    return roots.some((r) => r === real || isInsideRoot(real, r));
  });
  return ok ? 'inside' : 'outside';
}
