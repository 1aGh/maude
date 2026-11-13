# Feature: AI chat in a Maude Cloud project in the browser, on the person's own API key

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

> **Status: proposed, gated.** Nothing in Part 1 or later starts before **Task 0** (owner sign-off on DDR-253, which reverses a decision recorded as *declined permanently*) and the **B0 spike** go/no-go. The spike can end this plan: if a stop condition in Task B0 fires, the browser keeps naming the desktop (d_6c21570e) and DDR-253 is withdrawn.

## Description

A person opens a Maude Cloud project **in the browser** (the studio served by the project's cloud cell). If they have saved their own API key in their account Settings (Anthropic first, then OpenAI and Gemini), the AI chat panel opens for them there, and the agent runs **in the project's cloud environment** on that key.

Nothing changes on the Mac. Maude Desktop keeps running agents locally exactly as in v2.3.0: Claude is the main sign-in, and Codex, opencode, Gemini and Copilot come through universal ACP (DDR-252).

**What "in the cell" means here (decided by the debate, see Solution):** the agent runs in an **agent sidecar container** that belongs to the project's cell. The cell's Worker starts it next to the cell, and it lives and sleeps with the project. It is **never a process inside the cell's own container**. That container holds `HUB_SECRET`, `MAUDE_PROJECT_TOKEN_KEY`, the R2 credentials and the tunnel token (`apps/cells/cell-config.mjs:782-877`). It also runs everything as one Unix user (`infra/cell/Dockerfile:73`) and has no sandbox primitive (no user namespaces, bwrap or seccomp). An agent with a shell there can read `/proc/<hub>/environ`. From the person's point of view it is still "the chat in my cloud project". The difference is a process boundary they never see.

## User Story

- As a member who can edit a Cloud project, I want to paste my own Anthropic (or OpenAI, or Gemini) key once in Settings and then chat with an agent on the project from any browser, so that I can work with AI without installing Maude Desktop.
- As a project owner, I want each person's AI use to run on their own key and only within their own role, so that one member never spends another's money or acts beyond what the project lets them do.
- As a desktop user, I want nothing to change, so that my local Claude sign-in and my other agents keep working as before.

## Problem

- **A Cloud project in the browser has no AI.** The chat entry is greyed. `ai.chat` and `ai.ask-fill-artboard` show the toast "AI chat is in the Maude desktop app." (`apps/studio/client/v2/shell/menu-runner.js:557-575`, `client/v2/ai/advanced-handlers.js:48`). The gate is `d.native`, not a cell flag.
- **That is by design, recorded four times:**
  - **d_6c21570e (Cloud Phase 25 B6):** declined *permanently*, for two independent reasons:
    - **Licensing:** a Pro/Max subscription may only drive the user's own CLI on their own machine.
    - **Security:** an agent with a shell next to a tenant's credentials.
  - **d_266d96e5 (A0):** the agent flow never goes to the cell, and ONE permission model is enforced at the cell.
  - **DDR-212:** the agent is *eliminated from the cell image*.
    - `CLOUD_ELIMINATED` in `apps/studio/cloud-build.ts:41-66` lists `acp/index.ts`, `bridge.ts`, `probe.ts`, `login-state.ts`, `plugin-bootstrap.ts`, `routes/agents.ts` and `generation/keys.ts`.
    - `scripts/check-cloud-binary.sh` pair-gates the sentinels `claude-agent-acp` and `@agentclientprotocol/codex-acp`.
  - **Cell refusals.** `apps/hub/src/studio-manifest.mjs:407,454-469` REFUSES `/_api/agents` and `/_api/acp/*` ("chats are per Mac, never a cell's"). `apps/studio/workspace-mode.ts:90+` `FORBIDDEN_ROUTE_PREFIXES` forbids `/_ws/acp`, `/_api/acp`, `/_api/claude` and `/_api/generate`.
- **What changed since:**
  - **Licensing.** With an **API key** the person pays per token on their own provider account. Anthropic's Agent SDK docs steer third parties to exactly that (quoted in DDR-123). d_6c21570e's licensing reason was about subscription OAuth and about *us* metering *our* keys. Neither applies to BYOK API keys.
  - **Security.** The security reason does not go away with BYOK, so this plan has to meet it rather than argue it away.
- **There is no place to keep a person's secret in the cloud.** `apps/cloud` has no at-rest encryption: `crypto.subtle` is used only for hashing and HMAC (`accounts.mjs:30`, `account-pages.mjs:657`, `cell-token.mjs:17`). `schema.sql` has no secrets table. The account pages (`account-pages.mjs:69-74`) have no "AI keys" door.
- **There is no write-capable capability for a non-browser actor.** The render token (`apps/hub/src/render-token.mjs`) is a stateless 15-minute HMAC carrying the subject and role. Render uses it at the viewer role, it cannot be revoked, and the canvas-origin route set it unlocks has no source-write route (DDR-088).

## Solution

### Shape (converged, debate `maude/cloud-cell-agent-sidecar-debate`)

```
browser (cell main origin) ──WS /_ws/agent──► cell hub (role check, proxy, audit)
                                                 │  start/stop via cell DO
                                                 ▼
                                agent sidecar container  (per project, own image, own class)
                                  env = allow-list only: MAUDE_AGENT_TOKEN, provider key, MAUDE_NO_EGRESS…
                                  maude-server --agent  +  acp/bridge.ts  +  claude-agent-acp
                                  works on a scratch checkout, reads/writes ONLY through the cell API
                                  with a per-subject, editor-role, short-lived, revocable agent token
                                  egress: provider API host(s) + the cell's own API, nothing else
control plane (cloud.maude.sh) ── account Settings › AI keys ── D1 `ai_keys` (envelope-encrypted)
                                  └─ hands the key to the sidecar at session start (service binding), never to the cell
```

**Transfers from universal ACP (DDR-252) unchanged:**
- `AgentDescriptor` and the pinned catalog (`acp/agents/catalog.ts`, `descriptor.ts`).
- `chat-key.ts`: key into `apiKeyEnv` after the shared scrub, with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` for Claude.
- `acp/env.ts` scrub, the bridge permission gate `acp/policy/enforce.ts` + `bridge-gate.ts`, the launch policies `launch-*.ts`, the conformance probe `acp/agents/conformance.ts` (run at image build and at boot, not per session), the transcript model, and the verb tier registry `apps/studio/actions/verbs.ts`.

**Does not transfer (different trust model):**
- **Discovery of installed CLIs (`discover.ts`) and vendor sign-in (`auth.ts`, `login-state.ts`).** The sidecar has a fixed, pinned set and no interactive login.
- **Per-profile keys in `~/.config/maude/keys.json`.** They become per-account rows in the control plane.
- **Subscription sign-in of any kind.** API keys only.
- **The Mac's read boundary.** That boundary is the agent's own sandbox plus `may-scope.ts` deny rules for the person's home. In the sidecar it is replaced by the container itself: there is nothing to deny because nothing private is there except the scratch checkout, and the checkout is what the person may read anyway.
- **"The agent runs as the person on their machine".** In the sidecar the agent runs as **the person's role in this project, through a token**, and the cell is the authority for every write (A0: one permission model, enforced at the cell).

### How the existing gates change: narrowed, never deleted

| Gate | Today | After this plan |
| --- | --- | --- |
| `CLOUD_ELIMINATED` (`cloud-build.ts`) | agent stack stubbed out of the cell binary | **unchanged.** The cell binary still carries no agent. The sidecar is a different artifact. |
| `check-cloud-binary.sh` | sentinels present in desktop, absent in cloud | **unchanged for the cell**, plus a **third column**: the agent sidecar image must CONTAIN `claude-agent-acp` and must NOT contain cell-only sentinels (to be defined in B0, e.g. `MAUDE_S3_SECRET_ACCESS_KEY`, `deriveSecret`, `cloudflared`). |
| `studio-manifest.mjs` REFUSED `/_api/acp/*`, `/_api/agents` | refused | **stays REFUSED.** The browser chat uses NEW routes (`/_ws/agent`, `/_api/agent/*`) that do not exist on the desktop and are classified explicitly in the manifest with the `summon` capability (already in `access/roles.ts:38`) at `edit` minimum. |
| `workspace-mode.ts` `FORBIDDEN_ROUTE_PREFIXES` (`/_ws/acp`, `/_api/acp`, `/_api/claude`, `/_api/generate`) | forbidden | **unchanged.** `/_api/agent/` is a new, explicitly-listed sandboxed prefix whose handler only proxies to the sidecar. It spawns nothing in the cell. |
| `assert-containment.sh`, `entrypoint.sh`, `check-containment.sh` (no browser in the cell) | enforced | **unchanged.** The sidecar image gets its OWN `assert-agent-containment.sh`: no browser, no cell secrets, and an env allow-list asserted at entrypoint. |
| DDR-193 §2 "no tenant TSX evaluated by vendor compute" | cell builds, never evaluates; render evaluates in `maude-render` | The sidecar **may run tool commands over tenant files**, which is evaluation-adjacent. DDR-253 extends DDR-230's rule: tenant content may be acted on by vendor compute only in a **secret-free, single-tenant, egress-restricted** process. The cell itself still never evaluates. |

## Decisions (recommendation first; DDR-253 records them, the B0 spike turns the measured ones into numbers)

1. **Where the agent runs: agent sidecar container per project.** It has its own Cloudflare container class, image `maude-agent`, and an env built by an allow-list in the cell DO. It is never a process in the cell container.
   - **Rejected: a sandboxed subprocess in the cell.** There is no sandbox primitive in the image or verified on Cloudflare Containers, it runs as the same uid as the hub, and it would need the cell gates loosened (`assert-containment.sh`'s own warning).
   - **Rejected: a separate stateless service like `maude-render`.** An agent session is stateful (a transcript, a checkout), so a per-project sidecar under the cell DO fits the lifecycle better. B0 compares both, and a standalone Worker app (`apps/agent`, mirroring `apps/render`) is the fallback if a second container class on the cells Worker is not possible.
2. **Which agent:**
   - **Phase 1:** Claude only, via `@agentclientprotocol/claude-agent-acp` + the Claude Agent SDK on `ANTHROPIC_API_KEY`.
   - **Phase 3:** `codex-acp` + `@openai/codex` on `OPENAI_API_KEY`, and the Gemini CLI `--acp` on `GEMINI_API_KEY`. Each is one descriptor and one image layer.
   - **Why Claude first:** the `design`/`flow` plugins are Claude Code-native (DDR-168 injection works as is), and `chat-key.ts` already has the Claude opt-in path.
   - **Size:** the darwin SDK native binary is 232 MB (`@anthropic-ai/claude-agent-sdk-darwin-arm64` 0.3.202). Expect about 230 MB for linux-x64, plus 3.3 MB adapter and 3.7 MB SDK JS. The agent weight lands in the sidecar image only. **The cell image does not grow.**
3. **Key custody:**
   - **Owner.** The key belongs to the **person (account)**, never the project. It mirrors DDR-252's per-profile rule.
   - **Entry.** It is typed **only on the control-plane origin** (`cloud.maude.sh` › Account › AI keys), never on a cell origin, which shares a hostname family with tenant canvas code.
   - **Storage.** D1 table `ai_keys(account_id, provider, ciphertext, iv, dek_wrapped, last4, created_at, rotated_at)`. AES-GCM with a per-row DEK wrapped by a KEK held as a Worker secret of the control plane only. The cells Worker and every container never hold the KEK.
   - **Visibility.** Write-only: the UI shows the provider and `…last4`, never the key. Keys are never logged, framed or returned.
   - **Delivery.** At session start the cells Worker asks the control plane over a **service binding** (not the public internet) for "key for (account, provider) for session S". The control plane checks that the account is a current Can-edit member of the project, decrypts, and returns the key once. The cells Worker puts it straight into the sidecar's start env, and it **never enters the cell container**.
   - **Rotation.** Replace the key: new sessions use the new key, and live sessions keep the old one until their next start (max session lifetime, see 6). Delete: the key row goes, and live sessions using it are stopped. **KEK rotation:** re-wrap the DEKs, scripted, and a runbook step.
   - **Rejected: SHIPPER's browser-held key** (sent each session, nothing at rest). It is simpler, but the request is a durable Settings key, and a key in cell-origin storage sits near tenant canvas code.
   - **"Does a browser-typed key ever leave the cell?"** It never *enters* the cell. It goes from the browser to the control plane, then from the control plane to the cells Worker to the sidecar env.
4. **Sandboxing inside the sidecar:**
   - **Filesystem.** A scratch checkout of the project, filled from the cell's read API with the agent token, plus a tmp HOME. No R2 credentials, no hub DB, no other project.
   - **Network.** Egress allowed only to the provider host(s) of the session's agent (e.g. `api.anthropic.com`) and to the project's cell API. It is enforced **at the network layer** (Cloudflare Containers outbound control, or an egress proxy in the sidecar plus `enableInternet=false`). **If B0 cannot prove it, stop.** Web fetch/search is off (`MAUDE_NO_EGRESS` semantics, d_68692bbe).
   - **CPU/memory.** The sidecar runs on its own instance type (B0 picks it: `standard-1`, 1/2 vCPU, 4 GiB, is the baseline). There is a per-turn wall-clock ceiling and a per-session RSS ceiling, and hitting either kills the run, not the cell.
   - **Concurrency.** One sidecar per project. In it, at most **2 concurrent sessions** (one per person). A separate `max_instances` for the agent class, initially 2, is a billing decision exactly like the cell's `max_instances = 5` note in `wrangler.toml`.
5. **Multi-person model:**
   - **Who may start.** Only **Can edit** (member) and owner, via the `summon` capability. Can view and Can comment never see the panel, only "Ask someone who can edit".
   - **Whose key pays.** Always the **person who started the session**. There is no project key and no "use the owner's key".
   - **Visibility.** A session is private to its person, like chats per Mac today. Other members see the agent's edits as edits by "<name>'s AI" in history and activity. The cell audit log records subject, session and provider for every write. Prompts are not logged.
   - **Role changes.** A role downgrade or removal revokes the agent token at the next write (the cell re-checks the role per write) and stops the session.
6. **Cost and limits:**
   - **Our bill is compute only; the provider bill is the person's.**
   - **Ceilings.** Per-turn wall clock, per-session idle stop (about 10 min), max session lifetime (about 4 h), sidecar sleep after idle (like the cell's 20 min), and per-account agent-minutes per month included in the €19 plan (the number is set after B0 measures cost per session-hour).
   - **Kill switch.** A control-plane flag `agentsEnabled` (global and per account) stops everything at once.
   - **Telemetry.** Count only (sessions, minutes, ceiling hits), never content. This is the same rule as d_2c8ff902's telemetry, since a ceiling hit is also the abuse signal.
7. **What replaces the CLI-dependent `/design:*` workflows:**
   - **Phase 1.** The sidecar ships the `maude` CLI and the bundled `design` plugin. File-only verbs work through the agent token (`slug`, `prep`, `bootstrap-check`, `draw-build`, `svg-optimize`, `canvas-rects` in **static** mode via `_canvas-rects-static.mjs`). Window verbs (`open`, `comments`, `history`, `trash`, `sync`) map to the cell's existing routes where one exists, or answer "desktop only" with the reason. No browser in the sidecar (DDR-230 keeps browsers in `maude-render`).
   - **Phase 2.** `screenshot`, `draw-proof` and `smoke` go through `maude-render` with a viewer render token, the exact grant render already uses. Human-tier verbs stay unavailable, as in the desktop chat.
   - **`/flow:*`** is not offered in the browser chat (it is a developer workflow over a repo with a terminal).
8. **Billing and terms:**
   - **API keys only.** No OAuth, no Claude Pro/Max, no ChatGPT subscription sign-in in the cloud, ever. Those stay device-bound on the Mac (DDR-123).
   - **Terms read before Part 1.** Before any code, the Anthropic, OpenAI and Google API terms are read and quoted into DDR-253 on one question: may a customer's own API key drive an agent on a third-party service the customer chose?
   - **Customer terms.** Maude's own terms and DPA gain one subprocessor line (none: the provider is the customer's own) and a paragraph on agent edits and key custody.
9. **Security review plan** (Task S1 before Part 1, Task S2 before release):
   - **Design review on DDR-253 plus this plan** (`flow:security-auditor` + `flow:ethical-hacker`, DDR-219 precedent). Mandatory threat cases:
     - (a) A teammate's canvas TSX, comment or annotation carries a prompt injection that steers member B's agent to exfiltrate project data or B's key over the provider egress (the lethal trifecta).
     - (b) A stolen agent token: what it can write, and for how long.
     - (c) A viewer reaching `/_ws/agent`.
     - (d) The control-plane key endpoint called for a non-member.
     - (e) The KEK or a key in logs, errors or crash dumps.
     - (f) Sidecar breakout to the cell (does it hold anything that reaches `HUB_SECRET`?).
     - (g) Cost abuse by a looping agent.
     - (h) A supply-chain bump of a pinned adapter.
   - **Implementation review** after Part 2. Each finding is closed or carried into DDR-253 by name.
10. **Phasing:** B0 spike, then Part 1 (custody and token), Part 2 (sidecar plus Claude chat behind a flag), Part 3 (more agents plus render verbs), and GA only after S2.

## Metadata

- **Type**: New Capability
- **Complexity**: High
- **App/Package**: cross-cutting (`apps/cells`, `apps/cloud`, `apps/hub`, `apps/studio`, new `infra/agent/`)
- **Affected Systems**: cloud cell DO + wrangler config, control plane (D1 schema, account pages, service binding), hub manifest + role matrix, studio server (new `--agent` mode), studio client chat panel (cell branch), private deploy repo `1aGh/maude-deploy` (new image lane, **owner-run only**)
- **Dependencies**: new agent image `ghcr.io/1agh/maude-agent` (built like `render-image.yml`); `@agentclientprotocol/claude-agent-acp` + `@anthropic-ai/claude-agent-sdk` linux build pinned via the existing catalog

## Context References

### Must-Read Files

- `.ai/archive/decisions/DDR-123-acp-chat-runs-on-users-claude-cli-subscription.md` — Why: licensing model this plan amends.
- `.ai/archive/decisions/DDR-252-universal-acp-agents.md` + `.ai/plans/notes/universal-acp-contract.md` — Why: descriptor, key injection, gate, probe: what transfers.
- `.ai/archive/decisions/DDR-230-render-workers-amend-containment-tenant-tsx-evaluates-only-in-maude-render.md` — Why: the precedent for a secret-free single-tenant service.
- `apps/studio/cloud-build.ts:41-100` and `scripts/check-cloud-binary.sh` — Why: the cell-image gates that must stay byte-identical.
- `apps/hub/src/studio-manifest.mjs:400-470` and `apps/studio/workspace-mode.ts:80-230` — Why: refusals and forbidden prefixes. The new routes are classified next to them.
- `apps/cells/cell-config.mjs:770-880`, `apps/cells/cell-do.mjs`, `apps/cells/wrangler.toml` — Why: how a cell's env is built, and where a second container class and its env allow-list go.
- `infra/cell/Dockerfile`, `infra/cell/entrypoint.sh`, `infra/cell/assert-containment.sh` — Why: the pattern for `infra/agent/`.
- `apps/hub/src/render-token.mjs` — Why: the token shape the agent token extends (revocable, per-subject, editor).
- `apps/render/wrangler.toml`, `apps/render/` — Why: fallback shape and idle policy.
- `apps/studio/acp/agents/{catalog,descriptor,chat-key,conformance}.ts`, `apps/studio/acp/env.ts`, `apps/studio/acp/policy/enforce.ts`, `apps/studio/acp/bridge.ts` — Why: reused agent stack.
- `apps/studio/access/roles.ts:26-60`, `apps/hub/src/role-matrix.mjs` — Why: the `summon` capability and the one role matrix.
- `apps/cloud/schema.sql`, `apps/cloud/account-pages.mjs:60-120`, `apps/cloud/db.mjs` — Why: where `ai_keys` and the AI keys page go.
- `apps/studio/client/v2/shell/menu-runner.js:550-580`, `apps/studio/client/v2/ai/advanced-handlers.js`, `apps/studio/actions/agents.ts:1553` — Why: the browser gate the chat replaces.

### Prior decisions (kgai: `kg search "agent never runs on our infrastructure"`, `kg search "cloud cell containment"`, `kg search "BYOK keys"`)

- d_6c21570e: agent never on our infra, *declined permanently* (licensing + security). **Reversed by DDR-253, conditionally.**
- d_266d96e5 (A0): sandbox the project in the cell, agent stays on the desktop, one permission model. **Agent clause amended; one-permission-model clause kept and relied on.**
- d_c35df391 (DDR-193 §2): containment invariant. **Kept for the cell; extended for the sidecar (as DDR-230 did).**
- d_a4434f76 (DDR-212) and d_86d9bf07: agent eliminated from the cell image. **Kept.**
- d_59e39d45 (DDR-230): render workers amend containment. **Precedent.**
- d_2c8ff902: build is not evaluation; ceilings are economically load-bearing; telemetry counts, never content. **Applied to agent ceilings.**
- d_b7cbbf35, d_6d288b75 (DDR-252 + amendment): chat keys per profile, person-only acts. **Mapped to per-account.**
- d_09d0ed09, d_cd77b385, d_2b25a4ff: universal-ACP security reviews. **Inputs to S1.**
- `maude/cloud-cell-agent-sidecar-debate` (this plan's debate, el_997381c2).

### Files to Create

- `.ai/archive/decisions/DDR-253-agent-sidecar-in-the-cloud-cell-on-the-persons-own-api-key.md` — the decision (drafted with this plan, status Proposed).
- `.ai/plans/notes/cloud-agent-b0-spike.md` — B0 measurements and the go/no-go.
- `infra/agent/{Dockerfile,entrypoint.sh,assert-agent-containment.sh}` — the sidecar image.
- `apps/studio/agent-mode.ts` — `maude-server --agent` boot: no `.design/` requirement, scratch checkout, cell-API file plane, ACP bridge, no studio UI.
- `apps/hub/src/agent-token.mjs` (+ test) — mint/verify/revoke.
- `apps/cloud/ai-keys.mjs` (+ test), migration in `apps/cloud/migrate.mjs` — encrypted key store + service-binding endpoint.
- `apps/studio/routes/agent-relay.ts` — the cell's `/_api/agent/*` + `/_ws/agent` proxy (role check, audit, no spawn).
- `apps/studio/client/v2/ai/cloud-chat/*` — the browser branch of the chat panel.
- `scripts/check-agent-image.sh` — the sidecar pair gate.
- `.github/workflows/agent-image.yml` — public image build (like `render-image.yml`). The deploy lane lives in the private repo and is the owner's job.

## Design Decisions (UI)

- **Components (reuse):** the v2 chat panel (`client/v2/ai/`) as on the desktop. The transcript, tool-call cards and permission cards come over the relay unchanged, since ACP frames are the same.
- **New surfaces, minimal:**
  1. **Account › AI keys** (control-plane page, `account-pages.mjs` pattern): one row per provider with `…last4`, Replace, Remove, and the line "Used only when you start the AI in a Cloud project in your browser. Your provider bills you directly."
  2. **Browser chat empty state** when no key is saved: "Add your Anthropic key in Account › AI keys to use the AI here. On the Mac, Maude Desktop uses your Claude sign-in." with a link to the control-plane page (a new tab, never an inline key field on the cell origin).
  3. **Role gate copy** for Can view / Can comment: "Only people who can edit start the AI here."
  4. **Edit attribution** in history: "<name>'s AI".
- **Keep d_6c21570e's corollary.** Where the cloud still lacks something (agent-only verbs before Phase 2), the panel *names* it ("Screenshots from the AI come in a later update; Maude Desktop has them today") rather than hiding it.
- Tokens, icons and density follow the existing chat panel. No new visual language.

## Tasks

Execute in order. Each task is a self-contained slice.

### Task 0: OWNER — sign off DDR-253 and read the provider terms

- **Do**: The owner (Michal) reads DDR-253 (Proposed). This is a reversal of a *declined permanently* decision, so only the owner can accept it. Record the answer to the terms question for Anthropic, OpenAI and Google (link + quote ≤ 15 words each) in DDR-253 § Terms. Decide the open numbers left to the owner: the included agent-minutes in the €19 plan, and whether Phase 1 is Claude-only.
- **Files**: `.ai/archive/decisions/DDR-253-*.md`
- **Validate**: DDR-253 status line reads `Accepted (conditional on B0 + S1)`, and `maude kg import --dry-run` shows it.

### Task B0: SPIKE (`flow:spike`, measured; about 3 days) — can the sidecar exist, honestly?

- **Do**: Prototype, outside `main` (worktree), against a local cell (`maude-local-cell-needs-node-24`) and one throwaway Cloudflare account/app. Never touch the production fleet, `maude-deploy` or the release tags. Measure and write `.ai/plans/notes/cloud-agent-b0-spike.md`:
  1. **Second container class.** Can a second container class on the cells Worker, started by the project's DO, receive an env built by an allow-list? Compare it with a standalone `apps/agent` Worker app modelled on `apps/render`.
  2. **Egress.** Can Cloudflare Containers restrict outbound traffic to a host allow-list at the network layer (`enableInternet=false` + Worker-mediated outbound, or an in-container egress proxy that the agent cannot bypass)? Prove it with a red/green test: a `curl https://example.com` from the agent's tool shell must fail, and `api.anthropic.com` must work. **Stop condition: it can't be enforced.**
  3. **Image and cold start.** Image size (linux-x64 SDK binary + adapter + `maude` + `design` plugin), cold start to first ACP `initialize`, and time to first token on `standard-1`. **Stop condition: cold start > 20 s p95, or RSS of one session > 2.5 GiB.**
  4. **Checkout round trip.** Fill time for a real project (alligators-sized, about 280 MB) through the cell read API, and one edit round trip: prompt → agent edits a TSX → cell accepts the write under the agent token → the browser canvas reloads.
  5. **Cost.** Cost per active session-hour and per idle-sleeping sidecar-day, against the €19 plan.
  6. **Env.** Assert that the sidecar env holds nothing but the allow-list (dump `env` and `/proc/1/environ` in the prototype).
- **Files**: spike worktree only; the note is the deliverable.
- **Gotcha**: run nothing that hits the real fleet. Boot studio servers with `NO_OPEN=1`. Stub `claude` in any throwaway-HOME harness unless the real API key path is the thing being measured (`maude-fake-home-real-claude-keychain`).
- **Validate**: the note has a numbers table plus a GO / NO-GO line per stop condition. NO-GO on 2 or 3 ends the plan (DDR-253 → Withdrawn).

### Task S1: Security design review (before Part 1)

- **Do**: Run `/flow:validate --security` scoped to DDR-253 + this plan + the B0 note (design-only review, `flow:security-auditor` + `flow:ethical-hacker`). It covers threat cases (a)–(h) from Decision 9. Every blocker becomes a task in Part 1 or 2, or a named stop.
- **Files**: `.ai/reviews/security-cloud-agent-design-<date>.md` (and the graph node).
- **Validate**: 0 open blockers, or the plan is amended.

### Part 1: custody and capability (no agent yet)

#### Task 1.1: CREATE the encrypted per-account key store in the control plane

- **Do**: Add the D1 migration `ai_keys` (Decision 3 columns) and `apps/cloud/ai-keys.mjs`. It provides `putKey(account, provider, key)`: generate a DEK, AES-GCM-encrypt, wrap the DEK with `AI_KEYS_KEK` (Worker secret), and store `last4`. It also provides `removeKey` and `listKeys` (provider + last4 + dates only). The provider is an enum (`anthropic | openai | gemini`). Validate the key shape per provider (prefix + length only, **no live call** to the provider from our side).
- **Files**: `apps/cloud/ai-keys.mjs`, `apps/cloud/ai-keys.test.mjs`, `apps/cloud/migrate.mjs`, `apps/cloud/schema.sql`
- **Pattern**: `apps/cloud/accounts.mjs` (D1 access), `migrate.mjs` existing steps
- **Gotcha**: the key never appears in logs, errors, `audit_log` details or test snapshots. Add a test that greps captured console output for the plaintext. A missing KEK is a refusal, not a plaintext fallback.
- **Validate**: `node --test apps/cloud/ai-keys.test.mjs` (fail-first: a test that reads the row and asserts it is not the plaintext goes red against a stub that stores plaintext)

#### Task 1.2: ADD the Account › AI keys page

- **Do**: A new door in `account-pages.mjs`: a form POST with the existing CSRF HMAC (`account-pages.mjs:657`), write-only fields, Replace/Remove, and the copy from Design Decisions 1. Every change writes an `audit_log` row (provider + last4, never the key).
- **Files**: `apps/cloud/account-pages.mjs`, `apps/cloud/account-pages.test.mjs`
- **Pattern**: the `emails` door
- **Validate**: `node --test apps/cloud/account-pages.test.mjs`

#### Task 1.3: CREATE the service-binding key handout

- **Do**: An internal control-plane endpoint, reachable only over the cells Worker's service binding (no public route). It takes `{account, project, provider, sessionId}`, checks that the account is a current Can-edit member of the project (`membership.mjs` / `grants.mjs`), and returns the decrypted key once. It is audited and rate-limited per account. The cells Worker side receives it, and the value goes only into the sidecar start env (Task 2.2).
- **Files**: `apps/cloud/ai-keys.mjs`, `apps/cloud/edge.mjs` (binding wiring), `apps/cells/wrangler.toml` (service binding), tests
- **Gotcha**: a public request to the path must 404 (test it). Owner-run deploy config for the binding lives in `1aGh/maude-deploy`, so write the wrangler.toml change here and leave the deploy to the owner.
- **Validate**: `node --test apps/cloud/*.test.mjs apps/cells/*.test.mjs`

#### Task 1.4: CREATE the agent token (per subject, editor, short-lived, revocable)

- **Do**: `apps/hub/src/agent-token.mjs`, mirroring `render-token.mjs`'s HMAC format with three differences:
  - **Claims:** `kind:'agent'`, `sid` (session id), `sub` (account), `project`, `role` at mint time, and a TTL of at most 15 min, re-minted by the cell while the session lives.
  - **Revocation:** a per-session revocation set in the cell (session stop, role change, key removal), checked on every use.
  - **Scope:** writes are allowed only to canvas source, `.meta.json`, board and asset routes that a member may write. **The role is re-read from the role matrix on every write**, never trusted from the token.
- **Files**: `apps/hub/src/agent-token.mjs`, `apps/hub/src/agent-token.test.mjs`, `apps/hub/src/access-gate.mjs`
- **Pattern**: `apps/hub/src/render-token.mjs`, `role-matrix.mjs` `decide()`
- **Risk**: auth
- **Validate**: `pnpm --filter @maude/hub test` (fail-first: a revoked `sid` still writing must go red against a non-revoking stub; a member downgraded to viewer must be refused on the next write)

### Part 2: sidecar + Claude chat in the browser (behind `agentsEnabled`)

#### Task 2.1: CREATE the sidecar image and its containment gate

- **Do**: `infra/agent/Dockerfile`: a node/bun base, compiled `maude-server`, `maude` CLI, bundled `design` plugin, and the pinned `claude-agent-acp` + linux SDK, installed **frozen** from a committed lockfile (the hub rule: never re-resolve in a Dockerfile). `entrypoint.sh` asserts the env allow-list (refuse to boot on any other variable matching `*SECRET*|*TOKEN*|MAUDE_S3_*` except `MAUDE_AGENT_TOKEN`). `assert-agent-containment.sh`: no browser, no `cloudflared`. `scripts/check-agent-image.sh` is the pair gate (Decision table). Add `.github/workflows/agent-image.yml` to build and publish `ghcr.io/1agh/maude-agent:vX.Y.Z` on `v*.*.*` tags only.
- **Files**: `infra/agent/*`, `scripts/check-agent-image.sh`, `.github/workflows/agent-image.yml`, `scripts/test/workflow-invariants.test.mjs` (assert the new workflow reads no fleet token)
- **Pattern**: `infra/cell/*`, `render-image.yml`, `apps/hub/Dockerfile` frozen install
- **Gotcha**: **do not touch** `CLOUD_ELIMINATED`, `CLOUD_FORBIDDEN_STRINGS`, `check-cloud-binary.sh` or `infra/cell/assert-containment.sh`. If a step seems to need it, the design has drifted: stop (d_2c8ff902's rule). Version lockstep: if the image tag joins the release, extend `bump-version.sh` + `check-version-parity.sh` in the same change.
- **Validate**: `scripts/check-agent-image.sh` and `scripts/check-cloud-binary.sh` (the latter unchanged and green)

#### Task 2.2: ADD the agent container class and its start path in the cell DO

- **Do**: Add a second container class in `apps/cells` (or `apps/agent` per B0). The DO starts it on the first session and stops it after idle. The env is built from an explicit allow-list: `MAUDE_AGENT_TOKEN`, `MAUDE_AGENT_CELL_URL`, `MAUDE_AGENT_PROVIDER`, the provider key from Task 1.3, `MAUDE_NO_EGRESS=1`, and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`. Egress is restricted per the B0 result. Set a separate `max_instances` (initially 2) with a billing comment like the cell's. A test asserts that the built env never contains `HUB_SECRET`, `MAUDE_PROJECT_TOKEN_KEY`, `MAUDE_S3_*`, `MAUDE_RENDER_SECRET` or `MAUDE_TUNNEL_TOKEN`.
- **Files**: `apps/cells/cell-do.mjs`, `apps/cells/agent-config.mjs` (+ test), `apps/cells/wrangler.toml`
- **Pattern**: `apps/cells/cell-config.mjs` env build
- **Risk**: secrets
- **Validate**: `node --test apps/cells/*.test.mjs`

#### Task 2.3: CREATE `maude-server --agent` mode

- **Do**: A boot mode with no studio UI, no canvas origin and no `.design/` precondition. It hydrates a scratch checkout from the cell API with the agent token, runs the ACP bridge (`acp/bridge.ts`) with the Claude descriptor and `chat-key.ts` injection, and writes back through the cell API (the cell is the authority). It exposes ACP over one authenticated WebSocket to the cell relay only. It reuses `acp/policy/enforce.ts` for tool permissions and `actions/verbs.ts` tiers for `maude design <verb>`. File-only verbs work; window verbs map to cell routes or answer "desktop only".
- **Files**: `apps/studio/agent-mode.ts`, `apps/studio/server.ts` (hand-off like `runHome()`), `apps/studio/test/agent-mode.test.ts`
- **Pattern**: `home/main.ts` hand-off before `createContext()`, `acp/bridge.ts`
- **Gotcha**: paths via `paths.ts` (DDR-045). Run the studio suite only through `scripts/v2-test-lane.sh -- …`, alone on the machine.
- **Validate**: `scripts/v2-test-lane.sh -- bun test ./test/agent-mode.test.ts`

#### Task 2.4: CREATE the cell relay `/_api/agent/*` + `/_ws/agent`

- **Do**: The cell routes `routes/agent-relay.ts`. They check the caller's role (`summon` at edit or above), mint and refresh the agent token, ask the cells Worker to start or stop the sidecar, proxy ACP frames both ways, and audit every session start and stop and every write. **They spawn nothing in the cell.** Classify them in `studio-manifest.mjs` (new entries, the old REFUSED entries untouched) and in `workspace-mode.ts` as an explicitly allowed sandboxed prefix. Add them to the route table (`routes/index.ts`). They are not canvas-origin routes: the main origin only, `isSameOriginWs`.
- **Files**: `apps/studio/routes/agent-relay.ts`, `apps/studio/routes/index.ts`, `apps/hub/src/studio-manifest.mjs`, `apps/studio/workspace-mode.ts`, tests (`test/canvas-origin-parity.test.ts` must stay green and must NOT list them)
- **Risk**: auth
- **Validate**: `scripts/v2-test-lane.sh -- bun test ./test/agent-relay.test.ts ./test/canvas-origin-parity.test.ts ./test/workspace-containment.test.ts`

#### Task 2.5: UPDATE the browser chat panel for a cell

- **Do**: In a cell (not `d.native`), `ai.chat` opens the panel when `/_api/agent/status` says `{enabled, hasKey, canSummon}`. Otherwise it shows the empty states from Design Decisions 2 and 3. Rewrite the old toast in `menu-runner.js` and `advanced-handlers.js` to the new states. Add edit attribution "<name>'s AI" in history. Testids: `cloud-chat-*`, listed in `client/TESTIDS.md` + `testids.json`. Rebuild the committed bundle release-minified (`MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`) and run `check-client-boots-source` (app.jsx rule).
- **Files**: `apps/studio/client/v2/ai/cloud-chat/*`, `client/v2/shell/menu-runner.js`, `client/v2/ai/advanced-handlers.js`, `apps/studio/actions/agents.ts`, `client/TESTIDS.md`, `testids.json`, `dist/client.bundle.js`, `dist/styles.css`
- **Validate**: `scripts/v2-test-lane.sh -- bun test ./test/<chat tests>`, then a live render smoke against a local cell

#### Task 2.6: ADD ceilings, kill switch, telemetry

- **Do**: Implement Decision 6: the per-turn wall clock, idle stop, max lifetime, per-account monthly minutes, and `agentsEnabled` global + per-account in the control plane. Counts only go to the existing cell `/health` → Analytics Engine channel.
- **Files**: `apps/cells/cell-do.mjs`, `apps/cloud/fleet.mjs` / `analytics.mjs`, tests
- **Validate**: `node --test apps/cells/*.test.mjs apps/cloud/*.test.mjs`

### Part 3: more agents and render-backed verbs (after Part 2 soaks)

#### Task 3.1: ADD Codex and Gemini to the sidecar

- **Do**: One descriptor each (already in `catalog.ts`). Install `codex-acp` + `@openai/codex` and the Gemini CLI frozen into the image as separate layers, and run the conformance probe at image build. Add the provider choice in the browser panel limited to providers with a saved key, and add their egress host per session.
- **Files**: `infra/agent/Dockerfile`, lockfile, `apps/studio/agent-mode.ts`, `scripts/check-agent-image.sh`
- **Validate**: `scripts/check-agent-image.sh`; conformance green per agent

#### Task 3.2: ADD `screenshot` / `draw-proof` / `smoke` through `maude-render`

- **Do**: The sidecar's `maude design screenshot` asks the render service with a viewer render token minted by the cell (the existing DDR-230 grant), not a browser in the sidecar.
- **Files**: `cli/lib/design-*.mjs`, `apps/studio/agent-mode.ts`
- **Validate**: CLI tests + one live render round trip on a local cell + render

### Task S2: implementation security review + release gate

- **Do**: Run `/flow:validate --security` over Parts 1–2 (and 3 when shipped). Re-run threat cases (a)–(h) against the code, plus the egress red/green test and the env-dump test on a deployed sidecar in the throwaway Cloudflare app. A What's New entry via `whats-new-entry` lands only at GA.
- **Validate**: 0 open blockers. `scripts/check-cloud-binary.sh`, `scripts/check-containment.sh` and `scripts/check-agent-image.sh` are all green.

## Validation

1. **Static**: `pnpm lint`, `bunx tsc --noEmit` + `scripts/check-tsc-coverage.sh`, `node --test` for `apps/cloud`, `apps/cells`, `cli`; `pnpm --filter @maude/hub test`; the studio suite only via `scripts/v2-test-lane.sh` (alone on the machine, or on the Mac mini lane).
2. **Containment gates, all green and the cell ones UNCHANGED**: `scripts/check-cloud-binary.sh`, `scripts/check-containment.sh`, `infra/cell/assert-containment.sh`, the new `scripts/check-agent-image.sh`.
3. **Live** (local cell + local sidecar, then the throwaway Cloudflare app): a member with a key chats and edits, and the canvas updates. A viewer is refused. Removing the key stops the session. The egress red/green test passes, and the env dump shows only the allow-list.
4. **Desktop untouched**: the desktop e2e lanes for ACP (`tabs`, the universal-ACP lane) are green with no diff in `apps/desktop` or the desktop chat path.

## Scenario Coverage

| Scenario | Covers | Status |
| --- | --- | --- |
| `cloud-chat-byok` | member saves Anthropic key → opens Cloud project in browser → chats → agent edits a canvas → edit attributed | 🆕 new |
| `cloud-chat-role-gate` | Can comment sees "Only people who can edit…", no `/_ws/agent` | 🆕 new |
| `cloud-chat-no-key` | Can edit without a key sees the Account › AI keys link | 🆕 new |
| existing desktop ACP lanes | desktop unchanged | ✅ existing |

Web-only feature (browser studio). Native iOS/Android are not applicable and are skipped with that reason.

## Acceptance Criteria

- [ ] Task 0 signed by the owner; provider terms quoted in DDR-253
- [ ] B0 note with numbers and GO on every stop condition
- [ ] S1 and S2: 0 open blockers
- [ ] The cell binary, `CLOUD_ELIMINATED`, `CLOUD_FORBIDDEN_STRINGS`, the REFUSED `/_api/acp/*` + `/_api/agents` entries and the browser-free cell guards are byte-identical to v2.3.0
- [ ] The sidecar env is the allow-list only, proven by a test and a deployed env dump
- [ ] Egress allow-list proven red/green on a deployed sidecar
- [ ] The key is never in a log, response, frame, cell request body or test snapshot (tests)
- [ ] Desktop chat path and e2e lanes unchanged
- [ ] DDR-253 Accepted; roadmap regen committed; What's New entry at GA

## Risks

- **Prompt injection across members (the lethal trifecta)** — it is reduced (no cell secrets, egress pinned to the provider), **not removed**: a teammate's content can still steer B's agent to leak *project* data through the model's own output to B's provider account. Mitigations: provenance tagging of canvas content in the agent's context, destructive-write confirmation cards (the existing bridge gate), and web off. This stays a named residual risk in DDR-253.
- **Egress control on Cloudflare Containers** is unverified. It is a B0 stop condition, not an assumption.
- **Cost on our bill** (Active-CPU while the tenant pays flat) — handled by ceilings + measured in B0 before pricing is set.
- **Two-person incident response** — the kill switch is the first runbook step. A key-leak runbook (revoke = delete row + stop sessions) is written in S1, before release.
- **Supply chain**: three vendor agent CLIs released weekly become server-side dependencies. Pins + frozen lockfile + conformance at image build; bumps are deliberate releases.
- **Preserved dissent (BREAKER, quoted):** "don't build it — every BYOK user could install the desktop; the pull is the owner wanting it, not users being blocked." Answered by Task 0 (an explicit owner decision) and by the B0 stop conditions, not by argument.

**Confidence for one-pass implementation: 4/10** (high unknowns, all front-loaded into B0 and S1; after a GO on B0, Parts 1–2 are about 7/10).
