# B0 frame logs — universal ACP contract evidence

Captured 2026-11-12 by the B0 spike (`../universal-acp-contract.md`). Each `.ndjson` line is
`{ t: ms since spawn, dir, payload }`, where `dir` is `client→agent`, `agent→client`, `stderr`, `exit`,
`meta` or `error:*`. Paths are redacted: `<scratch>` is the throwaway probe dir (inside a git worktree),
`<scratch-nongit>` a probe dir outside any git repo, `<home>` the real home. `usage_update` frames and the
model / slash-command lists are trimmed.

The client was a ~150-line harness on `@agentclientprotocol/sdk@0.28.1` (the studio's pinned SDK). It
advertised `fs.readTextFile/writeTextFile: true` and `terminal: true` so any routing through the client
would show; `terminal/create` was answered with an error (none arrived). Every agent ran with a scratch
`HOME`, `XDG_*`, `CODEX_HOME` and an env built from scratch (no inherited keys). No sign-in, no real
credential, no remote model: prompt turns ran against a **local scripted model** (`127.0.0.1`, a fake
OpenAI Responses / Chat Completions SSE server) that emits a fixed list of tool calls, so every tool call
below is deterministic and the "secret" is a planted `FAKE-SECRET-*` file.

| File | Agent | What it shows |
| --- | --- | --- |
| `codex-bundled-init.ndjson` | codex-acp 2.6.0 + bundled codex 0.166.0 | `initialize` caps + `authMethods`; `session/new` → `-32000 Authentication required` without auth |
| `codex-mock-ws.ndjson` | codex-acp, mode `workspace-write`, **no** Maude profile | outside read succeeds silently (`kind:read` reported after the fact); in-project write no prompt; escalated write → `session/request_permission` (`kind:execute`); reject → turn `cancelled` |
| `codex-mock-maude.ndjson` | codex-acp, default mode `agent` (auto review) + Maude profile | outside read **denied by Seatbelt**; network denied; escalations go to Codex's own "Guardian" model reviewer, **never to the client** |
| `codex-mock-maude-ws.ndjson` | codex-acp, `INITIAL_AGENT_MODE=workspace-write` + Maude profile | outside read denied; in-project `apply_patch` no prompt; out-of-project edit → `request_permission` `kind:edit` with `locations` |
| `codex-mock-setmode.ndjson` | codex-acp, `session/set_mode workspace-write` after start + profile | profile survives a mode switch; escalated read → `request_permission` `kind:execute` with the outside path in `locations` |
| `opencode-init.ndjson` | opencode 1.18.30 | `initialize`; `session/new` succeeds **without auth** (free hosted default model); no `modes`, `configOptions` model + mode(build/plan) |
| `opencode-mock-default.ndjson` | opencode, default permissions | read outside, write outside, `bash cat` secret, `webfetch` — all run, **zero** permission requests, no `fs/*` |
| `opencode-mock-maude.ndjson` | opencode, `permission: read/edit/bash ask` | permission precedes every call, but the **read request carries no path** (`locations:[]`, `rawInput:{}`); writes mirrored to `fs/write_text_file` after approval, and **refusing that fs call does not stop the write** |
| `opencode-mock-extdir.ndjson` | opencode, `external_directory: deny`, project **inside a git repo** | deny does not fire: opencode's boundary is the git worktree root, not `cwd` |
| `opencode-mock-extdir-nongit.ndjson` | opencode, `read: allow, edit/bash: ask, external_directory: deny`, project outside git | outside read, outside write, outside `glob`, and `bash cat ../outside/…` all refused by opencode itself; in-project read free; in-project edit asks (with path) |
| `gemini-init.ndjson` | gemini-cli 0.67.0 `--acp` | `initialize` caps + 4 `authMethods` (incl. `gateway`); `session/new` → `Gemini API key is missing` — stopped there |
| `codex-sandbox.txt` | `codex sandbox` (0.166.0 and the user's 0.154.0) | Seatbelt read/write/network matrix for the built-in profiles and a Maude-shaped custom profile |
