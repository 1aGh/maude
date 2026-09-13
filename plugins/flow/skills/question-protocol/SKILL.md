---
name: question-protocol
type: skill
description: "Batch necessary questions from workflow participants, collect user answers and route them to the requester."
keywords: [question, ask, clarify, batch, multi-agent, protocol, interaction]
---

# Question Protocol

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Teaches agents how to collect, batch, and present questions from multiple sources in a single coherent interaction. Prevents the fragmented "20 questions" anti-pattern where multiple specialist agents each interrupt the user separately.

## When to Use This Skill

- Multi-agent workflows where more than one agent needs user input
- Planning phases that need clarification before proceeding
- Any scenario where multiple skills or commands need user decisions
- Workflow phases that aggregate questions from subagents before presenting them

## Protocol

### Rules

1. **Subagents and skills NEVER ask the user directly.** They do not present prompts, confirmations, or choices to the user themselves.
2. When a subagent needs input, it **returns a structured question object** to the orchestrator.
3. The **orchestrator collects all pending questions** from all active subagents and skills.
4. Questions are **batched and presented together** in one interaction.
5. **Answers are routed back** to the requesting subagent or skill by the orchestrator.

### Priority

Questions are presented in this order:

1. **Blocking** — the workflow cannot continue without an answer
2. **Important** — affects quality or scope of the current phase
3. **Optional** — has a sensible default; the user can skip

## Question Format

When a subagent or skill needs user input, it returns a structured object:

```json
{
  "source": "plan-feature",
  "question": "Should the new API endpoint require authentication?",
  "type": "choice",
  "options": ["yes", "no", "defer to security review"],
  "default": "yes",
  "required": true,
  "context": "The endpoint exposes user profile data. Most similar endpoints in this codebase require auth."
}
```

### Fields

| Field      | Required | Description                                                          |
| ---------- | -------- | -------------------------------------------------------------------- |
| `source`   | Yes      | Name of the agent, skill, or command requesting input                |
| `question` | Yes      | The question text — clear, specific, self-contained                  |
| `type`     | Yes      | `choice` (pick from options), `text` (free-form), `confirm` (yes/no) |
| `options`  | No       | Available choices (for `choice` type)                                |
| `default`  | No       | Suggested default answer                                             |
| `required` | Yes      | Whether the workflow is blocked without an answer                    |
| `context`  | No       | Background information to help the user decide                       |

## Orchestrator Behavior

The orchestrating agent (the one driving the workflow) follows these steps:

### 1. Collect

After invoking each subagent or skill in a phase, check for returned questions. Accumulate them in a pending list.

### 2. Deduplicate

If two sources ask the same question (or very similar ones), merge them into one entry and note both sources.

### 3. Present

Use the current host's question tool when available and permitted in this mode
(Claude's `AskUserQuestion`, Codex's available user-input tool). Respect its
question/option limits; batch across calls only if needed. Otherwise ask in chat.
An MCP server is not required. Ask only for missing information or authorization;
do not re-confirm what the user already authorized in this session. Continue
independent work while waiting. A default or elapsed time is never an answer to
a required question.

Present all pending questions in a single batch:

```
I have a few questions before proceeding:

1. [plan-feature] Should the new API endpoint require authentication?
   Options: yes / no / defer to security review (default: yes)

2. [a11y-checker] What WCAG conformance level are you targeting?
   Options: A / AA / AAA (default: AA)

3. [plan-feature] Should we add E2E tests for this feature?
   Type: yes/no (default: yes)
```

### 4. Route

After the user responds, route each answer back to the requesting source. The subagent or skill receives its answer and continues processing.

### 5. Handle Missing Answers

If the user skips a non-required question, use the default value. If the user skips a required question, re-ask that specific question once. If still unanswered, pause the workflow and record the pending question in `STATE.md`.

## Examples

### Example 1: Planning Phase with Multiple Skills

During `plan-feature`, the planning agent and the a11y-checker skill both need input:

```
Planning agent returns:
  { source: "plan-feature", question: "Include database migration?", type: "confirm", required: true }

A11y skill returns:
  { source: "a11y-checker", question: "Target WCAG level?", type: "choice", options: ["A", "AA", "AAA"], default: "AA", required: false }

Orchestrator presents both together:
  1. [plan-feature] Include database migration? (yes/no) — required
  2. [a11y-checker] Target WCAG level? A / AA / AAA (default: AA) — optional
```

### Example 2: Execution Phase Confirmation

During execution, the code-implementer needs a design decision:

```
Code implementer returns:
  { source: "execute", question: "The existing utility uses class-based pattern. Refactor to functional, or match existing style?", type: "choice", options: ["refactor to functional", "match existing class-based"], default: "match existing class-based", required: true, context: "3 other utilities in this directory use class-based pattern." }

Orchestrator presents:
  1. [execute] The existing utility uses class-based pattern. Refactor to functional, or match existing style?
     Options: refactor to functional / match existing class-based (default: match existing)
     Context: 3 other utilities in this directory use class-based pattern.
```

### Example 3: No Questions Needed

If no subagent returns questions during a phase, the orchestrator proceeds directly to the next step without interrupting the user. The protocol adds zero overhead when no questions exist.
