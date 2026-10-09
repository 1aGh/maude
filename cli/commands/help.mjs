export function run() {
  const text = `maude — Maude CLI (legacy alias: mdcc)

USAGE
  maude <command> [options]

COMMANDS
  init [--name <project>] [--force] [--dry-run]
        Scaffold the .ai/ second-brain workspace into the current repo from
        the flow plugin skeleton. Idempotent — never overwrites existing
        files unless --force. --name sets the project name in
        workflows.config.json (defaults to the current directory basename).
        Does NOT write CLAUDE.md — use Claude Code's built-in /init for that.

  config show
  config get <dotted.key>
  config set <dotted.key> <value>
        Read or write keys in .ai/workflows.config.json. Validates known keys
        against the flow plugin's config.schema.json. Values that parse as
        JSON (numbers, booleans, arrays, objects) are stored typed.

  cache get <layer> <key> [--ttl-ms N]
  cache put <layer> <key> [file] [--meta JSON]
  cache list | stats | inspect <layer> [key] | clear [layer]
        Inspect and manage the sidecar cache (.ai/cache/, Phase C / DDR-061)
        that reuses expensive cross-session work (domain research, codebase
        scans, design-context parsing, security reviews). 'get'/'put' are the
        programmatic surface plugin commands call (maude on PATH is the reachable
        contract — see DDR-061); 'list' shows layers + sizes; 'stats' shows
        hit-rate; 'inspect' pretty-prints entries; 'clear' wipes a layer or all.

  studio [--port N] [--root PATH]
        Alias for 'maude design serve' — boot the canvas studio (the design
        dev server) in the current repo. Forwards all remaining args.

  design serve [--port N] [--root PATH]
        Start the design plugin's dev server in the current repo. Equivalent
        to 'maude studio' / invoking 'claude-design-server'. Forwards all
        remaining args.

  design init [--name <slug>] [--ds <name>] [--force] [--dry-run]
              [--no-discovery | --discovery-payload <path>]
        Non-interactive scaffold helper for the design plugin. Writes Core
        files into .design/ using the design-system-inspiration library.
        Refuses to run interactively — use Claude Code's /design:setup-ds for
        full discovery. --no-discovery uses Recommended defaults; --discovery-
        payload reads pre-computed answers from JSON.

  design <screenshot|server-up|prep|slug|bootstrap-check|runtime-health
          |smoke|canvas-edit|handoff|asset-sweep|visual-sanity> [args]
        Dispatch to the studio's bundled bash helper of the same name.
        maude resolves it from its own package root and sets CLAUDE_PLUGIN_ROOT
        for the child; stdout/stderr/exit-code pass straight through. This is
        the contract plugin markdown uses instead of a raw bin path (DDR-062).
        See 'maude design help' for usage.

  migrate v2 [--apply] [--reverse [--strip]] [--json] [--root PATH]
        Update a project's files for Maude 2 (writes "formatVersion": 2).
        Dry run by default; --apply writes, after a snapshot to
        .design/_history/_migrate/. Idempotent. --reverse returns the project
        to Maude 1 (byte for byte when nothing was edited since); --strip also
        removes Maude 2-only fields. Exit 0 done, 10 already there, 11 refused
        (nothing written), 1 error, 2 usage.

  scenario-report <run-dir> [--out <path>]
        Deterministically generate the mechanical sections of a cross-platform
        scenario report.md (TL;DR, counter-delta parity, per-step pivot, path
        listing) from a scenario run directory. The LLM authors only the prose
        sections. Used by /flow:scenario + the scenario-runner agent (DDR-061).

  hub serve [--port N] [--data PATH] [--secret HEX] [--insecure-http] [--dev]
        Start the self-hostable Yjs sync hub (Phase 9). Defaults to port 1234,
        data dir ./data. --dev mints a mau_dev_<hex> token + prints the
        connect command before booting. Local-dev-tree only in v1.1 Task 2.

  hub token generate --label NAME [--data PATH] [--dev]
        Mint a new mau_<32hex> token in <data>/tokens.json. Prints the raw
        token ONCE plus the ready-to-paste 'maude design link' command.

  hub status [URL] [--json]
        Probe a hub's /health endpoint. URL defaults to http://localhost:1234.

  preflight --plugin <design|flow> [--json|--shell-export|--warn-only] [--cache PATH]
        Run a plugin's dependency health check (the engine behind 'doctor').
        Plugin bin scripts + hooks call this via PATH instead of a relative
        cli/lib path that the marketplace never copies beside a plugin (DDR-061).

  doctor [--plugin <name>] [--fix] [--json]
        Unified workspace health check. Reports missing dependencies, config
        schema errors, stack drift, and missing quality-gate declarations in
        one shot. --fix applies safe auto-fixes (prompts per dep install;
        never overwrites existing config values). --json for programmatic
        consumers.

  harness <migrate|sync|check|diff|status|adopt|remove> [options]
        Project Claude and Maude configuration into OpenCode or Codex through
        an explicit --global or --project <root> scope. Migration, diff, and
        adoption preview safely; use --yes only after reviewing the full diff.
        Run 'maude harness help' for targets, exit codes, and recovery details.

  codex [--real <path>] [codex options]
        Synchronize the trusted local Claude environment into Codex, then launch
        the real Codex binary. Use 'maude codex sync --json' without launching.

  help              Print this help.
  version           Print the installed version.

EXAMPLES
  maude init --name acme-app
  maude config set platforms '["web-desktop","web-mobile"]'
  maude config get motion.complex
  maude cache list
  maude cache clear research/domain
  maude studio --port 4399
  maude design serve --port 4399
  maude design init --no-discovery --name acme-app
  maude design slug "Some Canvas Name"
  maude design smoke --changed-only
  maude scenario-report .ai/device/scenario-runs/signup/2026-05-29-1200
  maude hub serve --dev
  maude hub token generate --label alice
  maude hub status http://localhost:1234
  maude doctor
  maude doctor --fix
  maude harness migrate --from claude --targets opencode,codex --project .
  maude harness check --targets opencode,codex --strict --project .
  maude codex --real ~/.local/bin/codex

NOTES
  'maude init' does mechanical scaffolding of .ai/ only.
  For interactive stack detection and workflows.config.json population,
  run '/flow:init' inside Claude Code — it calls 'maude init' as
  its first step. For CLAUDE.md, run Anthropic's built-in '/init'.

  The legacy 'mdcc' alias still works (prints a deprecation warning).
  It will be removed in v0.17.x.

DOCS
  https://github.com/1aGh/maude
`;
  process.stdout.write(text);
}
