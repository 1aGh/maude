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

import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { serverKeyDir } from '../shell/key-file.ts';
import { agentPath } from './agent-path.ts';
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

/** A shell command that reaches the web: a downloader as a command word, or a web `maude design` verb. */
function commandIsWeb(command: string): boolean {
  return (
    !!command &&
    (DOWNLOADER_RE.test(command) || verbsIn(command).some((v) => WEB_VERBS.includes(v)))
  );
}

/** A shell command that runs an asset/footage verb or names the assets folder (either spelling). */
function commandTouchesAssets(
  command: string,
  repoRoot: string,
  assetsRoots: readonly string[]
): boolean {
  if (!command) return false;
  if (verbsIn(command).some((v) => ASSET_VERBS.includes(v))) return true;
  return spellings(repoRoot, assetsRoots).some((s) => command.includes(s));
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
    if (commandIsWeb(command)) return 'web';
  }

  if (!may.assets) {
    if (commandTouchesAssets(command, repoRoot, assetsRoots)) return 'assets';
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
// Kind-keyed entry points (universal ACP, B3/F5 — contract `.ai/plans/notes/universal-acp-contract.md`
// rules 3–4). A non-Claude agent has no `_meta.claudeCode.toolName`: its request is judged by ACP
// `kind` + the paths it names + its command, normalised by acp/policy/enforce.ts. Same checks as the
// Claude-name-keyed functions (shared helpers), plus the command's path words resolved against the
// request's cwd: these can only REFUSE, never approve.

/** A permission request reduced to what the gates judge, whatever agent sent it. */
export interface KindRequest {
  /** ACP `kind` (read, edit, delete, move, search, execute, fetch, …); undefined when absent. */
  kind: string | undefined;
  /** Every path the request names, as spelled (locations, rawInput target keys, rawInput.cwd). */
  paths: readonly string[];
  /** The shell command (a string, or an argv joined with spaces); '' when none. */
  command: string;
  /** What relative paths resolve against: the request's own cwd, else the session's root. */
  cwd: string;
  /** The request names a web URL (rawInput.url) — web-shaped whatever its kind. */
  webShaped?: boolean;
}

/**
 * The path-like words of a shell command (`/x`, `~/x`, `$HOME/x`, `./x`, `../x`, `a/b`, `.env`), split
 * at whitespace, operators, quotes and `=` (so `--file=~/.ssh/k` and `VAR=/x` count), a short option
 * glued to its path (`-f/etc/x`) unglued. Generous on purpose: it feeds refusals only.
 */
export function commandPathTokens(command: string): string[] {
  const out: string[] = [];
  for (let w of command.split(/[\s;&|()<>`"'=]+/)) {
    w = w.replace(/^-{1,2}[A-Za-z]+(?=[/~])/, '').replace(/^\$\{?HOME\}?(?=\/|$)/, '~');
    if (!w || w.includes('://')) continue;
    if (w.includes('/') || w.startsWith('~') || w.startsWith('.')) out.push(w);
  }
  return out;
}

/** A glob judged by its literal prefix (`~/.ssh/*` → `~/.ssh/`); a plain path as it is. */
const globPrefix = (p: string) => p.split(/[*?[{]/)[0] ?? '';

/** `mayRefusal` keyed on the request's ACP `kind` instead of a Claude tool name. */
export function mayRefusalByKind(
  req: KindRequest,
  may: AiMay,
  repoRoot: string,
  assetsRoots: readonly string[],
  home: string = process.env.HOME || homedir()
): 'web' | 'assets' | null {
  if (may.web && may.assets) return null;
  if (!may.web && (req.kind === 'fetch' || req.webShaped || commandIsWeb(req.command)))
    return 'web';
  if (!may.assets) {
    if (commandTouchesAssets(req.command, repoRoot, assetsRoots)) return 'assets';
    for (const w of [...req.paths, ...commandPathTokens(req.command)]) {
      const base = globPrefix(w);
      const a = base ? agentPath(base, req.cwd, home) : null;
      if (a && insideAny(a.abs, repoRoot, assetsRoots)) return 'assets';
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
//   • The desktop app's own data folder (#206): `servers.json` (every tab's port + attest key),
//     `cli.sock`, `run/` (the token-bridge port), `shell-info/` and `home/`. Named entries, not the
//     whole folder: a Maude Cloud project's managed copy lives in its `projects/` and its session
//     must keep reading its own files.
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

/** The desktop app's identifier — its data folder's name (tauri.conf.json `identifier`). */
const APP_IDENTIFIER = 'com.maude.app';

/** The desktop app's data folder (Tauri `app_data_dir`) for a platform, or null when unknown. */
export function appDataDirFor(
  env: Record<string, string | undefined>,
  home: string,
  platform: NodeJS.Platform
): string | null {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_IDENTIFIER);
  if (platform === 'win32')
    return env.APPDATA && isAbsolute(env.APPDATA) ? join(env.APPDATA, APP_IDENTIFIER) : null;
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : null;
  return join(data ?? join(home, '.local', 'share'), APP_IDENTIFIER);
}

/** The credential folders/files for an env (absolute; the real path too when it differs). */
export function credentialPathsFor(
  env: Record<string, string | undefined> = process.env,
  home: string = env.HOME || homedir(),
  platform: NodeJS.Platform = process.platform
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
  // sec-loopback-bearer §7.5 — terminal-started servers' API key files (shell/key-file.ts): the
  // default state dir AND this env's XDG_STATE_HOME one — a terminal shell may set it when the app
  // does not, so a server started there writes where this session's own env would not point
  addDir(serverKeyDir({ HOME: home }));
  addDir(serverKeyDir({ ...env, HOME: home }));
  const appData = appDataDirFor(env, home, platform);
  if (appData) {
    for (const d of ['run', 'shell-info', 'home']) addDir(join(appData, d));
    for (const f of ['servers.json', 'cli.sock']) {
      const abs = resolve(appData, f);
      files.add(abs);
      const real = resolveRealPath(abs, abs);
      if (real !== abs) files.add(real);
    }
  }
  // B7 — a custom key-store path (generation/keys.ts) holds media AND chat keys: denied like the
  // profile's own credential files when it sits outside the folders above.
  for (const k of ['MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH', 'MAUDE_GEN_KEYS_PATH']) {
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
  if (commandNamesCredential(typeof raw.command === 'string' ? raw.command : '', paths, home))
    return 'credentials';
  const candidates: string[] = [];
  for (const k of PATH_KEYS)
    if (typeof raw[k] === 'string' && raw[k]) candidates.push(raw[k] as string);
  if (Array.isArray(toolCall?.locations)) {
    for (const l of toolCall.locations as Array<{ path?: unknown }>) {
      if (typeof l?.path === 'string' && l.path) candidates.push(l.path);
    }
  }
  for (const g of [raw.pattern, raw.glob]) {
    if (typeof g !== 'string') continue;
    const t = g.trim();
    if (isAbsolute(t) || t.startsWith('~')) candidates.push(t.split(/[*?[{]/)[0] ?? '');
  }
  return pathsHitCredential(candidates, paths, repoRoot, home) ? 'credentials' : null;
}

/** A shell command that spells a credential path (absolute, `~/…`, `$HOME/…`), case-folded. */
function commandNamesCredential(command: string, paths: CredentialPaths, home: string): boolean {
  // V2-8.9 round 2 R2-L2 — case-folded: a case-insensitive volume (the macOS default) opens
  // `~/.CONFIG/Maude/cloud.json` as the same file, and the deny rules are exact-case.
  const c = command.toLowerCase();
  return !!c && credentialSpellings(paths, home).some((s) => c.includes(s.toLowerCase()));
}

/** Does any candidate path, resolved from `cwd`, lie in a credential store (case-folded)? */
function pathsHitCredential(
  candidates: readonly string[],
  paths: CredentialPaths,
  cwd: string,
  home: string
): boolean {
  const roots = [...paths.dirs, ...paths.files];
  // V2-8.9 H1 — expanded exactly as Claude Code opens it (agent-path.ts: trimmed, `~` and `~/`), so
  // `' ~/.SSH/id_rsa'` is the key it is. Odd spellings are judged too: here they can only refuse.
  return candidates.some((p) => {
    const a = p ? agentPath(p, cwd, home) : null;
    return !!a && insideAnyFolded(a.abs, cwd, roots);
  });
}

/**
 * `credentialRefusal` keyed on a normalised request: its paths, every path word of its command
 * (resolved from the request's cwd, so `cat ../../.ssh/id_rsa` counts), and the command's spellings.
 */
export function credentialRefusalByKind(
  req: KindRequest,
  paths: CredentialPaths,
  home: string = process.env.HOME || homedir()
): 'credentials' | null {
  if (commandNamesCredential(req.command, paths, home)) return 'credentials';
  const candidates = [...req.paths, ...commandPathTokens(req.command)].map(globPrefix);
  return pathsHitCredential(candidates, paths, req.cwd, home) ? 'credentials' : null;
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
//       own package files (the `maude design` helpers, templates, canvas-lib — listed, not the
//       checkout's root, L1), the chat's own scratch folder (its TMPDIR — the skills screenshot to
//       `$TMPDIR/x.png` and read it back) and Claude Code's temp folder for THIS session only (M2 +
//       re-check 2 M-b: the rest of /tmp holds every other session's task output, so it asks). The
//       temp folders are readable but not Maude's own: a read there is private for the audience gate.
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
// Every path is spelled as Claude Code opens it first (agent-path.ts, V2-8.9 H1): `~/x` is the home
// folder's x, and a spelling readers may disagree on (spaces around it, a leading `~`) is outside.
// The `maude design` verbs that read a path they are given hold to the same roots (MAUDE_READ_ROOTS
// + the consent store, cli/lib/confine-read.mjs, H2); a read outside the project is a private
// source for the audience gate (audience.ts, M1).
//
// Residual, named: under bypassPermissions, or with the person's own `Read` allow rule in ~/.claude
// (settingSources ['user'], P3), Claude Code approves every read itself — that is the person's call;
// only the credential deny rules hold there. A symlink INSIDE the project that points elsewhere is
// judged by Claude Code against the resolved target (2.1.89+), and by this gate the same way. A skill
// the person installed themselves (outside the bundled plugins) asks before reading its own files. A
// Glob whose absolute pattern leaves the project while its `path` is in-project is judged here by the
// pattern (L3); whether Claude Code's own allow rule approves it before asking is unprobed. Between
// this gate's realpath and Claude Code's open a folder can be swapped (L4, accepted).
//
// The audience half (decision maude/v2-p8-outside-reads-are-private, narrowed by re-check 2 M-c,
// decision maude/v2-p8-untracked-repo-files-private): a repo file outside the design root counts as
// one the hub's people have (they have the repo) ONLY when git tracks it. A git-ignored or untracked
// file — or one named like a secret (.env*, .mcp.json, .claude/*.local.json, .npmrc, *.pem, *.key),
// tracked or not — is a private source like a read outside the project (acp/repo-private.ts). What
// stays accepted: a TRACKED repo file peers may not have pulled yet, and a folder read whose untracked
// content git cannot see (a folder is judged by itself and its untracked files, not each ignored one).

/** The file-reading tools the boundary covers (bare names, as on `_meta.claudeCode.toolName`). */
export const READ_TOOL_NAMES: readonly string[] = ['Read', 'Glob', 'Grep', 'NotebookRead'];

export interface ReadBoundaryInput {
  repoRoot: string;
  designRoot?: string;
  /** The bundled plugin trees injected into the session (DDR-143). */
  pluginRoots?: readonly string[];
  /** Maude's own package root: the `maude design` helpers' files. Absent → none. */
  packageRoot?: string | readonly string[] | null;
  /**
   * The agent's temp folders. V2-8.9 M2: never all of /tmp or $TMPDIR (every Claude Code session's
   * task output lives there, other projects' included) — the chat's own scratch (`chatScratchDir`,
   * exported as the agent's TMPDIR) and Claude Code's folder for THIS project
   * (`claudeCodeTmpFor`). Default: none.
   */
  tmpRoots?: readonly string[];
}

const PLAIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const uidNow = () => (typeof process.getuid === 'function' ? process.getuid() : 0);

/** `<this server's temp dir>/maude-chat-<uid>/<project hash>` — every scratch of one project. */
function projectScratchBase(repoRoot: string): string {
  const project = createHash('sha256').update(resolveRealPath(repoRoot, repoRoot)).digest('hex');
  return join(tmpdir(), `maude-chat-${uidNow()}`, project.slice(0, 16));
}

/**
 * V2-8.9 M2 — the chat's scratch folder: created by the bridge (`ensureChatScratch`, 0700), handed
 * to the agent as TMPDIR, inside the read boundary — readable, but NOT one of Maude's own roots: a
 * read there is private for the audience gate (re-check 2 M-b). One per project, chat AND run
 * (`instance`, the bridge's own random id): the default chat id is `default`, and a later default
 * chat must not find what an earlier one copied there. Wiped when the chat ends and on Remove.
 */
export function chatScratchDir(
  repoRoot: string,
  chatId: string | undefined,
  instance?: string
): string {
  const chat = chatId && PLAIN_ID_RE.test(chatId) ? chatId : 'session';
  const dir = join(projectScratchBase(repoRoot), chat);
  return instance && PLAIN_ID_RE.test(instance) ? join(dir, instance) : dir;
}

/**
 * V2-8.9 re-check 2 L3 — create the scratch owner-only and use it only when every folder from
 * `maude-chat-<uid>` down is a real directory (never a symlink) owned by this user: on a shared
 * /tmp another local user could plant one where it goes. false → the bridge leaves TMPDIR alone.
 */
export function ensureChatScratch(dir: string): boolean {
  try {
    const top = join(tmpdir(), `maude-chat-${uidNow()}`);
    if (!dir.startsWith(`${top}${sep}`)) return false;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let p = dir; ; p = dirname(p)) {
      const st = lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uidNow()) return false;
      if ((st.mode & 0o077) !== 0) chmodSync(p, 0o700);
      if (p === top) return true;
      if (dirname(p) === p) return false;
    }
  } catch {
    return false;
  }
}

/** Empty a folder in place (the agent's TMPDIR must keep existing); links are removed, never followed. */
function emptyDir(dir: string): void {
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) return;
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
}

/**
 * V2-8.9 re-check 2 M-b — Remove (a folder's chip ×) and Reset: what was copied to a chat's scratch
 * must not outlive the consent. Empties every run's scratch of `chatId`, or of every chat of the
 * project when none is named. Never throws.
 */
export function wipeChatScratch(repoRoot: string, chatId?: string): void {
  try {
    const base = projectScratchBase(repoRoot);
    const chats = chatId
      ? [chatScratchDir(repoRoot, chatId)]
      : readdirSync(base).map((c) => join(base, c));
    for (const chat of chats) {
      let runs: string[] = [];
      try {
        const st = lstatSync(chat);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        runs = readdirSync(chat).map((r) => join(chat, r));
      } catch {
        continue;
      }
      for (const run of runs) {
        try {
          emptyDir(run);
        } catch {
          /* next one */
        }
      }
    }
  } catch {
    /* nothing to wipe */
  }
}

/**
 * Claude Code's own temp folder for ONE session started in `repoRoot`:
 * `/tmp/claude-<uid>/<slug>/<sessionId>`, the slug being the cwd with every character that is not a
 * letter or digit turned into `-` (observed on 2.1.x: `/Users/u/git/maude` → `-Users-u-git-maude`;
 * the ACP adapter hands Claude Code its session id, so the ACP session id IS that folder's name).
 * V2-8.9 re-check 2 M-b: the slug folder holds EVERY session's task output for the project — the
 * person's own terminal sessions too — so only this session's is readable, judged live per request
 * (the id is not known when the session's allow rules are written). No plain id → none.
 */
export function claudeCodeTmpFor(repoRoot: string, sessionId: string | undefined): string[] {
  if (!sessionId || !PLAIN_ID_RE.test(sessionId)) return [];
  const slug = resolve(repoRoot).replace(/[^A-Za-z0-9]/g, '-');
  return [join('/tmp', `claude-${uidNow()}`, slug, sessionId)];
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
  const pkg = input.packageRoot ?? null;
  for (const p of typeof pkg === 'string' || pkg === null ? [pkg] : pkg) add(p);
  for (const t of input.tmpRoots ?? []) add(t);
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
  repoRoot: string,
  home: string = homedir()
): string[] | null {
  if (!toolName || !READ_TOOL_NAMES.includes(toolName)) return null;
  const raw = (toolCall?.rawInput ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : '');
  // V2-8.9 H1 — Claude Code's spelling (agent-path.ts): `~` is the home folder, not `<repo>/~`. A
  // path spelled so readers may disagree (spaces around it, a leading `~`) or with a NUL → the card.
  const abs = (p: string): string | null => {
    const a = agentPath(p, repoRoot, home);
    return a && !a.odd ? a.abs : null;
  };
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
      if (climbs(g) || g !== g.trim() || g.startsWith('~') || g.includes('\0')) return null;
      const b = abs(base);
      if (!b) return null;
      // L3 — an absolute pattern is judged by its own prefix, whatever `path` says.
      const joined = isAbsolute(g) ? g : join(b, g);
      named.push(joined.split(/[*?[{]/)[0] || b);
    }
  }
  if (Array.isArray(toolCall?.locations)) {
    for (const l of toolCall.locations as Array<{ path?: unknown }>) {
      if (typeof l?.path === 'string' && l.path) named.push(l.path);
    }
  }
  if (named.some(climbs)) return null;
  const out: string[] = [];
  for (const n of named) {
    const a = abs(n);
    if (!a) return null;
    out.push(a);
  }
  return out;
}

/** V2-8.9 L2 — shell commands that only read. Their "Always allow" becomes `Bash(cat:*)` & co. */
export const READ_ONLY_BASH: ReadonlySet<string> = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'bat',
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'ag',
  'ls',
  'tree',
  'find',
  'fd',
  'file',
  'stat',
  'wc',
  'du',
  'xxd',
  'od',
  'hexdump',
  'strings',
  'nl',
  'sort',
  'uniq',
  'diff',
  'cmp',
  'md5',
  'shasum',
  // V2-8.9 re-check 2 L5 — these read too (cp and sed -i also write: this list only ever takes
  // `Always allow` off a card, it never approves anything)
  'jq',
  'yq',
  'sed',
  'awk',
  'gawk',
  'cut',
  'tr',
  'base64',
  'cp',
  'rsync',
  'zcat',
  'tar',
  'unzip',
  'plutil',
  'openssl',
]);
/**
 * V2-8.9 re-check 2 L5 — interpreters: the paths they read live inside their code, where no word
 * test can see them, so a card for one never offers a standing rule.
 */
const INTERPRETERS = new Set([
  'python',
  'python3',
  'perl',
  'ruby',
  'node',
  'bun',
  'deno',
  'osascript',
]);
const SHELL_WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'nice', 'xargs']);

/**
 * V2-8.9 L2 — does a shell command run a read-only reader (`READ_ONLY_BASH`) on a path outside
 * `roots`? Then its card must not offer "Always allow": the adapter would install a standing
 * `Bash(cat:*)` rule that reads anywhere, outside the folder consent. Generous on purpose (a pattern
 * word that looks like an outside path also counts) — this only ever removes the standing option.
 */
export function bashReadsOutside(
  command: string,
  repoRoot: string,
  roots: readonly string[],
  home: string = homedir()
): boolean {
  for (const seg of command.split(/[;&|\n]+/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let k = 0;
    while (
      k < words.length &&
      (/^[A-Za-z_]\w*=/.test(words[k] ?? '') || SHELL_WRAPPERS.has(words[k] ?? ''))
    )
      k++;
    const head = (words[k] ?? '').split('/').pop() ?? '';
    if (INTERPRETERS.has(head)) return true;
    if (!READ_ONLY_BASH.has(head)) continue;
    for (let w of words.slice(k + 1)) {
      w = w.replace(/^['"]|['"]$/g, '');
      if (w.startsWith('-')) {
        const eq = w.indexOf('=');
        if (eq < 0) continue;
        w = w.slice(eq + 1);
      }
      w = w.replace(/^\$\{?HOME\}?(?=\/|$)/, '~');
      if (!w) continue;
      // any other variable: where it points is unknown here — no standing rule for it
      if (w.startsWith('$')) return true;
      const a = agentPath(w, repoRoot, home);
      if (!a) continue;
      const real = resolveRealPath(a.abs, repoRoot);
      if (!roots.some((r) => r === real || isInsideRoot(real, r))) return true;
    }
  }
  return false;
}

/**
 * Universal ACP (B3/F5, contract rule 7) — the readers a `shellGate:'command-text'` agent's shell
 * request may be APPROVED once for. A strict subset of `READ_ONLY_BASH`: that list only ever takes
 * "Always allow" off a card, so it carries writers (`cp`, `sed -i`, `tar`) and readers that run a
 * program (`find -exec`, `rg --pre`) or write a file (`tree -o`, `sort -o`, `xxd in out`). None here
 * does either, whatever its options.
 */
export const APPROVABLE_READ_BASH: ReadonlySet<string> = new Set([
  'cat',
  'head',
  'tail',
  'wc',
  'ls',
  'stat',
  'grep',
  'egrep',
  'fgrep',
  'nl',
  'cmp',
  'diff',
  'strings',
  'du',
]);

/**
 * The words of a ONE-command shell line with no expansion anywhere, or null. Anything a word test
 * cannot follow — an operator, a redirect, a variable, a substitution, an escape, a glob, `~`, a
 * brace, history, a newline, an unterminated quote — is null, and every caller reads null as "ask".
 */
export function plainWords(command: string): string[] | null {
  if (!command || /[;&|<>$`()\\{}\n\r*?[\]~!]/.test(command)) return null;
  const words: string[] = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (c === "'" || c === '"') {
      const j = command.indexOf(c, i + 1);
      if (j === -1) return null;
      word += command.slice(i + 1, j);
      inWord = true;
      i = j;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/**
 * The command-text approval (contract rule 7): `command` is ONE plain call of an
 * `APPROVABLE_READ_BASH` reader (by bare name), every argument that is not a flag — and every
 * `--opt=value` — names a path that resolves, from `cwd`, inside `roots`, and `cwd` itself lies in
 * them. A flag glued to a path (`-f/etc/x`) is not judged: it asks. Same word judgment as
 * `bashReadsOutside` (agent-path.ts spelling, realpath against the roots), in the approve direction.
 */
export function bashReadOnlyInside(
  command: string,
  cwd: string,
  roots: readonly string[],
  home: string = homedir()
): boolean {
  const words = plainWords(command);
  const head = words?.[0];
  if (!words || !head || !APPROVABLE_READ_BASH.has(head)) return false;
  const inside = (abs: string) => {
    const real = resolveRealPath(abs, cwd);
    return roots.some((r) => r === real || isInsideRoot(real, r));
  };
  if (!isAbsolute(cwd) || !inside(resolve(cwd))) return false;
  for (let w of words.slice(1)) {
    if (w.startsWith('-')) {
      const eq = w.indexOf('=');
      if (eq < 0) {
        if (w.includes('/') || w.includes('.')) return false;
        continue;
      }
      w = w.slice(eq + 1);
    }
    if (!w) continue;
    const a = agentPath(w, cwd, home);
    if (!a || a.odd || !inside(a.abs)) return false;
  }
  return true;
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
