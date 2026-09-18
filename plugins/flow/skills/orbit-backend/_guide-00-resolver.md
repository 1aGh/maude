## Resolver

Run once per command, before its first orbit call; reuse the result for the rest of the command.

### 1. Config

```bash
jq '{name, tracker: (.integrations.tracker // {})}' .ai/workflows.config.json
```

| Field | Meaning | When unset |
| --- | --- | --- |
| `tracker.provider` | must be `"orbit"` | not orbit → this skill does not apply; stop |
| `tracker.mcp` | MCP server prefix in this host | `mcp__orbit` |
| `tracker.baseUrl` | orbit instance, e.g. `https://orbit.example.com` | links come only from tool results (`url`) |
| `tracker.tokenEnv` | NAME of the env var holding the bearer token | `ORBIT_MCP_TOKEN` |
| `tracker.defaults.repo` | repo name orbit files artifacts and states under | top-level `name` |
| `tracker.defaults.list` | orbit list for new tasks (`List` or `Space/List`) | asked once at create time |
| `tracker.defaults.doneStatus` | status name or category set at close | `done` |
| `tracker.artifacts.store` | where plans, RCAs and reports live: `local` \| `orbit` \| `both` | `local` — today's behaviour, `.ai/` files with a close-time copy |

`defaults` stays free-form — other keys are ignored here, never an error. The rest of `artifacts` (`local`, `spoolDir`, `kinds`) belongs to [guide 06](./_guide-06-artifact-store.md); read it only in a command that writes one of the five artifacts.

### 2b. Spool sweep — `store: orbit` + `local: scratch` only

Artifacts whose push failed earlier wait in `spoolDir`. Non-empty and orbit active → push them before the command's own work ([guide 06 §4](./_guide-06-artifact-store.md)), at most 10, then continue. Empty, or any other `store` → nothing to do, print nothing.

### 2. Capability gate — `active`

`active` is true when the session exposes the orbit tools: a tool whose name ends in `orbit_get_task` on the configured server (Claude Code: `mcp__orbit__orbit_get_task`; other hosts name MCP tools differently — match on the `orbit_<tool>` suffix and use that one server for every call). The tools used by the recipes: `orbit_get_task`, `orbit_create_task`, `orbit_update_task`, `orbit_state_report`, `orbit_artifact_push`, `orbit_artifact_pull`.

Not active → print ONE line and continue the command as if the provider were `none`:

```
[orbit] inactive — orbit MCP tools are not available in this session (setup: flow:orbit-backend resolver)
```

To tell the user which half is missing, check the token variable by NAME only — this prints `set` or `missing`, never the value:

```bash
TOKEN_ENV=$(jq -r '.integrations.tracker.tokenEnv // "ORBIT_MCP_TOKEN"' .ai/workflows.config.json)
printenv "$TOKEN_ENV" >/dev/null && echo "$TOKEN_ENV set" || echo "$TOKEN_ENV missing"
```

Never write a token into a file, echo it, pass it as a tool argument, or edit `.mcp.json` / `.ai/workflows.config.json` to make a check pass. Wiring orbit up is the user's call.

### Setup (reference — show when inactive and the user asks how)

Project `.mcp.json` (committed — it holds the variable name, not the secret):

```json
{
  "mcpServers": {
    "orbit": {
      "type": "http",
      "url": "<baseUrl>/api/mcp",
      "headers": { "Authorization": "Bearer ${ORBIT_MCP_TOKEN}" }
    }
  }
}
```

The token is a personal MCP token carrying the `orbit` scope, issued by whoever administers the orbit instance (orbit validates it; it does not issue it). Export it in the shell profile under the `tokenEnv` name and restart the session so the host reconnects. Calls made with it act as that person — orbit's own role matrix decides what they may change.

### 3. Repo

`REPO` = `defaults.repo` → top-level `name` → `basename "$(git rev-parse --show-toplevel)"`. Prefer the config: a worktree directory name is not the repo name.

### 4. Task key

orbit keys are `ORB-<n>`. Normalize every match to upper case without leading zeros (`orb-007` → `ORB-7`). First hit wins:

1. The command's own input (`$ARGUMENTS`) — a token matching `ORB-<n>`.
2. The plan's Metadata line `- **Ticket**: ORB-<n> — …` (the plan named in `$ARGUMENTS`, else the active plan from STATE.md or the graph).
3. The current branch name:

   ```bash
   git branch --show-current | grep -oiE 'ORB-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]' | sed -E 's/-0+([0-9])/-\1/'
   ```

No hit → `KEY` unset. Only the Plan recipe (and the close-time offer in `/flow:done` Step 6b) may create a task; every other recipe that needs a key skips with one line.
