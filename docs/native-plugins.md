# Maude plugins in Claude Code and Codex

Maude keeps one set of workflow procedures for both terminal hosts. Install
`design` and `flow` together for the complete set: design also uses flow's
question, debate and decision-memory skills. Studio chat / ACP is a separate
integration; installing these plugins does not change its harness.

## Install from this checkout

These changes must be committed and released before a GitHub marketplace install
can fetch them. To use or test this checkout now, register its **repository root**
with the native Codex CLI:

```sh
codex plugin marketplace add /absolute/path/to/maude
codex plugin add flow@maude
codex plugin add design@maude
```

Start a fresh Codex session. The marketplace is
[.agents/plugins/marketplace.json](../.agents/plugins/marketplace.json); each
plugin supplies `.codex-plugin/plugin.json`. Native installation was checked on
Codex CLI 0.154.0. The npm CLI is a separate dependency:

```sh
npm install -g @1agh/maude
```

Claude Code keeps its current installation and command names. For this checkout:

```text
/plugin marketplace add /absolute/path/to/maude
/plugin install design@maude
/plugin install flow@maude
/reload-plugins
```

If `codex` on PATH is a wrapper around `maude codex`, use the actual Codex binary
for direct installation (`type -a codex` shows candidates). The native route does
not need environment projection. The existing Maude launcher also now preserves
a plugin with its own Codex manifest instead of rewriting it. That preservation
requires the updated Maude CLI from this change; an older global CLI can still
rewrite a mirrored plugin. Do not maintain a projected and directly installed
copy of the same plugin ID concurrently. Existing ownership conflicts should be
resolved deliberately; this change does not migrate or delete a user's cache.

## Invocation

| Workflow | Claude Code | Codex |
| --- | --- | --- |
| Plan | `/flow:plan` | `$flow:source-command-plan` |
| Execute | `/flow:execute` | `$flow:source-command-execute` |
| Validate | `/flow:validate` | `$flow:source-command-validate` |
| Close / pause / resume | `/flow:done`, `/flow:pause`, `/flow:resume` | `$flow:source-command-done`, `$flow:source-command-pause`, `$flow:source-command-resume` |
| New / edit canvas | `/design:new`, `/design:edit` | `$design:source-command-new`, `$design:source-command-edit` |
| Browse all workflows | `/flow:help`, `/design:help` | `$flow:source-command-help`, `$design:source-command-help` |
| Shared skills | `flow:kgai-backend`, `design:design-system` | `$flow:kgai-backend`, `$design:design-system` |

Pass the same brief, flags and task details after the invocation. Codex's built-in
`/plan` is its host mode, not Maude's feature-planning workflow. The
`source-command-` names preserve the identities used by existing Maude Codex
installations; the display labels use the short `flow:plan` / `design:new` form.

There are 30 shared skills and 55 command entry points. Codex's command entries
use `agents/openai.yaml` with `allow_implicit_invocation: false`: explicitly invoke
a workflow to load it instead of putting all command metadata into every model
prompt. Claude's `user-invocable: false` hides those extra skill aliases from its
command menu; the original 55 commands remain. The aliases can still be selected
internally by Claude and lead to the same procedure. We do not use Claude's
`disable-model-invocation` to control Codex. See the hosts' documented
[Codex skill policy](https://learn.chatgpt.com/docs/build-skills) and
[Claude invocation controls](https://code.claude.com/docs/en/skills).

## Dependencies and preserved behavior

| Capability | Required for the complete workflow | Behavior when unavailable |
| --- | --- | --- |
| Maude helpers | Compatible `maude` CLI on PATH; Node/git and relevant system tools | Existing file-only flow fallbacks apply where documented. Design rendering and other helper-backed tasks need the CLI. |
| Decision memory | kgai >= 1.5.1 and an existing trusted, reachable store | `auto`: documented `.ai/` file fallback with a notice; `on`: surface the error. Pending trust is not auto-approved. |
| kgai capture | Explicit read and write checkpoints in `flow:kgai-backend` | No dependency on the Claude JSONL Stop scanner for Codex capture. Uncaptured decisions must be reported, not assumed saved. |
| Specialist reviews | Host-native subagents with the bundled role instructions | Native messaging enables relay; otherwise use the existing independent-review/consolidation mode. Missing required reviewers are reported. |
| Role isolation | Native permission controls where hard isolation is needed | A Markdown `tools:` list is not an enforced Codex tool whitelist. Do not claim isolated execution or silently weaken a required boundary. |
| Web/native scenarios | `agent-browser`; `agent-device` plus the target platform tooling | Existing fallback or explicit platform skip/error; unavailable coverage does not pass. |
| External expertise | Relevant installed skills, such as `frontend-design`; optional `terminal-skills` MCP | Existing installed-skill / role / official-documentation fallbacks. |
| Media generation | Configured Maude BYOK providers, or a host-native tool where required by host instructions | Preserve provider choice, key custody, asset localization and paid-generation confirmation; report conflicts. |
| Session hooks | Host support and user trust for bundled hooks | Hook availability is not proof that preflight or memory checkpoints ran. Check prerequisites in the workflow. |

`dependencies.json` is Maude's preflight inventory, not a native plugin dependency
installer. Neither host installs kgai, browsers, SDKs or another plugin merely
because a Markdown file mentions them. The kgai plugin itself is optional for
Maude's explicit CLI-backed decision workflows; its additional standalone commands
remain owned by kgai. Its Claude transcript hooks have not been ported here.

Project state stays in the same `.ai/` and `.design/` files. Shared host conventions
are packaged in [design/HARNESS.md](../plugins/design/HARNESS.md) and
[flow/HARNESS.md](../plugins/flow/HARNESS.md), so each plugin is self-contained.
Claude uses `CLAUDE.md`; Codex uses `AGENTS.md`. The convention keeper retains its
legacy skill name and selects the appropriate file without global text replacement.

## Maintain the Markdown

- Edit the procedure once in `commands/<verb>.md`, or in the shared skill and its
  references. Codex command entries only link to that procedure; no generation
  script, adapter build or second copy of the workflow is needed.
- When adding a command, add its small `skills/source-command-<verb>/SKILL.md`
  entry and `agents/openai.yaml`. Keep names, short descriptions and links aligned.
- Prefer skill descriptions around 80–160 characters and entry files under 8 KB.
  These are maintenance targets, not claims about a fixed host parser limit.
- Keep prerequisites and safety constraints in the entry. Reference tables say
  when to load setup, a workflow stage, a schema, an example or troubleshooting.
  Read each applicable stage before executing it; do not preload every branch.
- Update both native manifests through the existing version-bump script. The
  existing parity check now covers Claude and Codex manifests.

The docs site's [Codex installation and Studio guide](../site/content/docs/codex.mdx)
is prepared for `/docs/codex`; it is not live until the site is deployed. All 55
command-reference pages include both host invocations. The
[Studio verification report](research/maude-dual-support/studio-verification.md)
records the successful renderer probe and the browser permission blocker; a full
visual editing loop has not yet passed in the tested environment.

The [implementation checks](research/maude-dual-support/implementation.md) separate
verified packaging/content preservation from workflows that still need interactive
end-to-end validation. The original [compatibility audit](research/maude-dual-support/README.md)
contains the wider research; its ACP and adapter proposals are not requirements
for this native Markdown distribution.
