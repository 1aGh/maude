# Maude

A personal marketplace of Claude Code and Codex plugins. Two plugins today, plus a `maude` CLI for scaffolding and running the bundled dev tooling.

<!-- Demo video lives at https://github.com/1aGh/maude/releases/download/v0.16.0/demo.mp4 once uploaded.
     Until then the inline tag below stays a soft 404; landing page at https://maude.sh autoplays the same file. -->
<video src="https://github.com/1aGh/maude/releases/download/v0.16.0/demo.mp4" controls muted playsinline poster="https://maude.sh/demo-poster.jpg" width="800"></video>

> **📚 Full docs: https://maude.sh** (or browse the source under [`site/content/docs/`](./site/content/docs/) until the public URL lands).
> Contributing? See [CONTRIBUTING.md](./CONTRIBUTING.md). Security? See [SECURITY.md](./SECURITY.md).

| Plugin | What it does |
| ------ | ------------ |
| **`design`** | Canvas-first iteration on TSX/JSX mocks under `.design/` — element selection via Cmd+Click, auto-managed dev server, chained UX/DS critique. Canvases can also be **video-comps** (Remotion compositions previewed in-app, exported to MP4/GIF through Maude's own capture engine — no extra install). |
| **`flow`** | Generic agentic workflow loop with a second-brain `.ai/` workspace. `/flow:plan`, `/flow:execute`, `/flow:utils-verify`, `/flow:validate`, `/flow:done`, `/flow:init`, `/flow:record-ddr`, `/flow:scenario`, …. Project-agnostic via `<project>` placeholders + per-repo `.ai/workflows.config.json`. |

Plus the **`maude`** CLI — `maude init` scaffolds a fresh `.ai/` workspace from the flow plugin skeleton; `maude design serve` boots the design dev server. The legacy `mdcc` alias still works (prints a deprecation warning) and will be removed in v0.17.x.

## Quick start

**Codex CLI:** use the [native plugin installation guide](docs/native-plugins.md). It uses the same workflow procedures; Studio ACP support is a separate follow-up.

> **Using Maude Desktop?** With only **Claude Code installed**, the desktop app's built-in chat panel auto-loads the `design` + `flow` plugins for its session — `/design:*` and `/flow:*` just work, nothing to install (power users who already installed the plugins see a no-op, no double-load). The steps below are the **manual / power-user path** — for the `maude` CLI, the web `maude design serve` flow, or driving `/design:*` from your own terminal Claude Code. Full detail: [maude.sh/desktop](https://maude.sh/desktop).

### 1. Add the marketplace inside Claude Code

```
/plugin marketplace add 1aGh/maude
```

### 2. Install the plugins you want

```
/plugin install design@maude
/plugin install flow@maude
```

Then `/reload-plugins` and you should see `/design:edit`, `/design:*`, `/flow:plan`, `/flow:execute`, etc.

### 3. Install the CLI

```sh
# From npm:
npm i -g @1agh/maude

# Or directly from GitHub:
npm i -g github:1aGh/maude
```

After install you have these bins on `$PATH`:

- `maude` — the primary CLI (`init`, `config`, `design serve`).
- `mdcc` — legacy alias for `maude`. Prints a deprecation warning; will be removed in v0.17.x.

### 4. Bootstrap a repo

In any project root:

```sh
maude init                          # scaffold .ai/ second-brain workspace
```

Then inside Claude Code (with `flow@maude` installed):

```
/init                  # Anthropic's built-in — generates CLAUDE.md tailored to your codebase
/flow:init    # populates .ai/workflows.config.json with detected stack
/flow:status           # confirm everything wired up
```

`/init` writes the `CLAUDE.md` Claude auto-loads every session (conventions, build commands, gotchas). `/flow:init` handles the structured workspace config — they're complementary, not duplicates.

### Health check — `maude doctor`

`maude doctor` reports missing dependencies, config schema errors, stack drift, and missing quality-gate declarations in one shot. `--fix` applies safe auto-fixes (prompts per dependency install; never overwrites existing user config values). `--json` for programmatic consumers. Run it after stack changes or before opening a PR.

```sh
maude doctor          # full health check (deps + config + quality)
maude doctor --fix    # install missing deps (per-item prompt) + apply safe config fixes
maude doctor --json   # machine-readable envelope
```

**Quality gates** are declared in `.ai/workflows.config.json` under the top-level `quality` map — a flat `gate → shell command` mapping (e.g. `{ "lint": "pnpm lint", "tests": "pnpm test" }`). Flow commands (`/flow:validate`, `/flow:utils-verify`, `/flow:quick`) read it directly and run each via `eval`. There is **no `maude quality run` wrapper** — `pnpm <script>` is already the runner. Hook it into your own pre-commit tool with a one-liner: `eval $(jq -r '.quality.lint' .ai/workflows.config.json)`. Populate the block by running `maude doctor --fix` once your `package.json` scripts exist (additive — it never overwrites a command you tuned).

### Sidecar cache — `maude cache`

Flow + design commands reuse expensive cross-session work through a small sidecar cache at `.ai/cache/` ([DDR-061](.ai/archive/decisions/DDR-061-sidecar-cache-monitor-background-orchestration.md)): domain research (skips 30–90 s of WebSearch on a same-domain brief), codebase-intelligence scans (skips rescan when the tree is unchanged), parsed design-system vocabulary, and security-review reuse (one shared 1-hour window across `/flow:validate`, `/flow:done`, `/flow:validate-security`). Correctness comes first — most layers are content-addressed (a changed input changes the key → guaranteed miss), and a stale entry is never served speculatively.

```sh
maude cache list              # layers, entry counts, sizes, last-write time
maude cache stats             # hit/miss counters + hit-rate per layer
maude cache inspect <layer>   # list a layer's entries; add a <key> to print one
maude cache clear [layer]     # wipe one layer (or everything)
```

The `research/domain` and `codebase-intelligence` layers are **committed** (deterministic on a given tree, so collaborators share the hit); the per-brief, design-context, security, and scenario layers are gitignored. `maude init` drops a `.ai/.gitignore` that encodes the split.

### Plugins call `maude` for executable logic

Plugin slash-commands reach all executable logic through the on-PATH `maude` binary — never a relative `cli/lib/*.mjs` path or a raw `$CLAUDE_PLUGIN_ROOT/dev-server/bin/*.sh` invocation ([DDR-062](.ai/archive/decisions/DDR-062-plugins-reach-executable-logic-via-maude.md)). The marketplace copies each plugin alone (no sibling `cli/`, no `dev-server/`), and a flow command's `$CLAUDE_PLUGIN_ROOT` points at the flow plugin (which has no dev-server at all) — so the only contract that holds across every install shape is `maude`, which resolves bundled helpers from its own package root. Cache/preflight go via `maude cache …` / `maude preflight …`; the design dev-server's bash helpers go via **`maude design <verb>`** (`screenshot`, `server-up`, `prep`, `slug`, `smoke`, `runtime-health`, …) — see `maude design help`. Keep the global `maude` current; a stale binary means stale helpers.

## Runtime requirements

- **Node ≥ 20** — for the dev server and CLI. Zero npm runtime deps.
- **Claude Code** — desktop app, CLI, or IDE extension.
- Optional: **`agent-browser`** for design screenshot evidence.

## Collaboration model

Two clean paths, no middle ground ([DDR-047](.ai/archive/decisions/DDR-047-collab-scope-cut-no-lan-mode-hub-admin-ui.md)):

- **v1.0 — git handoff OR loopback multi-tab.** Push / pull is the cross-machine story. On a single machine, two browser tabs (or two Claude Code instances editing the same repo) sync cursors, comments, and annotations live over loopback WebSocket. The dev server refuses any non-loopback `host` header on the collab WS endpoint.
- **v1.1 — deploy a hub** (Phase 9, in-flight). Cross-machine live collab needs a hub binary you deploy yourself. No tunnel mode; no shared cloud. **Boot order can't eat your work** ([DDR-102](.ai/archive/decisions/DDR-102-cold-start-divergence-resolution.md)): a per-machine journal tells clean catch-ups apart from genuine divergence; diverged canvases snapshot **both** versions to `_history/` before the newer one wins, so the loser is one `/design:rollback` away — and `maude design status` reports per-canvas sync state honestly (synced / pending / auth-rejected).

## Security

Solo mode (the default) is fully local — no accounts, no telemetry, no network trust surface, and the canvas sandbox is on by default. Linked (hub) mode is opt-in and carries a documented trust model with disclosed, bounded residuals (hub-pushed content is treated as untrusted input). The full account — what runs where, what the canvas sandbox does and doesn't close, `.tsx` sync's double opt-in, untrusted-context handling — is at [`/docs/security`](https://maude.sh/docs/security) (source: [`site/content/docs/security.mdx`](./site/content/docs/security.mdx)). To **report** a vulnerability, see [SECURITY.md](./SECURITY.md).

## What's where

User-facing docs live in two places — the README points you the right way:

- **Reference** (every command, every config key, recipes for Next.js / Expo / monorepo) → [`site/content/docs/`](./site/content/docs/) (served at https://maude.sh once Vercel is wired — see [DDR-005](.ai/archive/decisions/DDR-005-docs-site-stack-and-hosting.md)).
- **kgai knowledge-graph backend** (opt-in shared decision memory across repos) → [`docs/kgai-onboarding.md`](./docs/kgai-onboarding.md) (per user) + [`docs/kgai-company-setup.md`](./docs/kgai-company-setup.md) (one-time admin). Off by default — absent `kg`, every command runs its classic `.ai/` path.
- **Quickstart** + **contributor info** → this README.

The docs site auto-generates per-command pages from `plugins/{flow,design}/commands/*.md` frontmatter and a typed schema reference from `plugins/flow/.claude-plugin/config.schema.json`. Adding a new command → docs update on next build.

## Workspaces

The repo is a **pnpm workspace monorepo** with one published npm package (`@1agh/maude`). Internal workspaces are `"private": true` and never publish:

| Workspace | Purpose |
| --------- | ------- |
| `.` (root) | The single npm publisher — CLI, dev-server entry, plugin templates that ship to npm. |
| `site/` | Docs site — Fumadocs + Next.js, deployed to Vercel ([DDR-005](.ai/archive/decisions/DDR-005-docs-site-stack-and-hosting.md)). |
| `apps/studio/` | Zero-dep Node dev server + browser client. Bundled output (`dist/`) is the only thing in the npm tarball. |
| `apps/hub/` | Reserved for the v1.1 federated hub (Phase 9). |

Common scripts at the root:

```sh
pnpm install          # bootstrap everything
pnpm dev              # boot the design dev server
pnpm dev:site         # docs site dev server
pnpm build            # build every workspace that defines `build`
pnpm lint             # biome over the whole repo
pnpm test             # node --test over cli/**/*.test.mjs
pnpm changeset        # add a changeset for the next release
```

The site workspace's Next.js dependencies are heavy — contributors fixing plugin code can keep working with `pnpm install --filter '!@maude/site'` to skip them.

## Updating

In Claude Code, after a new version lands on the marketplace:

```
/plugin marketplace update maude
/plugin install design@maude
/plugin install flow@maude
```

## Releasing

The npm package (`@1agh/maude`) and the Claude Code plugins (`design@maude`, `flow@maude`) share one version. The standard release path is **Changesets**:

```sh
# 1. Each PR with shipped behavior includes a changeset
pnpm changeset

# 2. When ready to release, the maintainer runs:
pnpm version            # = bash scripts/changesets-version.sh
                        #   → consumes .changeset/*.md
                        #   → bumps package.json + CHANGELOG
                        #   → propagates version to plugin manifests
                        #   → re-runs scripts/check-version-parity.sh

git commit -am "chore: release v$(node -p "require('./package.json').version")"
# ANNOTATED (-a -m) is required — `git push --follow-tags` only pushes annotated
# tags. A lightweight `git tag vX.Y.Z` will silently stay local and no release
# workflow ever fires.
VER="v$(node -p "require('./package.json').version")"
git tag -a "$VER" -m "$VER"
git push --follow-tags
```

The `v*` tag triggers `.github/workflows/publish.yml`, which re-runs the parity check, verifies the tag matches `package.json`, builds workspaces, publishes with `--access public --provenance`, and creates a GitHub Release using the CHANGELOG entry for that version.

`scripts/bump-version.sh patch|minor|major|X.Y.Z` remains as a manual fallback for emergency hotfixes outside the Changesets flow.

### One-time setup (project owner)

1. Create an **Automation** token at <https://www.npmjs.com/settings/~/tokens>.
2. GitHub repo → **Settings → Secrets → Actions** → `NPM_TOKEN`.
3. `id-token: write` is already enabled in `publish.yml` for npm provenance.

## Local development (plugin authors)

```
/plugin marketplace add /absolute/path/to/maude
/plugin install design@maude
/plugin install flow@maude
```

Working on plugin internals:

1. **Edit in place** — the local marketplace points at your working tree.
2. **Reload after edits:**
   - Commands / agents / skills → `/plugin marketplace update maude` then `/reload-plugins`.
   - Dev server code → kill the running process (`lsof -i :<port>` → `kill`) and let the next `/design:edit` invocation auto-restart.
3. **Test in isolation** — open Claude Code from a scratch project (`cd /tmp && claude`) so plugins aren't entangled with this repo's own `.ai/`.
4. **Dogfood** — Maude itself uses `flow` for plan/execute/done. Once `flow` is installed against this marketplace, you can drive its own development with `/flow:plan`, `/flow:execute`, etc.

## License

MIT — see [LICENSE](./LICENSE).
