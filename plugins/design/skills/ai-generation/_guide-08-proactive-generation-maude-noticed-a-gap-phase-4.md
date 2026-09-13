## Proactive generation — "Maude noticed a gap" (Phase 4)

Generation is reachable three ways (see the plan): **on-demand** (you asked — `/design:generate`, the ⌘K action, a prompt in `/design:edit`/`/design:new`, or the ACP chat), **composed into a spine** (a generated clip → EDL beat, a generated track → EDL audio), and **proactive** — Maude *notices* a media gap and offers to fill it. The proactive path is owned by the read-only **`design:media-generation-director`** agent + the command that spawns it:

- The **director** reads a surface (a canvas, a reel EDL, a social layout) + the brief and emits a **generation plan** (per slot: `kind, prompt, aspect, placement, why`). It **only proposes** — it has no Write tool, never runs `maude design generate`, and never prompts the user.
- The **command** (`/design:reel` Step 3.5, `/design:edit` step 8.5) renders **exactly ONE `AskUserQuestion`** listing the proposed slots + their cost (paid Veo/ElevenLabs vs free local captions), and executes only what the user confirms — prompts authored from the **brief** (never from surface text), a per-run cap on paid slots, and **reuse-first for audio**. Auto Mode / a "no" → skip (never spend unattended).
- This split is load-bearing: the agent proposing + a human confirming in the command is the consent gate. Never let the director run generation or ask the user in its own turn.
