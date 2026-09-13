# Docs site and terminal Codex → Studio verification

Date: 2026-09-13. Scope: native plugin documentation and local Studio use from
terminal Codex. Studio's built-in ACP chat remains a separate follow-up.

## Documentation

- Added `site/content/docs/codex.mdx`, linked from the sidebar, getting-started,
  documentation home and design overview. Covers native checkout installation,
  existing Maude launchers, CLI/plugin updates, project instructions, workflow
  invocation, Studio operation, dependencies, kgai, model capabilities and limits.
- All 55 generated command pages show Claude Code and Codex invocations. The
  existing generator no longer exposes internal HARNESS-loading prose as a public
  summary. It removes only stale generated MDX pages, avoiding recursive deletion
  of the output directory.
- The live getting-started page returned HTTP 200 but did not mention Codex when
  checked. These changes have not been published or deployed.
- Production Next.js 16.2.10 webpack build passed: 282 static pages, including
  `/docs/codex` and its machine-readable documentation route. The build used an
  isolated temporary site copy because removing existing `.next` directories in
  the working tree was denied. No Studio bundles were rebuilt.
- A temporary-build `pnpm exec` automatically refreshed dependencies through the
  shared `node_modules` symlink, then stopped on its dependency build-script policy.
  No build-script approval was granted and no tracked package manifest or lockfile
  changed. The successful build used Next's Node entry directly; dependency files
  on disk may differ from the initial environment.

## Observed runtime results

The probe used a disposable project outside the user's project, its own browser
profile/artifact directories, Maude 1.2.0 and agent-browser 0.36.0. No user canvas
or user browser session was modified. The temporary foreground server was stopped
with Ctrl-C after the probe.

| Check | Result |
| --- | --- |
| Native plugin installation and discovery | Previous isolated Codex CLI 0.154.0 probe: 85/85 enabled, no discovery errors. No model turn was run by that probe. |
| Foreground Studio startup | Passed: `MAUDE_NO_AUTOBUILD=1 NO_OPEN=1 maude design serve --root <temporary-project> --port 4487`. |
| Renderer health | HTTP 200, `ok: true`, `app: design`, project identity and PID returned. This confirms the server, not a rendered canvas. |
| Background bootstrap | Timed out in this environment. Foreground startup worked; detached process behavior remains unverified. |
| Reuse of a healthy server | Found and fixed a false stale-state result caused by `kill -0` returning EPERM. The fixed helper has three passing regression cases; live reuse was not repeated after the patch. |
| agent-browser launch | Failed: Chrome exited before creating `DevToolsActivePort`. |
| Installed Playwright screenshot fallback | Failed: `ERR_MODULE_NOT_FOUND` resolving `playwright` from the global Maude shim. |
| Source-checkout Playwright launch | Module resolved, but Chromium failed with `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)` / SIGTRAP. |
| Actual canvas selection, scoped edit, rendered comparison and screenshot | Not completed because browser startup was denied. No screenshot or visual correctness claim. |
| Critic panel, export/video/mobile/provider workflows | Not exercised by this probe. |

The temporary design-system fixture also produced a configuration warning; this
probe does not count as validation of project initialization or design-system setup.

## Changes prompted by the probe

`plugins/design/commands/browse.md` now uses `maude design server-up` rather than
an obsolete raw `dev-server/server.ts` path. Explicit-port foreground startup uses
the supported `maude design serve` command.

`apps/studio/bin/server-up.sh` verifies an existing server through `/_health`,
checking `ok`, application, PID and root identity when supplied. An agent may have
HTTP access without permission to signal the process; this no longer causes that
healthy state to be cleared solely because `kill -0` failed. Legacy health
responses without a root identity retain PID/application matching.

`cli/lib/design-server-up.test.mjs`: matching identity with an unprobeable PID
reuses the server and preserves its state; mismatched PID and mismatched root are
rejected. Before the fix the matching case failed; after the fix all three pass.
Shell syntax and Biome checks also pass.

## What this supports

The plugins provide the shared instructions and CLI route for Codex to operate
Studio. They do not require ACP integration. Full practical compatibility in the
current restricted environment is not established: visual tasks need working
browser access, and installing Markdown cannot supply that permission.

The remaining acceptance test is the actual local loop: initialize a valid test
project, open a canvas, select an element, invoke the native Codex edit workflow,
verify snapshot and scope, inspect the rendered screenshot, and run the required
critics. Run it in an environment with an authorized working browser, then test
the task-specific export/media/device paths that will be used. Missing coverage
must remain visible until these checks pass.
