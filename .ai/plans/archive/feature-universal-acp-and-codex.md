# Feature: Universal AI chat (Codex and any ACP agent) + the terminal quick start

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Three linked pieces of work, delivered as two parts:

**Part A: docs and site (low risk, ships first).**
- Bring back the terminal quick start that the public site v2 dropped. `site/components/mdcc/quick-start.tsx` is still in the tree, but nothing imports it since `e91b9b9e2` (#193).
- Make Maude Studio (the app) the main product everywhere.
- Add one **Advanced** path: "use Maude from your own agent". You install only the `maude` CLI and the `design` plugin (`flow` stays optional), in Claude Code, Codex or opencode.
- Rewrite the Codex install guide (`site/content/docs/codex.mdx`). Its "until published" callout is stale: the native Codex plugins shipped (commit `a01938288` is in `v2.2.1`).

**Part B: the AI chat panel becomes agent-agnostic.**
- Today the panel drives only the user's own `claude` CLI through `@agentclientprotocol/claude-agent-acp` (DDR-123/166/168).
- Studio should detect every locally installed agent CLI that can speak ACP and offer to connect it: Codex first, then Gemini CLI, opencode, GitHub Copilot CLI, Goose, Cursor agent, and so on.
- Advanced users can also bring their own API key.
- **Claude stays the main sign-in gate.** First run, Home and the Connect sheet do not change. Other agents are an Advanced opt-in.

## User Story

- As a designer, I want Maude Studio to be the obvious thing to download, so that I never have to read about plugins first.
- As a terminal user, I want one copy-paste quick start for Claude Code or Codex (CLI + design plugin), so that I can drive canvases from my own agent.
- As an advanced user who pays for Codex (or Gemini, or Copilot, or an API key), I want the Studio chat to offer the agent I already have installed, so that I can use it without a Claude subscription for every task.

## Problem

- **No terminal quick start on the site.** The homepage `AdvancedDoor` (`site/components/v2/advanced-door.tsx`) only lists catalog items. The Claude/Codex tab card (decision `maude/homepage-dual-host-quickstart`) is orphaned.
- **The Codex docs are wrong.** `codex.mdx` still says install from a local checkout, and it ends with "built-in ACP chat is a separate follow-up".
- **The chat panel is Claude-only at every layer:**
  - spawn: `acp/probe.ts:18-19,135-165`, `bridge.ts:1444-1525`;
  - sign-in: `login-state.ts`;
  - readiness: `readiness.ts`, `home/ai.ts`;
  - client gate: `client/v2/ai/ConnectSheet.jsx`, `connect-flow.js`, `NotReady.jsx`;
  - settings: `settings-cards.js` has one "Claude Code" card;
  - no agent picker exists.
- **Security is the real blocker, not wiring.** All of Maude's least-privilege policy for the agent travels in `_meta.claudeCode.options` (`bridge.ts:698-786`): credential read-denies (`may-scope.ts:358`), the folder-scoped read allow-list, web-off (`MAUDE_NO_EGRESS`), DDR-144 narrowing, plugin injection and `settingSources:['user']`. A non-Claude ACP agent **silently ignores** that block.
  - The env scrub (`env.ts:138-165`) removes Anthropic keys but not `OPENAI_*`, `GEMINI_*` or `GITHUB_TOKEN`.
  - The design plugin's hooks (bash guard, kgai capture) run only inside Claude Code.
- **Side finding:** on this Mac, `~/.claude/bin/codex` is a shell wrapper for `exec maude codex "$@"`. `codex --help` through it failed with `spawnSync … codex ETIMEDOUT` after 120 s. Discovery must resolve the real binary, and the wrapper hang needs its own check (Task A4).

## Solution

**Part A.** Restore the quick start in two places: the homepage Advanced door and a new docs page. The page has one "Studio first" line, then a host tab switch (Claude Code · Codex · opencode). Each tab shows `npm i -g @1agh/maude` plus the host's marketplace add and `design` install, `flow` optional, and the init commands. Rewrite `codex.mdx` around the published GitHub marketplace. Then add the "Codex in Studio chat" section once Part B lands.

**Part B.** Introduce an **agent descriptor** and keep the Claude path byte-identical.

```
AgentDescriptor {
  id, label, vendor,
  detect:  { bins: ['codex'], versionArgs, minVersion },   // real binary, wrappers resolved
  launch:  { kind: 'adapter-js' | 'native-acp',
             cmd, args },                                    // e.g. opencode acp · gemini --acp · copilot --acp
  auth:    { statusCmd, loginCmd, apiKeyEnv?: ['OPENAI_API_KEY'] },
  envAllow: [...],                                           // everything else scrubbed
  policy:  'claude-meta' | 'bridge-enforced',
  plugins: 'claude-meta' | 'harness:<target>' | 'none',
}
```

- **Catalog.** Maude ships a **curated, pinned catalog** in the format of the public ACP registry (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, which currently lists 46 agents: `codex-acp`, `gemini`, `github-copilot-cli`, `opencode`, `goose`, `cursor`, `claude-acp`, …). Maude never fetches and runs it live: an agent appears only when its CLI is already on the login-shell PATH. Advanced also offers **Custom agent** (a command plus args) for anything not in the catalog.
- **Policy outside `_meta`.** For `bridge-enforced` agents the bridge enforces policy itself on `session/request_permission`, `fs/*` and tool-call updates, keyed on ACP `kind`, `locations` and `rawInput`, not on Claude tool names. That covers credential refusal, the read boundary, the write scope and web-off. An agent that runs tools without asking is held to a fail-closed rule (Decision 2).
- **Codex first.** It is the first non-Claude agent, end to end. The others follow the same descriptor and are enabled one by one, each behind a conformance probe.

## Decisions to make (recommendation first; the B0 spike turns them into one DDR)

1. **Can someone without Claude use another agent?** **Resolved (debate + Michal, 2026-11-12):** yes, through Settings › AI agents. The Connect sheet stays Claude-only, with a quiet "Use another agent…" link to Settings that appears only when an agent is detected. See Design Decisions.
2. **What about agents that act without a permission request?**
   - *Recommended:* run them only in their own read-only or workspace sandbox mode where the CLI has one (Codex `--sandbox workspace-write`, approval policy "on-request"), and pass the project root as the only writable root.
   - An agent with no such mode and no permission requests is marked **"unrestricted"**. It needs an explicit per-project consent card and is never the default.
3. **Where do adapters come from?**
   - *Recommended:* agents with a native `acp` subcommand (opencode, goose, cursor-agent) run the user's own binary.
   - npx-distributed adapters (`@agentclientprotocol/codex-acp`, `@google/gemini-cli --acp`, `@github/copilot --acp`) are **bundled and pinned** like the Claude adapter (DDR-177 self-contained, DDR-044 frozen install), never `npx` at runtime.
   - The spike checks whether `codex-acp` is pure JS or ships a native binary (size, signing).
4. **Bring your own API key.**
   - Keys live in the existing BYOK store (`generation/keys.ts`, `~/.config/maude/keys.json`, mode 0600), with a "Chat" scope added.
   - A key is injected **only** into the env of the agent it belongs to (`OPENAI_API_KEY` → Codex; provider keys → opencode or Gemini).
   - An Anthropic key for Claude conflicts with DDR-123's subscription guardrail (`env.ts:1-31`, which always scrubs `ANTHROPIC_API_KEY`). Recommended: allow it as an explicit Advanced opt-in, recorded in a DDR that amends DDR-123.
5. **Plugins for non-Claude agents.**
   - *Recommended:* the chat sends the studio brief as a first-turn preamble.
   - With consent, Maude installs `design` (+ `flow`) natively through the existing harness targets (`cli/lib/harness/targets/{codex,opencode}.mjs`). There is no in-session injection.
   - Agents without a harness target get the brief only, labelled "Maude commands unavailable in this agent".

## Metadata

- **Type**: New Capability (B) + Enhancement (A)
- **Complexity**: High (B), Low (A)
- **App/Package**: `apps/studio` (acp, client/v2/ai, settings, generation/keys), `apps/desktop` (sidecar PATH, staging), `cli/lib/harness`, `site/`
- **Affected Systems**: ACP bridge and security policy, readiness gate, Settings › Connections, desktop bundle (adapters), public site + docs
- **Dependencies**: `@agentclientprotocol/codex-acp` (pinned, bundled); later `@google/gemini-cli` and `@github/copilot` adapters (pinned). No live registry fetch.

---

## Context References

### Must-Read Files

> `/flow:execute` reads every file listed here in parallel in a single assistant message.

- `apps/studio/acp/probe.ts` (18-19, 39-68, 135-165, 243-287, 522-611): adapter, `claude` and runtime resolution, availability checks.
- `apps/studio/acp/bridge.ts` (698-786 `_meta.claudeCode`, 1189-1220 config, 1329-1385 resume, 1444-1525 spawn, 1610 rate limit, 1706-1750 elicitation, 1778-1795 initialize, 1936-1951 tool-name harvest).
- `apps/studio/acp/env.ts` (1-31 guardrail, 77-165 scrub).
- `apps/studio/acp/may-scope.ts` (228, 358, 385, 482, 632-648) and `write-scope.ts` (75-78, 330, 483-486): policy keyed on Claude tool names.
- `apps/studio/acp/login-state.ts`, `readiness.ts` (113-120, 264-300), `home/ai.ts` (17-72), `http.ts` (2086-2089, 3163-3255): Claude sign-in and gate.
- `apps/studio/acp/plugin-bootstrap.ts` (85-115, 153-207).
- `apps/studio/client/v2/ai/{ConnectSheet.jsx,connect-flow.js,NotReady.jsx,advanced-model.js,Composer.jsx}`, `client/panels/acp-capabilities.js`, `client/panels/acp-runtime.js`.
- `apps/studio/client/v2/settings/{settings-cards.js,settings-model.js,connections-model.js}`.
- `apps/studio/generation/keys.ts` (28-151): the BYOK key store to reuse.
- `cli/lib/harness/{capabilities.mjs,compatibility.mjs,codex-runtime.mjs,targets/codex.mjs,targets/opencode.mjs}`.
- `apps/desktop/src-tauri/src/sidecar.rs` (282-345, 535-574 login PATH; 254, 817, 1702-1805 child reaping), `apps/desktop/scripts/stage-resources.mjs` (12-97), `apps/desktop/scripts/helper-deps.mjs`.
- `site/components/mdcc/quick-start.tsx`, `site/components/v2/advanced-door.tsx`, `site/components/v2/docs-doors.tsx`, `site/content/docs/{index,getting-started,codex,cli,design}.mdx`, `site/content/docs/desktop/index.mdx` (29, 57-62), `site/content/docs/meta.json`.

### Prior decisions (kgai: `kg search "ACP agent harness codex"`)

- DDR-123: the chat runs on the user's own `claude` CLI subscription, never API billing (amended by Decision 4).
- DDR-143/168: session-scoped plugin bootstrap; bundled plugins always win.
- DDR-166/177: zero-terminal cold start; self-contained bundle + completeness gate (new adapters must pass `check-bundle-completeness.mjs --smoke`).
- DDR-144/185: ACP default-allow and read-only filesystem allowlist (what `bridge-enforced` must reproduce).
- `maude/native-markdown-plugin-distribution`, `maude/codex-agent-isolation-boundary`: Codex child agents inherit the parent's tool registry. Role prompts are not enforced tool whitelists, which matters for Decision 2.
- `maude/homepage-dual-host-quickstart`: the orphaned tab card.
- V2-2.4b `MAUDE_AGENT_ACTOR=maude-chat`: CLI confinement works for any agent that passes env through to its shell.

### Files to Create

- `apps/studio/acp/agents/catalog.ts`: curated pinned descriptors (registry-shaped).
- `apps/studio/acp/agents/discover.ts`: PATH discovery, wrapper resolution, version gate.
- `apps/studio/acp/agents/descriptor.ts`: the type + the Claude descriptor (current behaviour).
- `apps/studio/acp/policy/enforce.ts`: bridge-side policy for `bridge-enforced` agents.
- `apps/studio/client/v2/ai/AgentPicker.jsx`, `apps/studio/client/v2/settings/agents-card.*`.
- `site/content/docs/use-from-your-agent.mdx` (title "Use Maude from your own agent").
- `.ai/archive/decisions/DDR-2xx-universal-acp-agents.md` (or a graph-native `/flow:record-ddr`).

---

## Design Decisions (UI)

> Resolved by a `flow:debate-protocol` divergent debate on 2026-11-12. Seats: USER-ADVOCATE, SHIPPER, BREAKER; `reduce` tier because the seats have no messaging tools. All three voted for a proactive offer, each with **one** user decision. One fork went to Michal, who chose "only a link to Settings".

**Principle: awareness only from local evidence.** A user with nothing else installed sees **zero** change. Other agents never appear in onboarding, Home, toasts, modals or the native menu.

1. **The proactive offer.** One quiet, inline line in the **AI panel's empty state**: "Codex is on this Mac. Use it in Maude too? · Connect · Not now".
   - **It appears only when all of these hold:**
     - Claude is connected and idle (never during a running turn, never on first run);
     - the agent is in the pinned catalog and passed bridge-enforced conformance;
     - the detected version is in the tested range;
     - the agent is not connected yet.
   - **One shared line, not one per agent:** several detected agents share it ("Codex and Gemini are on this Mac…").
   - **"Not now" is permanent** for that agent, stored in app prefs. A *newly* detected agent can offer once.
   - **Connect** only registers the agent and starts *that vendor's* own sign-in. It does not change the default agent, open a session or widen any permission.
   - "Unrestricted" and custom agents are **never** offered.
   - Reuse the one-sentence + button + "Not now" shape of `client/v2/ai/OfferCard.jsx`, not the component itself.
2. **Settings › Connections › AI agents** is the always-present reference list, next to the `claude` row and on the existing `connections-model.js` / `settings-cards.js` pattern.
   - Each agent shows a state: Connected · Sign in · Untested version · Unavailable — check Codex.
   - **Advanced** (folded) holds Custom agent… and own API key, each behind a per-project consent card.
3. **Connect sheet (first-run gate): Claude-only, as today.** It gains one quiet link, "Use another agent…", that opens Settings › AI agents. It is shown only when a bridge-enforced agent is detected. There is no direct Codex connect from the sheet (Michal's choice; it keeps the first impression on Claude with full Maude commands).
4. **Picker.** An agent chip in the composer, shown only when **≥ 2** agents are connected.
   - A new chat uses the last-used agent.
   - **A chat keeps the agent it started with**; there is no switching mid-chat.
   - Claude-only users see no change, pinned with a screenshot diff.
5. **Attribution.**
   - Every reply carries a small vendor badge.
   - Agent errors, quota messages and stderr render as "Codex reported: …" with a link to the vendor's status page.
   - A failed spawn or version mismatch marks the agent row Unavailable instead of the generic "AI broken" screen.
   - An agent that stops conforming disappears from the chip and the picker on its own.
6. **Detection never runs an unknown binary on the boot path.**
   - Wrappers are resolved by following symlinks and *reading* `exec` lines, never by executing them.
   - `--version` runs with a 5 s timeout, lazily, cached by real path + mtime.
   - This guards against the `~/.claude/bin/codex` hang.
- **Decisions the user takes:** 0 on first run; 1 optional (Connect / Not now) when an offer appears; the picker only after connecting a second agent.
- **Dissent kept, deferred:** USER-ADVOCATE proposed "continue this chat with Codex" on a Claude quota/outage error card. BREAKER opposed any mid-chat offer, and SHIPPER left it out. Revisit after Codex conformance has held for one release.
- Mode and model menus render the agent's own ACP `modes` / `configOptions` generically. The Claude ids in `advanced-model.js:63-84` become one descriptor's labels, not hard-coded logic.

### Ship order (from the debate)

- **First ship = Codex only:** B0–B6 + B9, with the offer, the Settings card, the Connect-sheet link and the picker.
- **Second ship:** BYOK (B7), Custom agent, and the other catalog agents (B8), each enabled only after its own conformance probe.
- Nothing from Michal's request is dropped; it is staged. SHIPPER's reasoning: every added agent is permanent adapter, signing and policy work (DDR-177), and BYOK changes the credential setup.
- Before anything is designed, check the v2 canvases under `.design/` for the AI panel and Settings (Pattern priors: lift, don't invent). Do a `/design:new` pass for the picker and the card before Task B6.

---

## Tasks

### Part A: docs and site

#### Task A1: RESTORE the terminal quick start on the homepage
- **Do**: Render `QuickStart` (Claude Code · Codex tabs) inside `AdvancedDoor`, under the "Live in a terminal?" head. Reduce each tab to **CLI + `design` plugin** (`flow` on a second, optional line). Retheme it with the v2 classes (`ps-*`), not the old `mdcc-install`. Drop the "requires publishing" note from the Codex tab. Add an opencode tab only if `cli/lib/harness/targets/opencode.mjs` supports a user-facing install command; otherwise leave it out.
- **Files**: `site/components/mdcc/quick-start.tsx` (move to `site/components/v2/quick-start.tsx`), `site/components/v2/advanced-door.tsx`, `site/app/site-v2.css`.
- **Pattern**: `docs-doors.tsx` and `advanced-door.tsx` (v2 section shapes); `copy-button.tsx`.
- **Gotcha**: test the commands live first: `claude plugin marketplace add 1aGh/maude`, `codex plugin marketplace add 1aGh/maude`, then `codex plugin add design@maude`, in a scratch HOME. The previous card shipped commands that did not yet work. Site edits re-date `stats.json` (memory `maude-site-docs-edit-needs-stats-regen`).
- **Validate**: `pnpm --filter @maude/site build && pnpm --filter @maude/site gen:stats` + a screenshot of `/` at 375 px and desktop width.

#### Task A2: CREATE the "Use Maude from your own agent" page and restructure Advanced
- **Do**:
  - Write the new page with this order: (1) one line that Studio is the product and this path is for people who live in an agent; (2) the same tabbed quick start (import the component); (3) what you get with only CLI + design (canvases, `/design:*`, screenshots/exports through the CLI, Studio opened alongside via `design:browse`); (4) what `flow` adds; (5) links to the per-host pages.
  - Put it first under `---Advanced / Explore Maude---` in `meta.json`.
  - In `index.mdx` and `getting-started.mdx` "When you want more", point the plugin card at this page instead of `/docs/design`.
- **Files**: `site/content/docs/use-from-your-agent.mdx`, `site/content/docs/meta.json`, `site/content/docs/index.mdx`, `site/content/docs/getting-started.mdx`, `site/components/mdx.tsx` (register the component).
- **Gotcha**: `scripts/test/docs-no-old-chrome.test.mjs` bans v1 words in docs. Write copy in the `maude-positioning` + `michal-voice` register (load both skills).
- **Validate**: `node --test scripts/test/docs-no-old-chrome.test.mjs && pnpm --filter @maude/site build`.

#### Task A3: REWRITE the Codex install guide
- **Do**:
  - Install from the published marketplace (`codex plugin marketplace add 1aGh/maude`) and remove the "Distribution status" callout. Keep "from a checkout" as a contributor note.
  - Add `design-video@maude` as opt-in (DDR-249).
  - Explain the `maude codex` wrapper (`~/.claude/bin/codex`) vs a direct native install in a short troubleshooting block.
  - Replace the last paragraph ("built-in ACP chat is a separate follow-up") with a forward link that Part B fills (Task B9).
  - Re-check the "verification boundary" section against Codex ≥ 0.154: re-run the browse/edit/screenshot loop once and update or trim.
- **Files**: `site/content/docs/codex.mdx`.
- **Validate**: run the install steps in a scratch HOME (`HOME=$(mktemp -d)`; stub nothing, real `codex`) + `pnpm --filter @maude/site build`.

#### Task A4: CHECK the `maude codex` wrapper hang
- **Do**: Reproduce `~/.claude/bin/codex --help` (wrapper → `maude codex` → `spawnSync … ETIMEDOUT`). If it reproduces, `/flow:bug-rca` it as its own GitHub issue. Do not fix it inside this plan.
- **Files**: none (investigation); `cli/lib/harness/codex-runtime.mjs` is the likely site.
- **Validate**: an issue exists with a repro, or a note that it did not reproduce.

### Part B: universal AI chat

#### Task B0: SPIKE the agent contract + security model (flow:spike, Opus)
- **Do**:
  - Settle Decisions 1–5 and write the DDR.
  - Prototype `bridge.start()` against real `codex-acp`, `opencode acp` and `gemini --acp` with a scratch project. For each, record: `initialize` capabilities (`loadSession`, `fs`, `terminal`), whether file reads/writes go through `fs/*` or happen in-process, whether `session/request_permission` fires before writes and shell, which sandbox/approval flags exist, its auth methods, and its env needs.
  - Output a capability matrix + the `bridge-enforced` rule set, and say which agents can reach parity with Claude's policy. Agents that cannot ship as "unrestricted" only (Decision 2).
- **Files**: `.ai/plans/notes/universal-acp-contract.md`, the DDR.
- **Risk**: security
- **Validate**: the matrix covers ≥ 3 agents with evidence (frame logs), and the DDR records the rejected alternatives.

#### Task B1: CREATE the descriptor, the catalog and discovery
- **Do**:
  - `descriptor.ts`: the Claude descriptor reproduces today's behaviour exactly.
  - `catalog.ts`: pinned entries for codex, gemini, opencode, github-copilot-cli, goose and cursor, registry-shaped with a source snapshot version in a comment.
  - `discover.ts`: look up the agent's bin on the login-shell PATH that the sidecar already gets (`sidecar.rs:282-345`); resolve shell wrappers and symlinks to the real binary (the `~/.claude/bin/codex` case); run `--version` with a **5 s timeout**; apply the min-version gate.
  - Never `npx`, never a network call.
  - Expose `GET /_api/agents` → `[{id,label,installed,version,connected,authKind}]`.
- **Files**: `apps/studio/acp/agents/*`, `apps/studio/routes/agents.ts` (route table per V2-2.5; privileged → NOT in `CANVAS_SAFE_API`).
- **Pattern**: `probe.ts` `resolveClaudePath` (override + SHA pin + `which`).
- **Gotcha**: a hanging `--version` (see A4) must not block readiness; probe lazily and cache per boot.
- **Validate**: `scripts/v2-test-lane.sh -- bun test ./test/acp-agents-discover.test.ts` (fail-first: fixtures with a wrapper script, a missing bin, a hanging bin).

#### Task B2: REFACTOR probe/bridge spawn onto the descriptor
- **Do**:
  - `start()` takes a descriptor: cmd/args, the runtime for JS adapters (`BUN_BE_BUN`), `envAllow`, and the actor/root env (`MAUDE_AGENT_ACTOR`, `MAUDE_SESSION_ROOT`, `MAUDE_READ_ROOTS`, …) for every agent.
  - Make `scrubAgentEnv` per descriptor. Default-scrub `OPENAI_*`, `GEMINI_*`/`GOOGLE_*` API keys, `GITHUB_TOKEN`/`GH_TOKEN` and `COPILOT_*` for every agent unless that agent allows them.
  - Error strings name the agent, not "Claude".
  - Check `loadSession` capability before resuming (today resume waits for a timeout).
- **Files**: `acp/probe.ts`, `acp/bridge.ts`, `acp/env.ts`, `acp/index.ts`.
- **Gotcha**: **every existing ACP test must stay green unchanged.** The Claude descriptor is the regression pin (`acp-bridge`, `acp-env`, `acp-session-plugins`, `acp-real-adapter-allowed-tools`, `acp-credential-deny`, …). Add a test that the Claude `_meta` payload is byte-identical before and after.
- **Validate**: `scripts/v2-test-lane.sh -- bun test ./test/acp-*.test.ts`.

#### Task B3: CREATE bridge-side policy for non-Claude agents
- **Do**: Implement `policy/enforce.ts` from the B0 rule set, applied when `descriptor.policy === 'bridge-enforced'`:
  - credential refusal and the read boundary on every permission request and on `fs/read_text_file`;
  - write scope on `fs/write_text_file` and edit-kind tool calls;
  - web-off on fetch-kind;
  - a launch-time sandbox flag where the agent has one;
  - a fail-closed reply when a request cannot be classified.
  - Advertise `fs:true` to these agents only if B0 shows they route file IO through the client (so the bridge sees every read).
- **Files**: `acp/policy/enforce.ts`, `acp/may-scope.ts`, `acp/write-scope.ts` (factor the Claude-name tables behind a descriptor lookup).
- **Risk**: security
- **Validate**: fail-first tests that replay recorded frames from B0 for each agent: credential path → refused, outside-root write → refused, unknown kind → refused. Then `/flow:validate --security` (defender + attacker) before B5 merges.

#### Task B4: ADD context and plugins for non-Claude agents
- **Do**:
  - Studio brief as a first-turn preamble.
  - At connect, offer once (consent card) to install `design` (+ `flow`) natively through `cli/lib/harness/targets/<agent>.mjs`. Record per agent and per profile that the offer was answered.
  - Agents without a target show "Maude commands aren't available in <agent>". The `maude design <verb>` CLI still works because `MAUDE_AGENT_ACTOR` confinement is env-based.
- **Files**: `acp/plugin-bootstrap.ts`, `acp/bootstrap-brief.ts`, `cli/lib/harness/*` (call only).
- **Gotcha**: never write into the user's `~/.codex` without consent. The harness install is a user-config write: keep it a `prompt`-tier action (`actions/verbs.ts`).
- **Validate**: unit tests for preamble + consent state; a manual run in a scratch HOME.

#### Task B5: SHIP Codex end to end in the chat
- **Do**:
  - Bundle the pinned `@agentclientprotocol/codex-acp` like the Claude adapter (`stage-resources.mjs`, `helper-deps.mjs`, root `package.json` for npm).
  - Codex auth status/login (`codex login status` / `codex login`).
  - `OPENAI_API_KEY` from BYOK as the alternative.
  - Sandbox per Decision 2.
  - Plugin install via the harness target.
- **Files**: `apps/studio/package.json`, `apps/desktop/scripts/stage-resources.mjs`, `apps/studio/acp/agents/catalog.ts`, `acp/login-state.ts` (generalise to per-agent `statusCmd`/`loginCmd`).
- **Gotcha**: DDR-177. Run `apps/desktop/scripts/check-bundle-completeness.mjs <built .app> --smoke` and `check-client-boots.mjs`. Never `npx` at runtime.
- **Validate**: a fake-Codex ACP agent in the e2e world (mirror the fake ACP agent from S6.16 / Phase 8 G2) + one live run on Michal's Mac with real Codex.

#### Task B6: ADD the agent picker and the Settings card
- **Do**: implement Design Decisions 1–6 exactly.
  - `ready`/`caps` frames gain `agent: {id,label}`.
  - A chat records its agent; the picker appears only with ≥ 2 connected agents.
  - The proactive empty-state line, with its dismissal stored in app prefs (`offer_dismissed:<agentId>`).
  - The Connect-sheet "Use another agent…" link.
  - Vendor badge + "X reported: …" error attribution.
  - Settings › Connections › **AI agents** card: detected list, Connect/Sign in, and the states. **Custom agent…** and own key come in the second ship, under Advanced.
  - Testids: `ai-agent-offer`, `ai-agent-offer-dismiss`, `connect-other-agent-link`.
  - Mode and model menus become generic over ACP `modes`/`configOptions`.
  - Add `data-testid`s (`ai-agent-picker`, `settings-agent-row-<id>`) to `TESTIDS.md` + `testids.json`. Add actions to the registry (`apps/studio/actions/`), not ad-hoc handlers.
- **Files**: `client/v2/ai/{AgentPicker.jsx,AiChatIsland.jsx,advanced-model.js,Composer.jsx}`, `client/panels/acp-capabilities.js`, `client/v2/settings/*`, `acp/index.ts` (frames).
- **Gotcha**: after client edits, rebuild `dist/client.bundle.js` release-minified and run `check-client-boots-source` (memory `maude-appjsx-boot-check`). Claude-only users must see **zero** visual change. Pin this with a screenshot diff of the panel and Settings.
- **Validate**: `scripts/v2-test-lane.sh -- bun test ./test/*agent*.test.ts` + the boot check + a desktop e2e lane `wdio.agents.conf.ts` (fake agents), run once alone (memory `maude-e2e-written-not-run`).

#### Task B7: ADD BYOK for chat
- **Do**:
  - Add a `chat` scope to `generation/keys.ts`, with per-agent env mapping (`OPENAI_API_KEY`, `GEMINI_API_KEY`, opencode provider keys).
  - Anthropic key for Claude only behind the Decision 4 opt-in, which amends the `env.ts` guardrail with a test.
  - Keys never go into `_server.json`, logs or the chat transcript. The ACP agent's Read deny rules (`credentialDenyRules`) cover `keys.json`.
- **Files**: `apps/studio/generation/keys.ts`, `acp/env.ts`, `client/v2/settings/connections-model.js`.
- **Risk**: secrets
- **Validate**: fail-first tests that a key reaches only its own agent's env and never appears in any frame.

#### Task B8: ROLL OUT the other catalog agents
- **Do**: For each of gemini, opencode, github-copilot-cli, goose and cursor: run the B0 conformance probe, add a fake-agent replay test and enable its catalog entry. An agent that fails policy parity ships as "unrestricted" (Advanced only) or stays off.
- **Files**: `acp/agents/catalog.ts`, its tests.
- **Validate**: one conformance test per agent.

#### Task B9: DOCUMENT and announce
- **Do**:
  - `desktop/index.mdx` "What AI needs" gains an **Other agents (Advanced)** section: detection, what is restricted, BYOK.
  - `codex.mdx` gains "Codex in Studio's chat".
  - Add a What's New entry via the `whats-new-entry` skill.
  - Regenerate the plugin surfaces if the `design:chat` command text changes (`node scripts/gen-plugin-surfaces.mjs`).
- **Files**: `site/content/docs/desktop/index.mdx`, `site/content/docs/codex.mdx`, `apps/studio/whats-new.json`.
- **Validate**: the `site-content` gate.

---

## Validation

1. **Static**: `pnpm lint`, `pnpm format`, typecheck (`cd apps/studio && bunx tsc --noEmit && bash scripts/check-tsc-coverage.sh`), the tests gate, `pnpm --filter @maude/site build`, the `site-content` gate. Run every suite through `scripts/v2-test-lane.sh`.
2. **Full studio suite on the mini** before any freeze (memory `maude-chain4-skips-full-suite`).
3. **Security**: `/flow:validate --security` after B3 and again after B7 (defender + attacker; AI/MCP attack surface is mandatory).
4. **Desktop**: `check-bundle-completeness.mjs --smoke` + `check-client-boots.mjs` on the built `.app` (B5), and the `agents` e2e lane.
5. **Manual**: real Codex, opencode and Gemini on Michal's Mac (sign-in, one edit, a refused credential read, resume after relaunch); a Claude-only user sees no change.

## Scenario Coverage

| Scenario | Covers | Status |
| --- | --- | --- |
| `site-terminal-quickstart` | homepage Advanced door → tab switch → copy → docs page, 375 px + desktop | 🆕 |
| `ai-agent-connect-codex` | Settings › AI agents → Codex detected → Sign in → chat picker → one edit → refused out-of-root write | 🆕 (fake agent) |
| `ai-claude-only-unchanged` | first run → Connect sheet → chat (no picker) | ✅ existing cold-start lane, extended with an assertion that no picker appears |

## Acceptance Criteria

- [x] The homepage and `/docs` show a working copy-paste terminal quick start (Claude Code + Codex); the commands are verified live.
- [x] `codex.mdx` reflects the published install; no stale "until published" text.
- [x] The Claude chat path is unchanged: every existing ACP test is green, the `_meta` payload is byte-identical, and Claude-only users see no UI change. *(The snapshot changed only by intended narrowings: added credential deny rules for `~/.codex/auth.json`, opencode `auth.json` and `~/.gemini/`, and vendor keys scrubbed from Claude's env. The AI panel is unchanged; Settings gained the always-present AI agents card on purpose, so Claude's API-key opt-in is reachable.)*
- [x] Codex runs in the Studio chat with bridge-enforced policy; the security review has no open blocker. *(Defender, attacker and verification reviews in `.ai/reviews/`; N1/S1 fixed in `bf3492c57`; S2/S3 open at low severity.)*
- [x] Detected agents appear only when installed locally; there are no network fetches or `npx` at runtime.
- [x] BYOK keys reach only their own agent and never a log or frame. *(Per profile. Gemini's key is not stripped from commands the person approves (review S2).)*
- [x] The DDR is recorded (agents contract + DDR-123 amendment); the What's New entry is pending; the roadmap is regenerated.

## Progress

- 2026-11-12, Part A done in `57dcbc453`. Quick start is in the homepage Advanced door, on the new `/docs/use-from-your-agent` page and in the docs index. The Codex guide now installs from the published marketplace. Install commands were verified in a scratch `CODEX_HOME` / `CLAUDE_CONFIG_DIR`.
- Finding: `codex plugin marketplace upgrade maude` timed out cloning the repo (Codex's 30 s clone limit, "early EOF"). The first `add` worked.
- A4: the hang reproduces. Each `codex plugin list --json` takes about 43 s with nine marketplaces, and `maude codex` runs several of them before every launch. Filed as https://github.com/1aGh/maude/issues/226 (not fixed here).
- 2026-11-12, Part B done (`8465634f1..9d118c833`):
  - Codex (0.154–0.166), opencode 1.18.30, Gemini 0.66 and Copilot 1.0.105 are bridge-enforced and offerable. Goose and Cursor stay unrestricted.
  - Three security reviews; every blocker is fixed.
  - Server e2e with real Codex and opencode: 35/35 PASS (`.ai/device/scenario-runs/universal-acp-agents-server/2026-11-12-1542/report.md`).
  - Desktop lane `pnpm test:e2e:desktop:agents`: 6/6 PASS (`.ai/device/scenario-runs/universal-acp-agents-desktop/2026-11-12-1534/`).
  - All quality gates and 990 `acp-*` tests are green.

## Retro

- **Good divergence: the spike measured first.** B0 measured five of the plan's security assumptions and found them wrong: bridge as read boundary, `fs:true`, `--sandbox`, the default Codex mode, bundling `@openai/codex`. Writing the spike from frame logs before any code saved a rewrite. **Change for `/plan`:** a security-heavy plan names its assumptions explicitly as "to be measured by the spike", not as decisions.
- **Bad divergence: "bridge-enforced" was claimed before the probe could prove it.** Root cause: the plan defined the policy class but not its proof; nothing tied flipping a policy to a full probe pass with positive controls. Two probe checks (Codex hooks, opencode project config) looked green and proved nothing until a control ran. **Change:** every conformance check ships with a positive control, and a policy flips only on a full pass.
- **Bad divergence: the person's own Mac leaked into the work.** A real `~/.opencode` plugin entered tests and probes. A `bun install` in the main checkout added pnpm links, which exposed that the link scan walked Maude's own folder. Root cause: the briefs said "scratch HOME" but not "scratch everything the agent resolves" (XDG data, `~/.opencode`, the git root above). **Change for `/execute` briefs:** list every config location an agent reads and require a scratch copy of each.
- **Good: the debate settled the UX up front.** One proactive line, Settings as the reference list, Claude stays the gate. It held through implementation, with one exception (the Settings card for Claude-only Macs, needed to reach the opt-in).
- **Worked: workers split by file ownership, the lead merges by cherry-pick.** About fifteen workers in total; only additive conflicts.
