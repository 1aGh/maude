# DDR-253: The agent may run in a Cloud project, in a secret-free sidecar of the cell, on the person's own API key

- **Date:** 2026-11-13
- **Status:** Proposed. It needs the owner's sign-off (plan Task 0), because it reverses a decision recorded as *declined permanently*. It becomes Accepted only after the B0 spike says GO on every stop condition and the S1 security design review has no open blockers. If B0 says NO-GO, it is Withdrawn and d_6c21570e stands as written.
- **Tags:** cloud, cell, containment, acp, agents, byok, security, licensing, amends-ddr-123, amends-ddr-252
- **Related:**
  - plan `.ai/plans/feature-cloud-cell-agent-byok.md`;
  - debate `maude/cloud-cell-agent-sidecar-debate` (kgai, reduce tier; BUILDER, SHIPPER and BREAKER all chose the sidecar);
  - **amends** DDR-123 (licensing model) and DDR-252 (key custody, agent set);
  - **reverses, conditionally,** decision d_6c21570e (Cloud Phase 25 B6, "the agent never runs on our infrastructure") and the agent clause of d_266d96e5 (A0);
  - **extends** DDR-193 §2 and DDR-230 (containment);
  - **keeps** DDR-212 (the agent stays out of the cell image).

## Context

Today a Maude Cloud project in the browser has no AI. Since Cloud Phase 25 the browser names Maude Desktop where the chat would be. Two independent reasons were recorded, and either was enough on its own:

1. **Licensing (DDR-123).** A Claude Pro/Max subscription may drive only the user's own CLI on the user's own machine. Embedding the Agent SDK with an OAuth token is a terms-of-service trap, and metering *our* API keys would be a different product.
2. **Security.** `claude` has unbounded tool access. Inside a cell it would sit next to the tenant's credentials.

The owner now asks for an agent in the Cloud project in the browser. The person pastes their own Anthropic, OpenAI or Gemini key into Settings, and the desktop stays exactly as it is.

**What changed for reason 1.** An API key is metered on the person's own provider account, and Anthropic's Agent SDK documentation steers third-party products to API keys (quoted in DDR-123). The licensing objection was about subscription OAuth and about us metering our own keys. BYOK API keys meet it, provided the cloud **never** accepts a subscription sign-in. The provider terms still have to be checked; see § Terms.

**What did not change for reason 2.** The code confirms it (scout, 2026-11-13):

- `apps/cells/cell-config.mjs:782-877` puts these in a cell container's environment: `HUB_SECRET`, `MAUDE_PROJECT_TOKEN_KEY`, short-lived R2 credentials, `MAUDE_RENDER_SECRET` and (for the tunnel tenant) `MAUDE_TUNNEL_TOKEN`.
- `infra/cell/Dockerfile:73` runs everything as one user, `node`.
- The image has no user namespaces, bwrap or seccomp. The canvas build sandbox (`canvas-build-sandbox.ts`) only scrubs the environment; it has no OS boundary.
- A shell in that container can read `/proc/<hub>/environ`.

BYOK changes none of this.

## Decision

### 1. The agent runs in a sidecar of the cell, never in the cell's own container

Each project gets an **agent sidecar container**: its own image (`maude-agent`), its own container class, and a lifecycle owned by the project's cell Durable Object. Its environment is built from an **allow-list**:

- an agent token;
- the cell API URL;
- the provider name;
- the person's provider key;
- `MAUDE_NO_EGRESS=1`;
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`.

It holds no cell secret, no R2 credential, no render secret and no tunnel token. It works on a scratch checkout. It reads and writes **only through the cell's API**, and the cell remains the single authority for permissions (A0: one permission model, enforced at the cell).

**Rejected: a sandboxed subprocess inside the cell.** There is no OS sandbox to build it on, it would run as the same uid as the hub, and it would require loosening the cell's containment guards.

**Rejected: a stateless service shaped like `maude-render`.** An agent session holds state (a transcript and a checkout). That stays the fallback if the spike shows a second container class under the cell DO is not possible.

### 2. The cell's gates are narrowed, never deleted

These stay **byte-identical**:

- `CLOUD_ELIMINATED`
- `CLOUD_FORBIDDEN_STRINGS` and `scripts/check-cloud-binary.sh`
- the REFUSED `/_api/acp/*` and `/_api/agents` entries in `studio-manifest.mjs`
- `workspace-mode.ts` `FORBIDDEN_ROUTE_PREFIXES`
- `infra/cell/assert-containment.sh`, `entrypoint.sh` and `scripts/check-containment.sh`

The cell binary still carries no agent (DDR-212 holds). The browser chat uses **new** routes, `/_ws/agent` and `/_api/agent/*`. They are classified explicitly under the existing `summon` capability at the edit level, and they proxy frames to the sidecar; they spawn nothing in the cell. The sidecar image gets its own pair gate, `scripts/check-agent-image.sh`: the agent is present, cell-only sentinels are absent, and the image contains no browser. If a future change seems to need a cell guard loosened, the design has drifted. Treat that as a stop (d_2c8ff902).

### 3. Containment, extended the way DDR-230 extended it

DDR-193 §2 stays in force for the cell. Following DDR-230's precedent, vendor compute may act on tenant content (run tools over tenant files) only in a process that has three properties:

- **Secret-free.** No secret from the cell, the control plane or the render service.
- **Single-tenant.** One project per sidecar.
- **Egress-restricted at the network layer.** Outbound traffic reaches only the session's provider API host(s) and the project's cell API.

If the egress restriction cannot be enforced and proven red/green on Cloudflare Containers, this DDR is withdrawn. Web fetch and search are off.

### 4. Key custody (amends DDR-252's per-profile keys for the cloud)

- **Owner.** The key belongs to the **person (account)**, never the project.
- **Where it is entered.** Only on the **control-plane origin** (Account › AI keys), never on a cell origin.
- **At rest.** Stored in control-plane D1 under envelope encryption: AES-GCM with a per-row data key, wrapped by a key-encryption key that only the control-plane Worker holds.
- **Visibility.** Write-only. The interface shows the provider and the last four characters.
- **Delivery.** When a session starts, the control plane checks over a **service binding** that the person is a current Can-edit member of the project, then hands the key to the cells Worker, which places it directly in the sidecar's starting environment.
- **The key never enters the cell container.** It is never logged, framed or returned.
- **Rotation.** A replaced key takes effect on the next session start. Removing a key stops live sessions.
- **The KEK.** It is rotated by re-wrapping the data keys, as a scripted runbook step.

**Rejected: a key held only in the browser** (the SHIPPER seat's minimal option). The owner asked for a Settings key that persists, and the cell origin is near tenant canvas code.

### 5. Who may start the agent, and whose key pays

- **Who.** Only Can edit and owner (`summon`). Can view and Can comment never get the panel.
- **Whose key.** The person who started the session pays with their own key. There is no project key and no borrowing another member's key.
- **Privacy.** Sessions are private to their person.
- **Attribution.** Other members see the agent's edits attributed as "<name>'s AI". The cell audit log records the subject, session and provider for every write, and never the prompts.
- **The agent token.** It is per subject and per session, role-checked against the role matrix on **every** write, valid for at most 15 minutes and re-minted while the session lives, and revocable. It is revoked when the session stops, the person's role changes, or the key is removed.

### 6. Agents and phasing

- **Phase 1:** Claude only, through `claude-agent-acp` and the Agent SDK on `ANTHROPIC_API_KEY`.
- **Phase 3:** Codex (`codex-acp` + `@openai/codex` on `OPENAI_API_KEY`) and Gemini CLI (`GEMINI_API_KEY`), as additional catalog descriptors and image layers.

**What carries over from DDR-252 unchanged:**

- the descriptors and the pinned catalog;
- `chat-key.ts` injection;
- the `acp/env.ts` scrub;
- the bridge gate (`enforce.ts`) and the launch policies;
- the conformance probe, run when the image is built;
- the verb tiers.

**What does not carry over:**

- discovery of installed CLIs;
- vendor sign-in;
- any subscription sign-in. The cloud accepts **API keys only**, now and later. Claude Pro/Max and ChatGPT sign-ins stay on the person's own Mac (DDR-123).

### 7. What replaces the CLI-dependent `/design:*` workflows

The sidecar ships the `maude` CLI and the bundled `design` plugin, and runs the file-only verbs through the agent token. Verbs that talk to the open window map to the cell's existing routes, or answer "desktop only" with the reason (d_6c21570e's corollary: name what is missing, never hide it). Browser verbs (`screenshot`, `draw-proof`, `smoke`) go through `maude-render` on its existing viewer render token in phase 2. **The sidecar never contains a browser.**

### 8. Limits and cost

Our bill covers compute only; the provider bills the person. The limits:

- a wall-clock ceiling per turn and an RSS ceiling per session;
- an idle stop, a maximum session lifetime, and sidecar sleep;
- at most 2 concurrent sessions per project;
- a separate `max_instances` for the agent class, which is a billing decision;
- agent-minutes per account per month included in the €19 plan, with the number set from the spike's measurements;
- a global and per-account kill switch, `agentsEnabled`.

Telemetry records counts only, never content (d_2c8ff902).

## Terms (filled at plan Task 0, before any code)

The question for each provider: may a customer's own API key drive an agent on a third-party service the customer chose?

| Provider | Terms link | Answer (quote ≤ 15 words) |
| --- | --- | --- |
| Anthropic | — | — |
| OpenAI | — | — |
| Google (Gemini API) | — | — |

## Residual risk, named and not hidden

**Prompt injection across members.** A teammate's canvas, comment or annotation can still steer person B's agent into leaking *project* data through the model's output, to B's own provider account. The sidecar removes the cell secrets from what can be reached, and the egress allow-list removes arbitrary exfiltration hosts. Content provenance tagging and the bridge's destructive-write confirmation cards reduce what is left. They do not remove it. The S1 and S2 security reviews must re-test this case.

**Dissent preserved from the debate (BREAKER, quoted):** "don't build it — every BYOK user could install the desktop; the pull is the owner wanting it, not users being blocked." The owner's sign-off (Task 0) and the B0 stop conditions answer it; argument does not.

## Consequences

- Maude Cloud gains its first service that acts on tenant content with a write capability. The agent token is new privileged surface and is reviewed as such (plan Task 1.4, `Risk: auth`).
- The private deploy repo gains a third image lane (`maude-agent`). The owner deploys it; this repository only builds and publishes the image.
- The desktop is unchanged: v2.3.0's chat path, keys file and e2e lanes do not move.
- The public copy "it is deliberately not on our servers" changes to "it runs in your project's cloud on your own API key; your Claude subscription works in Maude Desktop". This changes only when Part 2 ships.
