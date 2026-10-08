# V2-0.0 — run-harness smoke test (2026-10-08)

Host: Claude desktop (Code tab), Claude Code 2.1.280, Agent SDK 0.3.293, Opus 5.5.
Lead session `87d978ed-80c9-4461-b6c8-391c975c5c9a` owns the marker `.ai/state/v2-run.json`.
Log of every gated hook call: `.ai/state/v2-hooks.log.jsonl` (runtime, gitignored).

| Check | Result |
| --- | --- |
| Hooks load in the running lead session after `.claude/settings.json` changes | yes — first `TaskCreated` call logged `matched:true` |
| `TaskCreated` blocking via **exit 2 + stderr** (documented) | **not honoured** — the planted task was created anyway (deleted by hand) |
| `TaskCreated` blocking via **JSON `{decision:"block", reason}`** | honoured — `TaskCreate` returned "TaskCreated hook feedback: …" and no task was created. All harness blocks now use the JSON form |
| `SubagentStart` additionalContext reaches the sub-agent | yes — an Explore agent told to add nothing ended with `## Decisions: none` |
| `SubagentStop` with Decisions present | allowed (logged) |
| Sub-agent hook input `session_id` | **the lead's session id**, plus its own `agent_id` / `agent_type` (`ae43f6db…` Explore, `aa83b923…` general-purpose) |
| Named agent (`name: smoke-mate`, the host's in-process "teammate") | same: lead's `session_id`, `teammate_name: null`; its `TaskCreate` went through the hook and was refused (it surfaced a parser bug — fixed, test added) |
| Second session (`claude -p --session-id 73600b05…`, no marker match) | hooks fired with `matched:false`; the planted task was created; `Stop` not blocked |

Consequence: in this host a sub-agent or named agent is gated in by the lead's own session id, so the marker's
`members` list is only needed for separate teammate sessions (none observed in this host).

Unit tests: `node --test scripts/v2-hooks/v2-hook.test.mjs` (24, red-first: 12 fail against `noop-hook.mjs`) and
`node --test scripts/v2-hooks/v2-test-lane.test.mjs` (6).
