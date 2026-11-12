# universal-acp-agents-desktop

**native-desktop** E2E for the universal-ACP agents UI: the one-line offer in the AI panel's empty state, Settings › Connections › AI agents, the composer's agent picker, the vendor badge on a reply, the once-only permission card and "<label> reported: …". DOM-driven (`data-testid`), no computer-use.

**Plan:** `.ai/plans/archive/feature-universal-acp-and-codex.md` § Design Decisions (UI) 1–6.
**Harness:** `apps/desktop/e2e/wdio.agents.conf.ts` + `scenarios/agents.e2e.ts`. Skill: `desktop-e2e`.
**Run:** `pnpm test:e2e:desktop:agents` (needs the e2e sidecar `bun run build.ts --release --e2e`, the debug app `pnpm test:e2e:desktop:build`, an awake unlocked screen).

## The world

| Piece | How |
| --- | --- |
| Claude connected | `helpers/fake-ai.ts`: the signed-in `claude` stub + the scripted ACP agent. |
| Other agents | `helpers/fake-agents.ts`: the lane's PATH is scrubbed of every folder holding a catalog agent (codex, opencode, gemini, copilot, goose, cursor-agent) and gets one EMPTY drop-in folder first. An e2e sidecar keeps the lane's PATH (`sidecar.rs` `sidecar_base_path`), so discovery walks it as on a person's Mac. |
| The fake opencode | `fixtures/fake-acp/opencode-agent.mjs`, compiled (`bun build --compile`) into a standalone `opencode` binary: `--version` → `1.18.40` (in the tested range), `opencode acp` speaks ACP. Under the conformance probe's launch policy (its loopback provider in `OPENCODE_CONFIG_CONTENT`) it obeys like the unit fixture's 'obey' mode and **passes the real probe** at Connect — never bypassed. In a chat it runs fixed scripts: `E2E_OUTSIDE_WRITE <abs path>` asks for that write, `E2E_AGENT_ERROR` fails the turn ("the e2e quota is used up"), anything else answers "Hello from the fake opencode." |
| Person opencode config | `MAUDE_E2E_OPENCODE_HOME` (e2e sidecar builds only; a release build ignores it, `test/e2e-switches-release-gate.test.ts`): the opencode person-config check reads `~/.opencode` & co. under an empty folder, so a developer's own opencode plugins do not make Maude refuse the lane's fake. The project's `.opencode` chain is unmoved. |
| Agents record | `$XDG_CONFIG_HOME/maude/agents.json` — the lane's throwaway config home. |

## Platform matrix

| Platform | Required | Rationale |
| --- | --- | --- |
| **native-desktop** (`Maude.app` debug build) | ✓ | The ACP chat panel is native-only (DDR-123); the agents run as children of the sidecar. |
| web-desktop | covered by unit tests | `AgentOffer`, `AgentPicker`, `agents-card` render tests. |
| mobile | N/A | |

## Steps

| # | Step | Expected | Shots |
| --- | --- | --- | --- |
| 1 | World A: open the AI panel on an empty chat; open Settings › Connections › AI agents. | No `ai-agent-offer`, no `ai-agent-picker`; `/_api/agents` lists no other installed agent; `settings-conn-agents-status` reads "No other AI agents on this Mac". | `01-*` |
| 2 | Drop the fake `opencode` on PATH, Settings › AI agents › **Look again** (`settings-agents-refresh`); back to the empty chat; **Not now**; reload; relaunch. | Summary "opencode on this Mac"; `ai-agent-offer` reads "opencode is on this Mac. Use it in Maude too?"; after Not now the line is gone, `agents.json` `offerDismissed.opencode = true`; still gone after a webview reload and after a quit + start (opencode still found, `offerAgents` empty). | `02-*` |
| 3 | Delete `agents.json` (fresh record), Look again; offer → **Connect**; Settings row → **Connect**. | The offer is back; Connect opens Settings (opencode carries a connect note, shown as `settings-agent-note-opencode`); the real conformance probe runs; `settings-agent-row-opencode` `data-state=connected`, "Connected"; `agents.json` records version 1.18.40; the offer line is gone. | `03-*` |
| 4 | Empty chat: pick opencode in `ai-agent-picker`; send "Say hello." | The picker is a `<select>` with claude + opencode; the reply is "Hello from the fake opencode." with `ai-agent-badge` "opencode" (title "opencode by opencode"); the picker turns into a read-only chip (`data-agent=opencode`, "Start a new chat to use another agent"). | `04-*` |
| 5 | Send `E2E_OUTSIDE_WRITE ~/.maude-e2e-agents-outside-*.txt` (absolute); Reject. | `chat-permission-prompt` with `chat-perm-outside` naming the path; no "always" anywhere on the card (the fake offered allow-always; Maude strips it); after Reject the card closes, the turn ends (`ai-agent-refused` or the agent's "refused" reply), the file does not exist. | `05-*` |
| 6 | Send `E2E_AGENT_ERROR`. | `ai-agent-error-text` reads "opencode reported: … the e2e quota is used up". | `06-*` |

**Acceptance:** all 6 steps pass; the person's real `~/Library/Application Support/com.maude.app*/prefs.json`, `~/.config/maude/*` and opencode config mtimes are unchanged. Run output: `.ai/device/scenario-runs/universal-acp-agents-desktop/<YYYY-MM-DD-HHMM>/` (gitignored: `report.md` + `native-desktop/*.png`).
