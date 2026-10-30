# Phase 4 gate — security review (defender + attacker), 2026-10-17/18

Scope: `git diff 5ae2c90e..HEAD` (Phase 4 v2 shell). Both passes on Opus, read-only. Knobs: severityFloor medium, includeAi true, scope classic + ai.
The attacker pass was cut by a network outage and resumed; both finished.

## Findings

| id | sev | where | finding | outcome |
|---|---|---|---|---|
| D1 | medium | `http.ts` `/_config` | V2-4.7b added `projectFolder` (this Mac's absolute path) to `/_config`, which had no DNS-rebinding guard; a rebound page on 4399–4401 reads `/Users/<name>/…` | **fixed** 4b6521d0 — the folder rides only on the guarded `/_api/diagnostics`; the Diagnostics menu/sheet read it there. Red-first `test/diagnostics-folder-guard.test.ts` |
| EH-P4-1 | medium (chain with D1) | `http.ts` `/_config` | the root cause: the whole `/_config` (project name, hub link + workspace, canvas origin + port, build, profile) is readable cross-origin by rebinding — recon for a targeted follow-up | **fixed** 2cd0bbbd — `/_config` behind `sameOriginRead` + `isTrustedRequestHost` (cell vouches with `x-maude-role`); body in `configResponse`; projection scrape now sees every top-level computed field. Red-first (same test file) |
| D2 | low (pre-existing) | `server.ts` `/_ws/acp` | AI chat socket checks loopback + same origin, not the role; the read-only gate for the AI chat is client-side. Impact: a hub-linked viewer's local clone drifts; the cell still refuses the sync | follow-up (Phase 5 S-work, ACP) |
| D3 | low | `sync/hubs-config.ts`, `cloud/renew.ts` | a credential with no stored role counts as writable (older hubs); renewal can store `undefined` | follow-up (retire with old hubs) |
| D4 | low (pre-existing pattern) | `use-single-keys.js`, `use-shell-core.jsx` postToActiveCanvas (23 send sites) | shell → canvas `postMessage(..., '*')`; a self-navigated frame would receive a boolean / key letter, no secrets | follow-up: one `canvasTarget(cfg)` helper for every send site |
| D5 | low (hypothesis) | `http.ts` read-only allowlist | local Can view may comment (binary read-only gate) | follow-up with S9 roles |
| EH-P4-2 | low | `use-tool-panels.js`, `tool-panel-open` / `toolbar-rect` | the active canvas (editor role) can open the trusted Stickers panel unprompted at an anchor it chooses; first click on the scrim dismisses; warn/error callouts stay above | follow-up: gesture gate or clamp the anchor out of the top chrome band |
| EH-P4-3 | low (pre-existing) | `shell-key-handlers.js` `runForwardedKey` | canvas-forwarded chords resolve with `role: 'owner'`; only view/export actions are reachable that way | follow-up: pass the session role |

Findings at or above the floor after fixes: **0**. Exploit chains: 1 (D1 + EH-P4-1, recon only, fixed).

## Clean (both passes agree)
- Every write the new UI calls is refused for read-only roles server-side (`readOnlyRefusal`; `access-role-matrix.test.ts`); client `minRole` / `canEdit` only shape the UI. `isEditRole` fixes a latent fail-open (`=== 'viewer'`).
- Tauri `check_for_updates`: no args, `caller_project` check, `p-*` webviews only, 10 s throttle; canvas iframe has no invoke key; WebDriver plugin debug-only.
- Bridge: `toolbar-rect` / `tool-panel-open` through `acceptFromCanvas` (origin + active frame + strict parse); `key-prefs` / `run-action` parent-only; `replayToolKey` `^(⇧)?[A-Z]$`.
- ⌘K Ask AI only pre-fills the composer (typed text, ≤ 2000 chars); a human sends. No `innerHTML`. The AI-chat trifecta is the accepted pre-existing EH-C1.
- GitHub doors fire a window event; Diagnostics hints are fixed strings; canvas allowlists unchanged; prefs validated.
