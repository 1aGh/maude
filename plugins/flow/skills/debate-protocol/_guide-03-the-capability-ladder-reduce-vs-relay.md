## The capability ladder — `reduce` vs `relay`

The ONLY thing a live team adds over today's panel is **stance revision** (a seat changing its mind after hearing another). That draws the load-bearing line:

| Tier | When | What it does |
| --- | --- | --- |
| **`reduce`** (default, every user) | `mode:reduce` / native messaging unavailable | parallel subagents emit blind verdicts → ONE consolidator **reads** them and resolves contradictions into one ordered list |
| **`relay`** (premium, native only) | `mode:auto` AND native team messaging enabled and available | a **native agent team** whose seats message each other so a seat can revise after hearing another |

**The one-line test — REDUCE vs RELAY:**

> Does the step only *read finished verdicts* (REDUCE — allowed in markdown), or does it *route one agent's words into another agent's input and iterate* (RELAY)?

**RELAY is allowed ONLY when the native runtime carries the messages.** NEVER hand-roll it: do not feed seat A's verdict back into seat B as a prompt, collect a rebuttal, and loop — that re-implements SendMessage + the shared task list in markdown, badly, with none of the runtime's guarantees. **The moment a critique becomes another critique's prompt in our own code, you have built the team simulator we refuse to build.** Native messaging unavailable ⇒ REDUCE only. We ship no `.workflow.mjs` and no messaging engine.

**Capability detection:** inspect the active host's exposed subagent and messaging tools. Claude's experimental flag is only a hint; it does not establish that a removed or unavailable tool exists. Codex uses its native spawn/wait/message operations when exposed, with the role instructions described in `../../HARNESS.md`. No messaging → `reduce`; no subagents → report the missing capability rather than inventing independent reviewers. Never enable a feature or change the user's model to make a debate run.
