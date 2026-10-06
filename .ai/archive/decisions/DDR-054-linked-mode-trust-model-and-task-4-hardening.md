## DDR-054 — Linked-mode trust model + Task 4 hardening (CI-gate, .tsx-refusal, scheme-allowlist, symlink-safe writes, size caps, schema guards, deferred architectural items)

- **Status:** Accepted — 2026-05-27
- **Authors:** 1aGh (with security-auditor + ethical-hacker subagent input on c21c7d4)
- **Phase:** 9 (self-hostable hub + file sync)
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** [DDR-060](./DDR-060-tsx-only-format-breaks-html-centric-sync.md) — §2b's ".tsx not synced, .html still works" mitigation is invalidated by the TSX-only format migration (Phase 3.6): `.tsx` is the **only** canvas format, so "only `.html` syncs" now means **nothing syncs** in a real project. See DDR-060 for the contradiction + remediation sequencing.
- **Related:**
  - [DDR-047](./DDR-047-collab-scope-cut-no-lan-mode-hub-admin-ui.md) — collab scope cut + hub admin UI decision
  - [DDR-051](./DDR-051-collab-persistence-json-snapshot-at-quiescence.md) — JSON snapshot canonical + .ydoc.bin cache
  - [DDR-052](./DDR-052-hocuspocus-over-partykit-for-hub.md) — Hocuspocus over PartyKit
  - [DDR-053](./DDR-053-hub-admin-auth-architecture.md) — Bearer-only admin auth + scope-bound tokens
  - Phase 9 plan §Task 4 (bidi fs sync — this slice) + §Task 5 (awareness over WSS) + §Task 6 (auth + transport hardening) + §Task 8 (conflict UX + hub-down offline mode)
- **Audit reports linked:**
  - Defender: `.ai/logs/security-reviews/phase-9-task-4-bidi-fs-sync-defender.md` (0 blockers above medium floor, 2 medium follow-ups)
  - Attacker: `.ai/logs/security-reviews/phase-9-task-4-bidi-fs-sync-attacker.md` (1 CRITICAL + 4 HIGH chained findings, 4 exploit chains)

## Context

Phase 9 Task 4 shipped the bidirectional file-sync agent in commit `c21c7d4`. Static code review (defender pass) found 0 blockers above the medium floor. The adversarial pass (ethical-hacker) promoted findings to CRITICAL + HIGH by composing the new code with **pre-existing dev-server behavior** that the in-isolation defender doesn't see:

- `plugins/design/dev-server/http.ts` serves `.design/*.html` as `Content-Type: text/html` from `localhost:<port>` origin with **no CSP, no `X-Frame-Options`, no iframe `sandbox` attribute** (verified by grep across the dev-server tree).
- `serveCanvasTsx` transpiles `.tsx` canvas files via `Bun.Transpiler` and returns them as `application/javascript` — the dev-server's importmap pulls these into the iframe; **the module body executes**.
- Claude Code on every collaborator's machine reads `.design/**/*.{tsx,html,md,json}` into context for `/design:edit`, `/design:new`, code-review prompts, etc.

Before Task 4, every byte under `<designRoot>/*.{html,tsx}` had exactly two writers (local user + local dev-server) ⇒ filesystem trust = OS user trust. Solo mode (no `linkedHub` in `.design/config.json`) preserves this. Linked mode **introduces a remote network actor (the hub operator + anyone who can MITM the WS connection) as an additional writer with the same privilege as the local user.** Every finding in the attacker report flows from this structural promotion.

The CRITICAL (F1) is: a hostile hub pushes Y.Text containing JSX → sync agent writes verbatim to `<slug>.tsx` → dev-server serves it as `application/javascript` in iframe same-origin → arbitrary fetches to `/_api/*`, the WebSocket cursor stream, internal LAN, cloud-metadata IMDS, `localhost:<other-port>` debuggers — full XSS with persistent foothold and trifecta-class prompt-injection into adjacent Claude Code sessions (F3).

**The slice cannot be reverted in isolation** — the code is otherwise clean (defender confirmed) and the linked-mode story IS the v1.1 collaboration deliverable. The realistic threat path requires the user to explicitly run `maude design link <attacker-url> --token <X>` (two-step social engineering — Task 3's CLI surface, not Task 4's). Phase 9 is not yet user-shippable: Tasks 5 (awareness over WSS), 6 (auth hardening), 7 (deploy templates), 8 (conflict UX + offline), 9 (gitignore DDR), 10 (contributor docs), 11 (stress matrix) all remain. **Hardening therefore lands as a follow-up commit on top of c21c7d4 + a pinned trust-model DDR rather than a revert.**

This DDR pins the trust model so each subsequent Phase 9 task inherits a clear contract, lists the immediate fixes this hardening pass applies, and maps the deferred architectural items to their natural-home phase tasks.

## Decision

### 1. Linked-mode trust model (pinned, v1.1)

**The hub is semi-trusted.** Concretely:

| Trust dimension | Verdict |
| --- | --- |
| Hub can read Y.Doc state for documents the token authorizes | YES — by design (this IS the sync) |
| Hub can broadcast Y.Doc updates that the agent commits to disk verbatim | YES — by design (this IS the sync, in reverse) |
| Hub-pushed content is treated as untrusted input to the local filesystem | YES — same posture as `git pull` from a remote branch |
| Hub controls what file types it can mutate | **Limited to `.html`, `_comments/<slug>.json`, `<slug>.annotations.svg`** (this DDR closes `.tsx`). *Amended by [DDR-242](./DDR-242-annotations-v2-element-model.md): the annotations file is now `<slug>.annotations.json`; a stale `.svg` is migrated to `_trash/annotations-v1/`.* |
| Hub-pushed file content is rendered as HTML/JS in the iframe origin | **Deferred to Task 8 (CSP + iframe sandbox)** — DOCUMENTED RISK until then |
| Hub-pushed content lands in files Claude Code reads as context | **Deferred to Task 6 (`.claudeignore` strategy + linked-mode README banner)** — DOCUMENTED RISK until then |
| Token (`~/.config/maude/hubs.json`) is per-machine, 0600, never committed | YES — invariant (CLI writes 0600; this DDR adds read-time mode-check warn) |
| Hub URL (`.design/config.json.linkedHub.url`) is git-tracked + reviewed in PR | YES — invariant (no schema change) |
| `maude design link <url>` against a non-localhost URL requires explicit user opt-in | **Deferred to Task 6 (interactive `[y/N]` prompt + trust-allowlist)** — DOCUMENTED RISK until then |
| Hub-relayed **awareness** fields (name/color/cursor/selection) are untrusted input to the browser render sinks | YES — sanitized at the `useForeignAwareness` chokepoint (Task 5 hardening; color re-derived locally not trusted, cssPath restricted to the locator grammar incl. functional-pseudo-class rejection to kill `:has()` selector-complexity DoS, name control/bidi-stripped + length-capped, cursor/viewport finite-gated, peer + annotation counts capped). **Accepted residual:** a legit-grammar `cssPath` still resolves against the local canvas DOM, so a hub peer can infer element presence (a halo renders or not) — a DOM-recon oracle bounded to the shared canvas, with no outbound channel (color exfil closed). Acceptable under the semi-trusted model |
| Hub operator can observe the local user's real-time **presence** side-channel (git name, cursor coords, selection focus, active hours) via the awareness relay | YES — by design, now NAMED (added Task 5). Awareness is bidirectional + continuous; a curious/hostile hub gets a behavioural feed even with no doc edits. Acceptable for "hubs you operate or fully trust"; a name/cursor privacy toggle is a v1.2 candidate |

**F1 residual re-evaluation (Task 5):** the "rendered as HTML/JS in the iframe origin" row (deferred to Task 8 CSP) was triaged as low-likelihood because it required the victim to *open a hostile canvas*. Task 5's awareness relay weakens that containment: with no CSP/`connect-src` on the canvas origin, a hub-controlled awareness `color` value could fire an outbound `url(...)` beacon on mere peer **presence** (no canvas-content interaction). The Task 5 hardening closes this *specific* lane by discarding the wire `color` and re-deriving it locally — but the architectural backstop is still Task 8's CSP, which **must include `connect-src`/`img-src`** restriction, not just `script-src`. Recorded so Task 8 scopes the CSP correctly.

**Threshold for "user-shippable linked mode":** the four DOCUMENTED RISK rows must all flip to "yes — invariant" before the next-major release tags linked mode as supported for general use. Until then, the README's linked-mode section must carry an unmissable banner: *"Linked mode is an experimental v1.1 preview. Only link to hubs you operate or fully trust. See DDR-054 for the trust model."*

### 2. Hardening this slice applies (immediate, in the same hardening commit)

Each fix below targets a specific finding ID from the audit reports. Each is single-file or single-line; tests update alongside.

#### 2a. CI environment gate in `createSyncRuntime` (F-creative-1, attacker §"Adversarial-creativity finding")

```ts
// sync/index.ts createSyncRuntime() — at the top, after the unlinked check:
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  console.warn(`[sync] disabled in CI environment (CI=${!!process.env.CI}, GITHUB_ACTIONS=${!!process.env.GITHUB_ACTIONS})`);
  return null;
}
```

Closes the supply-chain side-door where a future CI workflow runs `maude design serve` and a PR-controlled `linkedHub.url` silently grants a remote actor write access in an environment carrying `GITHUB_TOKEN`. Override via `MAUDE_SYNC_IN_CI=1` for a future legitimate CI-side use case (none today).

#### 2b. Refuse `.tsx` over the wire (F1 worst lane — partial mitigation)

```ts
// sync/index.ts discoverCanvases() walk(): filter to .html only when registering for sync
// (existing code finds both .tsx and .html; we keep the file-tree discovery
// but skip .tsx canvases when building agents)
```

Rationale: the F1 RCE is sharper for `.tsx` (transpile-and-execute) than for `.html` (still bad — XSS in same-origin — but Task 8's CSP+sandbox closes that). Refusing `.tsx` for sync now removes the worst lane without waiting for the cross-slice CSP work. `.tsx` canvases stay editable solo, just not synced. Future opt-in via per-canvas `.meta.json.syncable: true` if a project explicitly needs it (deferred to Task 8).

> **⚠ Amended by [DDR-060](./DDR-060-tsx-only-format-breaks-html-centric-sync.md) (2026-05-28):** this paragraph's "existing code finds both .tsx and .html" / ".tsx stays editable solo, just not synced" framing was already stale when written — Phase 3.6 (2026-05-18) made `.tsx` the **only** canvas format. So "only `.html` syncs" means **sync is a no-op for every real project** (`discoverCanvases()` returns `[]` → no peer, no `_sync.json`). The deferred `.meta.json.syncable` opt-in never shipped (still a comment at `sync/index.ts:367`). The `.tsx` guard stays — removing it re-opens F1 — but the real fix (CSP + sandboxed canvas origin, then the opt-in) is sequenced in `.ai/plans/phase-9.1-tsx-sync-unblock.md`.

#### 2c. Symlink-safe atomic write (Chain C, L1)

```ts
// sync/atomic-write.ts: change suffix from randomBytes(4) → randomBytes(16),
// and change writeFileSync(tmp, bytes) → openSync(tmp, 'wx', 0o600) + writeSync + closeSync.
// 'wx' = O_CREAT | O_EXCL — fails if tmp already exists (defeats pre-created symlinks).
// Mode 0o600 on the created file so other tenants on shared hosts can't read in-flight content.
```

Closes the chain-C "shared CI/Codespaces tenant pre-creates symlink to `~/.ssh/authorized_keys`" exploit. 128-bit suffix makes brute-forcing infeasible; `wx` flag makes pre-created symlinks fail loud.

#### 2d. Size caps in codec apply functions (F7)

```ts
// sync/codec.ts: add a hard cap before applying:
const MAX_HTML_BYTES = 4 * 1024 * 1024;        // 4 MB
const MAX_COMMENTS_BYTES = 1 * 1024 * 1024;    // 1 MB
const MAX_ANNOTATIONS_BYTES = 1 * 1024 * 1024; // 1 MB matches existing /_api/annotations cap
```

Returns false + warns when oversize. Mirrors the existing `/_api/annotations` 1 MB cap (api.ts:587) so the sync path doesn't bypass the HTTP-layer guard.

#### 2e. Scheme allowlist (F9)

```ts
// sync/index.ts createSyncRuntime() — after token resolution:
// Refuse non-loopback ws://. Allow ws://localhost, ws://127.0.0.1, ws://[::1]
// (legitimate local hub dev). Refuse plaintext to any other host.
if (linkedHub.url.startsWith('http://') || linkedHub.url.startsWith('ws://')) {
  const u = new URL(linkedHub.url);
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (!loopback) {
    console.error(`[sync] refusing plaintext URL to non-loopback host: ${linkedHub.url}. Use wss:// or change the host to localhost.`);
    return null;
  }
}
```

Closes F9 (cleartext token over captive-portal MITM) and the F2 last-mile (attacker-hub-with-`ws://` URL).

#### 2f. Path-containment guards (M1, F12)

```ts
// sync/fs-mirror.ts notify(): reject paths with .. segments or absolute paths
if (relPath.includes('..') || isAbsolute(relPath)) return;
// sync/fs-mirror.ts fire(): verify resolved abs path stays under rootDir
const norm = resolve(abs);
const safeRoot = resolve(opts.rootDir);
if (norm !== safeRoot && !norm.startsWith(safeRoot + sep)) return;
```

Defensive: `path.join('/safe', '../etc/passwd')` resolves to `/etc/passwd`. The attacker hasn't found an HTTP route that emits `fs:any` with attacker-controlled paths yet, but adding the guard prevents future-refactor regressions from re-opening the surface.

#### 2g. JSON.parse `__proto__` reviver (M2)

```ts
// sync/agent.ts tryParseJsonArray(): use a reviver that strips dangerous keys
function safeParse(s: string): unknown {
  return JSON.parse(s, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });
}
```

Modern V8/Bun already block direct `__proto__` pollution at parse, but the reviver strips own-property `__proto__` keys that yjs would later serialize to peers. Defense-in-depth against cross-machine prototype-pollution propagation through a comment payload.

#### 2h. 0600 mode check on `hubs.json` read (F15)

```ts
// sync/hubs-config.ts loadHubsConfig(): fstat the file, warn if mode > 0o600
const stats = fs.statSync(path);
const mode = stats.mode & 0o777;
if ((mode & 0o077) !== 0) {
  console.warn(`[sync] ~/.config/maude/hubs.json is mode ${mode.toString(8)} — recommend chmod 600 (only owner can read tokens).`);
}
```

Non-blocking warn (Windows + funky-umask systems get a polite nudge). The CLI's `saveHubsConfig` already writes 0o600; this catches drift if a user later opens the file with an editor that resets permissions.

#### 2i. Auto-clear `adopt: true` after first successful adopt (I5, plan-level)

```ts
// sync/agent.ts reconcile() — at the end of the adopt branch, rewrite
// .design/config.json to remove the adopt flag so re-running serve doesn't re-trigger.
```

Closes the I5 "re-running serve after adopt re-pushes local state" loop. The CLI's `maude design link --adopt` writes the flag once; the runtime clears it after the one-shot reconcile.

### 3. Deferred architectural items mapped to phase tasks

| Finding | Severity | Mitigation | Lands in |
| --- | --- | --- | --- |
| **F1 (root cause)** | CRITICAL | CSP + iframe `sandbox` attribute on canvas-served HTML; segregate inspector origin from canvas-content origin | **Task 8** (conflict UX + hub-down offline mode — natural home for cross-slice dev-server UX work) |
| **F2** | HIGH | `maude design link` prompts `[y/N]` showing URL + scheme + domain for first-link against a new hub; trust allowlist | **Task 6 — SHIPPED.** Note: the allowlist landed **per-machine** (`~/.config/maude/hubs.json` `trusted[]`), NOT the `.maude/trusted-hubs` *project* file this DDR originally floated. The Task 6 re-audit (ethical-hacker) showed a committable project allowlist is a trust-laundering primitive — a malicious PR adds both `linkedHub.url` and the matching allowlist line (whose header says "safe to commit"), and the victim's link skips the prompt, re-opening the very F2 chain. Per-machine trust (like `~/.ssh/known_hosts`), recorded only after a successful link, is the shipped fix. The committed `linkedHub.url`-equals-trusted shortcut was also removed for the same reason. |
| **F3 (trifecta)** | HIGH | `.claudeignore` strategy for sync-written files; README "linked mode" banner; consider per-sync marker file under `.design/_untrusted/<slug>` | **Task 6** (docs + CLAUDE.md banner) + raised with Anthropic for Claude Code-side `.claudeignore` honoring |
| **F4** | HIGH | `--adopt` first-link shows manifest of files about to be uploaded + requires `[y/N]` confirmation; runtime cross-checks `adoptedAt` attestation in `~/.config/maude/hubs.json` | **Task 6** (CLI surface) |
| **F8** | LOW | Echo-guard mtime cross-check (record + check disk mtime) to handle "user types same bytes within echo window" corner case | **Task 4 follow-up** (same-slice cleanup; small change) |
| **F11** | LOW | Sync-failure UI banner in the browser instead of `console.error "continuing in solo mode"` log line | **Task 8** (conflict UX) |
| **F14** | MEDIUM | Single ownership of `_comments/<slug>.json` + `<slug>.annotations.svg` — either sync-agent owns and collab-room reads through, or collab-room owns and sync-agent skips when linkedHub present | **Task 5** (awareness over WSS — same broader integration scope) — needs design decision before code |

### 4. Acceptance for this hardening commit

- All 8 fixes (2a–2h) + the I5 plan-level fix (2i) land in a single commit.
- Each fix has at least one test (or a test diff extending an existing case).
- The 100-event stress test still passes.
- 605/605 dev-server suite stays green.
- Biome lint stays clean.
- This DDR is committed alongside the code.

### 5. Re-audit policy

The hardening commit re-runs both security-auditor and ethical-hacker passes. The expected delta:

- Defender M1, M2 should clear (path containment + reviver applied).
- Defender L1 should clear (wx + 128-bit suffix applied).
- Attacker F1 stays HIGH at minimum (CSP/sandbox is the architectural fix, not landed here) but the `.tsx`-refusal closes the worst lane.
- Attacker F-creative-1, Chain C should clear (CI guard + symlink-safe writes applied).
- Attacker F2, F3, F4 stay HIGH-DEFERRED with explicit pointer to Task 6.
- Attacker F7, F9, F12, F15 should clear (size caps + scheme allowlist + path containment + mode check applied).

If the re-audit surfaces NEW findings, append to the audit report files (don't open new ones) and decide blocking-vs-defer inline.

## Consequences

### Positive

- The trust model is pinned in writing rather than reconstructed task-by-task. Tasks 5, 6, 8 inherit a clear contract.
- Eight quick-win fixes ship in a single commit, closing the worst lanes of the audit without waiting for cross-slice architectural work.
- The "DOCUMENTED RISK until Task X" rows make explicit what users buy when they opt into linked mode pre-v1.0-release.
- Future audits have a stable baseline — re-running on Task 5/6/8 commits will know which findings were already triaged.

### Negative

- The README + plan must carry an unmissable banner that linked mode is preview-only until the four deferred architectural items land. Marketing risk if a user reads the v1.1 changelog and thinks "production-ready collaboration."
- We're shipping known-deferred CRITICAL severity (F1 root cause) on `.html` for the gap between this slice and Task 8. Mitigated by `.tsx`-refusal (which closes the JS-transpile lane) + the user-explicit-link requirement, but the residual is non-zero: a hostile hub can still push HTML that the dev-server serves as `text/html`. **For solo users (the default) the residual is zero.**
- The `~/.config/maude/hubs.json` mode-check is a warn, not a refuse. Refusing breaks Windows + unusual-umask hosts; warn-with-clear-remediation is the v1.1 middle ground.

### Rollback path

If a future incident reveals one of the deferred items is exploitable in a way this DDR underestimates, the immediate response is: (a) bump dev-server `linkedHub`-detection to print a giant red banner + refuse to start the sync runtime; (b) emergency release; (c) write a follow-up DDR superseding this one. Solo mode is unaffected — users without `linkedHub` see no behavior change from the bump.
