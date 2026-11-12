# DDR-252: Any ACP agent in the Studio chat — the agent's own sandbox holds the boundary, the bridge holds the gate

- **Date:** 2026-11-12
- **Status:** Proposed (B0 spike; accepted when B3's conformance probe is green for Codex)
- **Tags:** acp, security, agents, codex, opencode, gemini, byok, least-privilege
- **Related:**
  - plan `.ai/plans/feature-universal-acp-and-codex.md`;
  - contract note `.ai/plans/notes/universal-acp-contract.md` (evidence: `.ai/plans/notes/universal-acp-frames/`);
  - DDR-123 (amended here);
  - DDR-054 (untrusted served project);
  - DDR-143/168 (session plugins);
  - DDR-177/044 (self-contained bundle, frozen installs);
  - DDR-185 (read-only allow-list);
  - decisions `maude/universal-acp-agent-offer-ux`, `maude/codex-agent-isolation-boundary`, `maude/v2-8.9-lead-m2-deny-credential-reads-only`, `maude/v2-michal-m2-read-boundary`.

## Context

The Studio chat runs only Claude Code. All of Maude's least-privilege policy for the agent rides in `_meta.claudeCode.options` (`acp/bridge.ts` `newSessionParams`):

- the credential read-denies;
- the folder-scoped read allow-list;
- web off;
- `settingSources:['user']`;
- plugin injection.

A non-Claude ACP agent ignores that block. We want Codex first, then other ACP agents, without losing that policy.

The B0 spike ran three agents through a frame-logging ACP client:

- `@agentclientprotocol/codex-acp` 2.6.0 (codex 0.166.0 and the user's 0.154.0);
- `opencode acp` 1.18.30;
- `gemini --acp` 0.67.0.

Each ran with a scratch HOME. Prompt turns were driven by a **local scripted model** on loopback, with no account and no network. Findings:

- **No agent routes its reads through the client.**
  - Codex never sends `fs/*`.
  - opencode sends `fs/write_text_file` only as a mirror after it has already written; a refused call still leaves the file written.
  - Gemini proxies only in-root paths.
  - So the ACP bridge cannot be the read boundary.
- **With default settings both runnable agents read a planted secret outside the project silently**, with no permission request.
- **Codex has a real OS sandbox.**
  - A Codex permission profile can deny reads per path (`"/Users" = "none"` plus re-allowed roots works as an allow-list; most specific wins).
  - Measured on 0.154 and 0.166, and through codex-acp's app-server.
  - Writes outside the workspace and the network are denied too.
  - The codex-acp **default mode `agent` sends escalations to Codex's own model reviewer ("Guardian"), never to the client.**
- **opencode has no sandbox, but its permission engine refuses out-of-project reads, writes, globs and even `bash cat ../x`** under `external_directory:"deny"`.
  - Its boundary is the git root.
  - A `read:"ask"` permission request carries no path.
- Gemini needs an API key before `session/new`; it was not judged.

## Decision

1. **Every agent is a descriptor** (`acp/agents/descriptor.ts`, shape in the contract note) with one of three policies:
   - `claude-meta` (today's path, byte-identical);
   - `bridge-enforced`;
   - `unrestricted`.
2. **`bridge-enforced` means Maude enforces policy in three layers:**
   - **(a) Launch policy, the boundary.** An agent-native sandbox or permission configuration that Maude generates per session from the same scope the Claude path uses (read roots, write root, credential stores, "AI may" switches) and passes by env:
     - Codex: `INITIAL_AGENT_MODE=workspace-write` + a `CODEX_CONFIG` permission profile with `web_search="disabled"`.
     - opencode: `OPENCODE_CONFIG_CONTENT` permissions + `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
   - **(b) Bridge gate.** On `session/request_permission`, keyed on ACP `kind` + `locations` + `rawInput`, never on tool names:
     - credential refusal;
     - write scope;
     - web-off;
     - Codex escalations always go to the person;
     - "always" options are never chosen and are stripped;
     - unknown kinds and target-less requests are refused;
     - dangerous modes cannot be selected.
   - **(c) Conformance probe.** The real binary, with production launch policy, is driven by a loopback scripted model through fixed tool calls. Pass/fail is judged from the tool output the model received. It runs at connect and on version change. A failing agent becomes `unrestricted` or Unavailable. A tool update that contradicts the launch policy ends the session (the tripwire).
3. **`fs` and `terminal` stay unadvertised** for every non-Claude agent (as for Claude).
4. **Verdicts from B0:**
   - Codex: `bridge-enforced` (first ship).
   - opencode: `bridge-enforced` with two named gaps: shell checked by command text only, and the boundary is the git root. Second ship.
   - Gemini: not judged. Its probe runs through its `gateway` auth method in B8.
   - Copilot, goose, cursor: not probed; `unrestricted` until probed.
5. **Adapters.**
   - codex-acp is bundled, pinned (a release at least 2 weeks old, re-probed on bump) and staged as its single pure-JS file (`dist/index.js`, 11 MB, node builtins only). It runs under the bundled bun with `CODEX_PATH` set to the user's own `codex`.
   - `@openai/codex` (347 MB native per platform) is **not** bundled.
   - Agents with a native `acp` entry run the user's binary.
   - Nothing is ever `npx`-ed or fetched at runtime.
6. **UX (taken in the plan's debate with Michal, 2026-11-12, recorded here unchanged).**
   - Awareness comes only from local evidence; a user with nothing else installed sees zero change.
   - One quiet line in the AI panel's empty state: "Codex is on this Mac. Use it in Maude too? · Connect · Not now". It appears only when:
     - Claude is connected and idle;
     - the agent is in the pinned catalog, passed bridge-enforced conformance, and has a tested version;
     - the agent is not yet connected.
   - Several detected agents share one line. "Not now" is permanent per agent.
   - Connect only registers the agent and starts that vendor's own sign-in.
   - Settings › Connections › **AI agents** is the reference list (states: Connected · Sign in · Untested version · Unavailable). Its folded Advanced holds Custom agent… and own API key. *(Amended 2026-11-12, security review M3: an own API key is per profile and has no per-project consent card — the person types it into Settings themselves, which is the consent; the key routes accept only the person's own page, `personRequest`. Custom agents keep the per-project consent card.)*
   - The Connect sheet stays Claude-only, with one quiet "Use another agent…" link to Settings, shown only when a bridge-enforced agent is detected.
   - The agent chip in the composer appears only with ≥ 2 connected agents. A chat keeps the agent it started with.
   - Replies carry a vendor badge; errors read "Codex reported: …".
   - `unrestricted` and custom agents are never offered.
7. **BYOK (amends DDR-123).**
   - Chat keys live in the existing BYOK store (`generation/keys.ts`), **per profile** (`chatByProfile.<profile>.<agent>`, amended 2026-11-12, security review M3), like the Claude opt-in key: a work profile's chat never runs on the personal profile's key. A key stored before the change (the global `chat` scope) stays readable for the `default` profile only and moves under it on the next key write.
   - A key is injected **only** into the env of the agent it belongs to: `OPENAI_API_KEY` → Codex, provider keys → opencode, `GEMINI_API_KEY` → Gemini.
   - Every other agent's env default-scrubs `OPENAI_*`, `GEMINI_*`/`GOOGLE_*` keys, `GITHUB_TOKEN`/`GH_TOKEN`, `COPILOT_*` and `OPENCODE_*` credentials.
   - **DDR-123 is amended:** an Anthropic API key for the Claude agent is allowed **only** as an explicit, per-profile Advanced opt-in ("Use my Anthropic API key instead of my Claude subscription — billed per token").
     - With the opt-in off (the default), `env.ts` keeps scrubbing `ANTHROPIC_*` exactly as today.
     - With it on, the bridge re-adds only `ANTHROPIC_API_KEY` from the key store after the scrub. It never takes it from the inherited env.
     - The panel shows "API key" instead of the plan badge.
   - DDR-123's guarantee becomes "never metered billing **unless the person turned it on in Maude**", rather than "never".
8. **Context and plugins.**
   - The studio brief is a first-turn preamble, or `systemPrompt` where the agent advertises it (codex-acp does).
   - `design`/`flow` are installed natively through the harness targets only with consent.
   - Agents without a target get the brief and the label "Maude commands unavailable in this agent".

## Alternatives rejected

- **Enforce everything in the bridge on `fs/*` + `request_permission` (the plan's first sketch).** Measured impossible. No agent sends reads through `fs/*`. opencode's write mirror is post-hoc, and refusing it does not stop the write. Codex reports no frame for sandbox-denied commands. A bridge-only boundary would be a boundary in name.
- **Advertise `fs:true` so the bridge sees IO.** It changes nothing for Codex/opencode reads, invites double writes, and widens the surface. Rejected for every non-Claude agent.
- **Codex's default mode (`agent`, auto review) with the bridge as backstop.** Escalations go to Codex's own model reviewer and never reach the person or the bridge. Refused as a selectable mode, along with `agent-full-access`.
- **Codex `workspace-write` alone (the plan's Decision 2 text).** It confines writes and network but **not reads**: a credential file outside the project was read silently. The custom permission profile is required.
- **Bundle `@openai/codex` with the adapter.** 347 MB per platform, a second Codex binary the user never installed, its own auth state, and its own update cadence. We point `CODEX_PATH` at the user's binary instead.
- **`npx` adapters / the live public ACP registry.** Runtime code fetch and a supply-chain path into an auto-approving session (DDR-044, DDR-177). Rejected; the catalog is curated and pinned.
- **Ship non-Claude agents as "unrestricted" only.** Codex can reach (for shell, exceed) the Claude path's guarantees, so this gives up a measurable win. Unrestricted stays the fallback for agents that fail the probe.
- **Trust a vendor's own approval prompts (e.g. opencode `read:"ask"`) as the read boundary.** opencode's read request carries no path, so neither the bridge nor the person can decide it. The boundary has to be set in config, not answered per call.
- **Keep DDR-123 absolute (no Anthropic key ever).** It blocks people without a Pro/Max plan from the agent with full Maude commands. The opt-in keeps the default subscription-correct and makes the billing switch explicit and visible.

## Consequences

- B3 owns `acp/policy/enforce.ts` (rules 1–15 in the contract note) and per-agent launch-policy builders. Its replay tests use the B0 frame logs.
- A conformance fixture (scripted loopback model + client) becomes part of the test suite and of the connect flow.
- A Codex refusal ends the turn, so the panel must say why ("Codex stopped: Maude refused …").
- opencode's "Connected" cannot mean "signed in": it runs on a free hosted model with no account. The connect step must show where prompts go.
- Open questions with defaults (contract note):
  - Codex app-server compatibility with 0.154 (default `minVersion` 0.166 until probed);
  - opencode `external_directory` path maps;
  - the agent's own MCP servers and hooks (default: empty in the launch policy);
  - sub-agents inheriting the sandbox;
  - opencode agent-level permission overrides.
