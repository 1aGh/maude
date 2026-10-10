// The ACP write-path scope gate (feature-acp-write-path-scope).
//
// WHY THIS FILE EXISTS
// -------------------
// DDR-184 put `Edit` / `Write` / `NotebookEdit` on `MAUDE_DEFAULT_ALLOWED_TOOLS`
// as bare tool names, which means the CLI approves them itself and the bridge's
// `requestPermission` gate is never called at all. The justification recorded in
// bridge.ts was that "edits land in the served project (already the edit target)
// and are reversible via the `_history/` snapshot stack" — BOTH halves of which
// are true only INSIDE the project, and nothing enforced that. A write to
// `~/.zshenv`, `~/Library/LaunchAgents/*.plist` or `~/.config/environment.d/*.conf`
// was auto-approved silently, with no prompt and no rollback. That is the
// delivery primitive behind the A2 finding of the 2026-08-04 attacker pass
// (untrusted DDR-054 project content steering the auto-approving session into one
// file write that moves `MAUDE_CLOUD_URL`, which governs both the sidecar's
// bearer-token destination and a native OS opener).
//
// The fix moves the decision rather than widening the name list: the three write
// tools come OFF the allow-list, and `requestPermission` auto-approves them —
// with no prompt, exactly preserving DDR-184's goal — when and only when every
// resolved target lands inside the session's pinned project root. Everything else
// goes to the prompt that already exists.
//
// WHAT THE ADAPTER ACTUALLY SENDS (measured 2026-08-07 against
// @agentclientprotocol/claude-agent-acp@0.57.0 — plan Task 1; do NOT re-derive
// this from the ACP type declarations, they disagree with the implementation)
// -------------------------------------------------------------------------
//  1. `toolCall.locations[].path` for `Write`/`Edit` is `input.file_path`
//     VERBATIM (`dist/tools.js` — `locations: input?.file_path ? [{ path:
//     input.file_path }] : []`). The adapter does NOT normalize, absolutize, or
//     validate it, despite the SDK's own `types.gen.d.ts:568-572` describing the
//     field as "The absolute file path being accessed or modified". So:
//       • a relative path is possible and MUST be resolved against the session
//         `cwd` (which `newSessionParams` pins to the repo root), and
//       • the plan's "cross-check `locations[].path` against `rawInput.file_path`"
//         is TAUTOLOGICAL for these two tools — they read the same field. The
//         cross-check is kept anyway (a non-compliant/hostile adapter is exactly
//         the case a fail-closed gate is for), but nobody should mistake it for
//         load-bearing corroboration between two independent sources.
//  2. `NotebookEdit` has NO case in the adapter's tool mapper at all — it falls
//     through to `case "Other"`, which emits **no `locations` whatsoever**. The
//     `rawInput` fallback is therefore MANDATORY, not a defensive nicety, and
//     the relevant field is `notebook_path`, not `file_path`.
//  3. The permission request does NOT carry the tool NAME. `requestPermission`'s
//     `toolCall` is built inline as `{ toolCallId, rawInput, ...toolInfoFromToolUse(…) }`
//     (`dist/acp-agent.js:2270-2286`) and `toolInfoFromToolUse` returns only
//     title/kind/content/locations. The name rides ONLY on the streamed
//     `tool_call` / `tool_call_update` notification, as
//     `_meta.claudeCode.toolName` (`dist/acp-agent.js:3808-3829`) — which the
//     adapter guarantees is emitted BEFORE the permission request (
//     `requestPermissionFromClient` awaits `ensureToolCallEmitted` first). That
//     is why the caller passes `toolName` in rather than sniffing `kind`/`title`:
//     `kind: 'edit'` is shared with any future edit-shaped tool, and `title` is
//     a display string. An unknown name simply fails closed to the prompt.
//
// Pure + dependency-free on purpose: unit-testable without a session, a
// subprocess, or a bridge (test/acp-write-scope.test.ts).

import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The tools this gate scopes. Bare names as they arrive on
 * `_meta.claudeCode.toolName`.
 *
 * `MultiEdit` is included defensively — it is not a tool the current Claude Code
 * ships, but it has existed, its input shape is `file_path`-keyed like `Edit`,
 * and the cost of listing a tool that never fires is zero while the cost of
 * missing one is an unscoped write. It is NOT on `MAUDE_DEFAULT_ALLOWED_TOOLS`
 * either way, so listing it here can only ever ADD a scope check, never a grant.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

export function isWriteToolName(name: unknown): boolean {
  return typeof name === 'string' && WRITE_TOOL_NAMES.has(name);
}

/** Why a write was (or wasn't) judged in-project — surfaced in the prompt + tests. */
export type WriteScopeReason =
  /** Every resolved target is inside the pinned root — auto-approve. */
  | 'inside'
  /** At least one resolved target is outside the pinned root. */
  | 'outside'
  /** No path could be extracted at all — fail closed. */
  | 'no-target'
  /** `locations[]` and `rawInput` named different files — fail closed. */
  | 'disagreement'
  /** Inside the root, but under a path that reaches EXECUTION — see
   *  `PROTECTED_IN_PROJECT`. In-project is a necessary condition for
   *  auto-approval, not a sufficient one. */
  | 'in-project-denied';

export interface WriteScopeVerdict {
  /** True ONLY when every resolvable target is inside the pinned project root. */
  inside: boolean;
  reason: WriteScopeReason;
  /** The RESOLVED absolute paths, deduped, in discovery order. What the prompt
   *  must render — never the model's own string (`docs/../../../.zshenv` reads
   *  as harmless in a prompt; its resolution does not). Empty for `no-target`. */
  resolved: string[];
}

/**
 * Paths that are INSIDE the project and must still never be auto-approved.
 *
 * SECURITY (ethical-hacker A1, CRITICAL) — the feature's premise is that an
 * in-project write is safe because it "lands in the served project (already the
 * edit target) and is reversible via the `_history/` snapshot stack". These are
 * the named exception class where BOTH halves are false: not the edit target,
 * and `_history/` snapshots canvases under `<designRoot>` — nothing here. The
 * corrected rule: **in-project is NECESSARY for auto-approval, not SUFFICIENT.**
 *
 * The concrete chain, which is why this is a blocker and not a residual — it is
 * TWO ordinary auto-approved writes and needs no second tool and no user action:
 *   1. `Write <root>/.git/config` → `[core] fsmonitor = "sh /path/payload"`.
 *   2. `Write <any canvas>.tsx` — the thing the session does all day. `git/watch.ts`
 *      `isVersionable()` matches `.tsx` → debounce → `gitStatus(repoRoot)` →
 *      `service.ts` `statusSystem` (the DDR-133 default whenever a `git` binary
 *      is on PATH, not an opt-in) → `spawn('git', ['status', …])` in the repo
 *      whose config was just rewritten. Git refreshes the index, which invokes
 *      `core.fsmonitor` THROUGH A SHELL.
 * Shell invocation is what makes `.git/config` the vector rather than
 * `.git/hooks/*`: `Write` creates 0644 and the session has no `chmod`, so a hook
 * is inert — but `fsmonitor` needs no executable bit. Sibling keys reach the same
 * place on other triggers (`credential.helper`/`core.askPass` on fetch,
 * `diff.external`/`core.pager` on the Changes panel, `filter.*.smudge` paired
 * with an in-project `.gitattributes` on checkout), so this is a class of
 * triggers over ONE write, not a single key to patch.
 *
 * Each entry, and why it is not merely tidiness:
 *  • `.git` — the above. Matched as a path SEGMENT AT ANY DEPTH, not just the
 *    first: a nested checkout, a submodule, or `sub/.git/config` is the same
 *    primitive one directory down.
 *  • `.gitattributes` / `.gitmodules` — the other half of `filter.*.smudge`, and
 *    submodule URLs; both are read by git without being under `.git/`.
 *  • `.claude` — settings, hooks, skills, commands. DDR-144's
 *    `settingSources:['user']` stops the ACP session reading the PROJECT copy
 *    (verified), but a plain `claude` the user opens in this repo does read it,
 *    so the write steers a FUTURE session with wider permissions.
 *  • `CLAUDE.md` — read via a separate path from `settingSources`, i.e. the
 *    narrowing does NOT cover it. One write loads an injection into every future
 *    session in this repo, including the user's own terminal.
 *  • `.mcp.json` — project MCP server definitions; a new server is new tools.
 *  • `node_modules` — a write executes at the next import, and this process
 *    imports from there constantly.
 *  • `package.json` + lockfiles — `scripts` run on install/build/test.
 *
 *  • `.envrc` — direnv executes it on `cd` into the repo. The lowest bar of
 *    anything here: no app action, no git operation, no user click beyond
 *    entering the directory in a shell.
 *  • `.vscode` — `settings.json`'s `terminal.integrated.env.*` and `tasks.json`'s
 *    `runOn: folderOpen` execute when the user opens the project in their
 *    editor, which is the most likely thing they do next after opening a design
 *    project.
 *
 * THE PREDICATE, recorded so this list is extended by RE-DERIVATION rather than
 * by pattern-matching the entries above: **an in-project path that reaches
 * execution without a further agent action.** If you add something, add the
 * reasoning that found it, not just the string.
 *
 * Deliberately NOT a broad denylist: every entry costs a prompt on a genuinely
 * in-project path, and prompt fatigue is itself a security failure. Equally
 * deliberately, this is a SHAPE and not a proof of completeness — the plan's own
 * recurring-enumeration warning applies here verbatim. In-project `*.sh` that the
 * helper surface executes is a known member NOT covered. The helper surface used
 * to be reached via `Bash(maude:*)`, accepted as an arbitrary-code-execution
 * surface; since V2-2.8 S4 only auto-tier verbs are allowed (actions/verbs.ts),
 * and the verbs that run model-authored code (`draw-build`, `to-lottie`) prompt.
 */
export const PROTECTED_IN_PROJECT: readonly string[] = [
  '.git',
  '.gitattributes',
  '.gitmodules',
  '.claude',
  'CLAUDE.md',
  '.mcp.json',
  '.envrc',
  '.vscode',
  'node_modules',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];

/**
 * Protected path PREFIXES — matched as a leading run of segments rather than a
 * single segment, for the case where the parent must stay writable.
 *
 * `.github/workflows/**` executes in CI with the repository's secrets, and THIS
 * APP SHIPS THE TRIGGER: "Save version" → "Publish" (`/_api/git/commit` →
 * `/_api/git/push`) is a two-click path from an auto-approved workflow write to
 * CI execution. But `.github/` itself holds ordinary versioned files
 * (ISSUE_TEMPLATE, CODEOWNERS, dependabot.yml), so a segment match on `.github`
 * would deny normal work — hence a prefix rule for this one.
 */
export const PROTECTED_PREFIXES: readonly string[][] = [['.github', 'workflows']];

/**
 * True when `target` (resolved, already known to be inside `root`) touches a
 * protected path. Segment-wise at ANY depth, never a prefix compare: a prefix
 * would catch `.gitignore` and `.github/` (ordinary files) — the same
 * sibling-prefix bug as the root check itself — while missing `sub/.git/config`,
 * which is the real thing one directory down.
 */
export function isProtectedInProject(target: string, root: string): boolean {
  // SECURITY (ethical-hacker A6) — fold UNCONDITIONALLY, not just on win32.
  //
  // `realpathSync.native` canonicalizes the casing of components that EXIST on
  // disk, which is why `.GIT/config` resolves to `.git/config` and is caught.
  // But a protected path that does NOT yet exist falls back to
  // `<realpath of nearest existing ancestor> + the trailing segments verbatim`,
  // so the caller's casing survives into this comparison — and macOS's default
  // filesystem is case-INSENSITIVE, so `.CLAUDE/settings.json` is the same file
  // as `.claude/settings.json`. Measured on the shipped module: `claude.md`,
  // `.CLAUDE/settings.json` and `.MCP.json` were all auto-approved while their
  // lowercase forms were denied. In a typical design project `.claude/`,
  // `CLAUDE.md`, `.mcp.json`, `.gitattributes` and `.gitmodules` are all ABSENT,
  // so every one of them was reachable by pressing shift.
  //
  // Cost on a case-SENSITIVE filesystem: a genuine file named `.Git` or
  // `Claude.md` now prompts. That is the right direction — a case-variant of a
  // protected name is never a legitimate distinct file, and this check only ever
  // ADDS a prompt.
  //
  // Deliberately NOT applied to `isInsideRoot`: that one is a CONTAINMENT check,
  // where folding on a case-sensitive filesystem could wrongly judge a sibling
  // directory as inside. Opposite risk, opposite default.
  const fold = (v: string) => v.toLowerCase();
  const rel = relative(fold(root), fold(target));
  if (!rel || isAbsolute(rel)) return false;
  const segments = rel.split(sep);
  if (segments.some((seg) => PROTECTED_IN_PROJECT.some((p) => fold(p) === seg))) return true;
  return PROTECTED_PREFIXES.some((prefix) => prefix.every((seg, i) => fold(seg) === segments[i]));
}

/** The `rawInput` keys a write tool can carry its target on. `file_path` is
 *  Write/Edit/MultiEdit; `notebook_path` is NotebookEdit (which, per the header,
 *  emits no `locations` at all so this is its ONLY source); `path`/`abs_path`
 *  are belt-and-braces for a tool that renames the field. Order matters only for
 *  tie-breaking the discovery order in `resolved`. */
const RAW_INPUT_PATH_KEYS = ['file_path', 'notebook_path', 'path', 'abs_path', 'filePath'] as const;

interface ToolCallLike {
  toolCallId?: unknown;
  locations?: Array<{ path?: unknown } | null> | null;
  rawInput?: unknown;
}

/** Every path string the tool call names, split by where it came from. Kept
 *  separate so `writeTargetsInsideProject` can run the (today tautological, see
 *  header) locations-vs-rawInput cross-check before collapsing them. */
function collectTargets(toolCall: ToolCallLike | null | undefined): {
  fromLocations: string[];
  fromRawInput: string[];
} {
  const fromLocations: string[] = [];
  const locations = toolCall?.locations;
  if (Array.isArray(locations)) {
    for (const l of locations) {
      const p = l?.path;
      if (typeof p === 'string' && p) fromLocations.push(p);
    }
  }
  const fromRawInput: string[] = [];
  const raw = toolCall?.rawInput;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of RAW_INPUT_PATH_KEYS) {
      const p = (raw as Record<string, unknown>)[key];
      if (typeof p === 'string' && p) fromRawInput.push(p);
    }
  }
  return { fromLocations, fromRawInput };
}

/**
 * Resolve `p` to a real absolute path, following symlinks as far as the
 * filesystem actually goes.
 *
 * A write target routinely does NOT exist yet (that is what `Write` is for), and
 * `realpathSync` throws on a missing path — so walk UP to the nearest existing
 * ancestor, resolve THAT, and re-join the non-existent remainder. The parent
 * decides, which is the correct semantic: creating `<symlink-to-/etc>/x.conf`
 * must be judged against `/etc`, not against the symlink's own location.
 *
 * Falls back to the lexically-resolved path if nothing up the chain resolves
 * (a fully non-existent root, or an EACCES walking up) — lexical resolution
 * still collapses `..`, so the fallback is strictly safer than the raw input,
 * just less thorough than a realpath.
 */
export function resolveRealPath(p: string, base: string): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
  const trailing: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      // `.native` so Windows resolves 8.3 short names (`PROGRA~1`) and drive
      // casing to their canonical long form BEFORE any comparison — a documented
      // bypass class for prefix-style path checks.
      const real = realpathSync.native(cur);
      return trailing.length ? join(real, ...trailing) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs; // hit the filesystem root without resolving
      trailing.unshift(basename(cur));
      cur = parent;
    }
  }
}

/**
 * True when `target` (already resolved) sits strictly INSIDE `root`.
 *
 * Deliberately `path.relative`, never `startsWith(root)`: a prefix compare also
 * matches `/repo-evil` against a root of `/repo` — the classic sibling-prefix
 * bug. The relative path must be non-empty (the root ITSELF is not a file write
 * target), must not be absolute (different drive/root on Windows), and must not
 * climb out via `..`.
 *
 * Windows is compared case-insensitively. `path.relative` already lowercases the
 * drive letter on win32, but not the rest of the path, so `C:\Repo\x` vs
 * `C:\repo` would otherwise produce a spurious `..\Repo\x`. Both sides have
 * already been through `realpathSync.native`, so short names and casing are
 * canonical by this point; the fold is belt-and-braces for a filesystem that
 * canonicalizes differently than the directory entry.
 */
export function isInsideRoot(target: string, root: string): boolean {
  const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const rel = relative(fold(root), fold(target));
  if (!rel) return false;
  if (isAbsolute(rel)) return false;
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false;
  return true;
}

/**
 * Resolve a repo root ONCE, at bridge construction, into the value every later
 * containment check compares against.
 *
 * Task 11 / Solution E — this is deliberately a separate, eagerly-computed
 * value rather than a read of `opts.repoRoot` at check time. A session that
 * outlives a project switch (see the plan's Addendum) must keep the write scope
 * of the project it was CREATED in; it must never acquire the currently-open
 * project's scope. Recomputing at check time is exactly the refactor that would
 * silently break that.
 */
export function pinScopeRoot(repoRoot: string): string {
  return resolveRealPath(repoRoot, process.cwd());
}

/**
 * The gate. Auto-approve is granted ONLY on `{ inside: true }`.
 *
 * `toolName` is required and must come from the streamed `tool_call`'s
 * `_meta.claudeCode.toolName` — see the header for why it is not derivable from
 * the permission request itself. A name that isn't a known write tool returns
 * `inside: false` with reason `no-target`: this helper never grants anything it
 * wasn't explicitly asked about.
 *
 * `scopeRoot` must be the value from `pinScopeRoot` (already realpath-resolved).
 * Passing a raw, unresolved root would compare a symlinked root against resolved
 * targets and reject every legitimate in-project write.
 */
export function writeTargetsInsideProject(
  toolCall: ToolCallLike | null | undefined,
  scopeRoot: string,
  toolName: unknown
): WriteScopeVerdict {
  if (!isWriteToolName(toolName)) return { inside: false, reason: 'no-target', resolved: [] };
  return resolveWriteTargets(toolCall, scopeRoot);
}

/**
 * Does this tool call LOOK like a write, without knowing its name?
 *
 * SECURITY (security-auditor F2) — the name-gated `writeTargetsInsideProject`
 * above fails closed for the GRANT but was failing OPEN for the HARDENING: an
 * unknown name meant no `scope` on the frame, which meant `allow_always` was NOT
 * stripped (one click installs a session-wide standing rule for `Write` —
 * Decision D defeated) and the card fell back to `toolCall.title`, i.e. the
 * model's own `Write docs/../../../.zshenv`. Both protections were riding on the
 * strict name check, which is the wrong coupling: granting must be strict,
 * warning must be generous.
 *
 * Deliberately NOT "`rawInput` has a `file_path`" — `Read` carries one too, and
 * a Read of an out-of-project file would then get "Claude wants to write a file
 * outside this project", a claim the server never made, plus its `allow_always`
 * stripped for no reason. `kind: 'edit'` is what the adapter sets for
 * Write/Edit (`toolInfoFromToolUse`), and `notebook_path` is NotebookEdit's
 * signature (it has no case in the mapper, so it arrives as `kind: 'other'`).
 */
export function looksLikeWriteToolCall(toolCall: ToolCallLike | null | undefined): boolean {
  if (!toolCall) return false;
  if ((toolCall as { kind?: unknown }).kind === 'edit') return true;
  const raw = toolCall.rawInput;
  return !!raw && typeof raw === 'object' && 'notebook_path' in (raw as Record<string, unknown>);
}

/**
 * The path half of the gate, WITHOUT the tool-name check.
 *
 * Split out so the caller can apply the two different bars the auditor's F2
 * asks for: a STRICT name match to auto-approve, and a GENEROUS one to strip
 * `allow_always` and render resolved paths. Never call this directly to decide
 * a grant — `writeTargetsInsideProject` is the grant entry point.
 */
export function resolveWriteTargets(
  toolCall: ToolCallLike | null | undefined,
  scopeRoot: string
): WriteScopeVerdict {
  const { fromLocations, fromRawInput } = collectTargets(toolCall);
  if (fromLocations.length === 0 && fromRawInput.length === 0) {
    // A write tool arriving with nothing resolvable is treated as out-of-project
    // — the gate's fail-closed default. It costs a prompt on a malformed call,
    // which is the cheap direction to be wrong in.
    return { inside: false, reason: 'no-target', resolved: [] };
  }

  // Resolve BOTH sources before comparing them. Comparing the raw strings would
  // call `./x.tsx` and `/repo/x.tsx` a disagreement when they are the same file.
  const resolvedLocations = fromLocations.map((p) => resolveRealPath(p, scopeRoot));
  const resolvedRawInput = fromRawInput.map((p) => resolveRealPath(p, scopeRoot));

  // Cross-check (see the header — tautological against today's adapter, kept
  // because a gate whose whole job is fail-closed should not assume a
  // well-behaved counterparty). If BOTH sources named something and their sets
  // differ at all, we cannot say which one the CLI will actually write, so we
  // refuse to auto-approve either.
  if (resolvedLocations.length > 0 && resolvedRawInput.length > 0) {
    const a = new Set(resolvedLocations);
    const b = new Set(resolvedRawInput);
    const agree = a.size === b.size && [...a].every((p) => b.has(p));
    if (!agree) {
      return {
        inside: false,
        reason: 'disagreement',
        resolved: [...new Set([...resolvedLocations, ...resolvedRawInput])],
      };
    }
  }

  const resolved = [...new Set([...resolvedLocations, ...resolvedRawInput])];
  // EVERY target must pass — a multi-location write with one escape is an escape.
  const inside = resolved.every((p) => isInsideRoot(p, scopeRoot));
  if (!inside) return { inside: false, reason: 'outside', resolved };
  // Inside is NECESSARY but not SUFFICIENT. A write under `.git/` or `.claude/`
  // is in-project and still reaches execution, so it goes to the prompt like any
  // out-of-project write would. See PROTECTED_IN_PROJECT.
  if (resolved.some((p) => isProtectedInProject(p, scopeRoot))) {
    return { inside: false, reason: 'in-project-denied', resolved };
  }
  return { inside: true, reason: 'inside', resolved };
}
