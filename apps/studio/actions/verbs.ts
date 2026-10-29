// verbs.ts — the permission tier of every `maude` verb (contract V2-1.11 §5.3, §5.5; V2-2.8 S4).
//
// A verb's tier is a property of its NAME, and it follows the verb's effect:
//   none / project                         → auto    one `Bash(maude design <verb>:*)` rule in the AI
//                                                     chat's default allow list (bridge.ts)
//   destructive / shared / external        → prompt  Claude Code's own permission card
//   human                                  → human   for people in a terminal; no skill teaches it
// A flag never raises a verb's effect: a riskier variant is a separate verb. When a verb has a
// flag that does (`init --force`, a first-use model download), the whole verb takes the higher
// effect here.
//
// This replaced the single `Bash(maude:*)` rule. That rule auto-allowed every verb, so
// `curl-local` could reach every studio route (git push, trash prune, paid generation).
//
// Leaf module: no imports, erasable TypeScript only. scripts/gen-actions.mjs (Node) and
// acp/bridge.ts (Bun) both read it. Coverage is pinned by test/maude-verb-tiers.test.ts: every verb
// `maude design` dispatches and every top-level command must have an entry here.

export type VerbEffect = 'none' | 'project' | 'destructive' | 'shared' | 'external' | 'human';
export type VerbTier = 'auto' | 'prompt' | 'human';

export interface VerbDef {
  /** `scope:'design'` → `maude design <verb>`; `scope:'top'` → `maude <verb>`. Either may be two
   *  words: a sub-verb entry (`ds-upgrade analyse`) is matched before its verb's own entry. */
  scope: 'design' | 'top';
  verb: string;
  effect: VerbEffect;
  /** Effect none/project, but kept off the auto list by a lead decision. Names it. */
  hold?: string;
  /** Why the effect is what it is, when the name doesn't say it. */
  note?: string;
}

const d = (verb: string, effect: VerbEffect, extra: Partial<VerbDef> = {}): VerbDef => ({
  scope: 'design',
  verb,
  effect,
  ...extra,
});
const t = (verb: string, effect: VerbEffect, extra: Partial<VerbDef> = {}): VerbDef => ({
  scope: 'top',
  verb,
  effect,
  ...extra,
});

// Lead answers on the held verbs: decision:maude/v2-2.4b-held-and-prompting-verbs.
const KG_LOG =
  'writes the versioned .kgai log (repo-tracked, merge=union) — lead: keeps prompting (decision:maude/v2-2.4b-held-and-prompting-verbs)';

export const MAUDE_VERBS: readonly VerbDef[] = [
  // ── `maude design`, effect none (reads, computes, runtime `_*` state) ────────────────────
  d('prep', 'none'),
  d('bootstrap-check', 'none'),
  d('slug', 'none'),
  d('server-up', 'none'),
  d('runtime-health', 'none'),
  d('screenshot', 'none'),
  d('smoke', 'none'),
  d('visual-sanity', 'none'),
  d('perf', 'none'),
  d('canvas-rects', 'none'),
  // S11.6 — read-only: the canvases that can't be drawn (file:line:column) and a canvas's source / one
  // artboard's lines. Both ask the studio, which refuses Can view (Export on the canvas).
  d('canvas-errors', 'none'),
  d('canvas-source', 'none'),
  d('read-annotations', 'none'),
  d('svg-optimize', 'none'),
  d('asset-sweep', 'none'),
  d('draw-proof', 'none'),
  d('probe-footage', 'none'),
  d('smart-frames', 'none'),
  d('agent-browser-safe', 'none', { note: 'loopback-only, ephemeral profile (DDR-185)' }),
  d('chat-open', 'none'),
  d('serve', 'none'),
  d('status', 'none'),
  d('index', 'none'),
  // S8.11. `assets` lists the project's assets with where each is used; `--not-used` is empty until
  // older versions have been checked. Read-only.
  d('assets', 'none'),
  d('help', 'none'),
  d('check', 'none', { note: 'validates bytes; writes nothing' }),
  d('hook', 'project', {
    note: 'writes _runs/ snapshots; post-edit can restore a canvas it can replay',
    hold: 'run by Claude Code from plugins/design/hooks/hooks.json (hooks bypass Bash permissions); the model never calls it, so it stays off the auto list (decision:maude/v2-2.4b-hook-verb-held)',
  }),
  d('place', 'none'),
  d('layout-check', 'none'),
  d('open', 'none', { note: 'moves the user’s view (POST /_api/ui/open), never a file' }),
  // V2-2.4b (§5.3, V2-1.9 §5.11). `history` — this project's versions. The read sub-verbs are
  // auto; any other sub-verb falls to the `history` entry below and prompts.
  d('history list', 'none'),
  d('history show', 'none'),
  d('history diff', 'none'),
  d('history object', 'none'), // S1.16: one object's versions — a read
  // S1.17 (S1-trash.md). `trash list` reads; `trash restore` brings one item back (V2-1.11 §5.3: project
  // → auto); `trash clear` deletes for good and is the OWNER's, at a terminal — human tier, never the AI
  // chat (decision:maude/v2-lead-trash-clear-human-only); the studio refuses non-owners whatever is sent.
  d('trash list', 'none'),
  // `comments list` reads threads. Replying / resolving / adding as the AI are S9's sub-verbs and
  // fall to `comments` below (shared → prompt).
  d('comments list', 'none'),
  // The Exports panel (S8). `again` re-submits a history entry the way the sheet's "Export again"
  // row does and writes the file inside the project (--out confined); other sub-verbs prompt.
  d('exports list', 'none'),
  d('exports again', 'project', { note: 'writes the export inside the project (--out confined)' }),
  // S5.4 (V2-1.15 §5.10). `runs list` shows which artboards AI is changing, so a terminal Claude
  // plans around them; `runs stop` stops one of YOUR live runs on this Mac (a member's is refused).
  d('runs list', 'none'),
  d('runs stop', 'project', { note: 'stops one of your own live runs on this Mac' }),
  // S11.11 (Menu › Diagnostics). `logs` prints this Mac's log lines (redacted at the store, again in
  // the verb; inside the untrusted block); `sync status` reads the one-word Sync status. Resync is
  // below: it sends files to the cloud copy, so it prompts.
  d('logs', 'none'),
  d('sync status', 'none'),
  // ── `maude design`, effect project (writes versioned files of this project) ──────────────
  d('annotate', 'project'),
  d('canvas-edit', 'project'),
  d('handoff', 'project'),
  d('import-asset', 'project'),
  d('import-tokens', 'project'),
  d('ingest-footage', 'project'),
  d('photo-adjust', 'project'),
  // S7.2 (V2-1.10 §5.7). Local whisper.cpp only: writes assets/<name>.transcript.json inside the
  // project, never downloads a model, has no --provider (a flag must never raise a tier — the cloud
  // engines stay behind `transcribe`).
  d('transcribe-local', 'project', {
    note: 'local whisper.cpp only; no network, no model download',
  }),
  // S7.3 / S7.6c (V2-1.10 §5.7). `beats` writes assets/<name>.beats.json (`--dry-run` prints only);
  // the video tools are each one edit op through the running studio (its refusals apply), and
  // `captions add` transcribes with transcribe-local only — never a cloud engine.
  d('beats', 'project', { note: 'local analysis; --dry-run writes nothing' }),
  d('captions list', 'none'),
  d('captions add', 'project', { note: 'transcribe-local only (no cloud), then one edit op' }),
  d('captions export', 'project', { note: 'stdout, or --out confined to the project' }),
  d('captions', 'project', { note: 'add / list / export; an unknown sub-verb is a usage error' }),
  d('cut-words', 'project'),
  d('cut-to-beat', 'project'),
  // S7.14 (V2-1.10 §5.7). `reel-place` writes ONE shot of a cut onto the video canvas (the AI's own write:
  // inside a run the studio stages it); exit 4 when every shot is placed.
  d('reel-place', 'project', {
    note: 'one shot per call onto one canvas; fast check before the write',
  }),
  d('export', 'project', {
    hold: '/design:export documents `--out ~/Downloads/…` — lead: keeps prompting (decision:maude/v2-2.4b-held-and-prompting-verbs)',
  }),
  d('ds-check', 'project', { note: '--fix=mechanical / --emit write canvases / tokens.json' }),
  // ── `maude design`, prompt ────────────────────────────────────────────────────────────────
  d('curl-local', 'external', { note: 'any method/body against any loopback port: every route' }),
  d('draw-build', 'external', { note: 'runs model-authored code (Q2)' }),
  d('to-lottie', 'external', { note: 'runs model-authored code (Q2)' }),
  d('generate', 'external', { note: 'paid provider' }),
  d('audio-search', 'external', { note: 'paid provider' }),
  d('fetch-asset', 'external', { note: 'download' }),
  d('ensure-browser', 'external', { note: 'download' }),
  d('transcribe', 'external', { note: 'engine may be a paid cloud fallback' }),
  d('import-figma', 'external', { note: 'network; --explode' }),
  d('import-brand', 'external', { note: 'network with --url (S8.18): reads a website' }),
  d('photo-bg-remove', 'external', { note: 'first-use ~40 MB model-weight fetch (§5.3 †)' }),
  // S12.13 (V2-1.17 §5.9, S12-slices Q1). Every form, `--status` too (a flag never lowers a verb):
  // a batch spends the person's Claude account; it refuses without their consent (exit 3).
  d('describe', 'external', {
    note: "spends the person's Claude account (the asset-describer agent); refuses without consent",
  }),
  d('init', 'destructive', { note: '--force overwrites (§5.3 †)' }),
  // ds-upgrade: the read-only steps are their own sub-verbs, so a prefix rule can name them; the
  // dispatcher refuses a step flag after a sub-verb, so `analyse x --apply p` can't escalate.
  d('ds-upgrade analyse', 'none'),
  d('ds-upgrade plan', 'none'),
  d('ds-upgrade validate', 'none'),
  d('ds-upgrade status', 'none'),
  // S10.15b (lead): a stage, its proof, its discard and a cancel write only the OS temp dir + _state/ds-upgrade/
  d('ds-upgrade stage', 'project', {
    note: 'copies the design root to a throwaway stage outside the project',
  }),
  d('ds-upgrade prove', 'project', {
    note: 'two headless studios on the stage; writes review.json under _state/',
  }),
  d('ds-upgrade discard', 'project', { note: 'removes a stage' }),
  d('ds-upgrade cancel', 'project', { note: 'stops a running proof and discards its stage' }),
  d('ds-upgrade', 'destructive', {
    note: '`apply` rewrites system files (V2-1.13 §5.10); the flag forms prompt too',
  }),
  d('bulk-deletes', 'shared'),
  d('history restore', 'destructive', {
    note: 'the whole canvas back to an old version, landed as a NEW version over Now (C5)',
  }),
  d('trash move', 'project', {
    note: 'one canvas to the shared Trash, as the row menu does; `trash restore` brings it back (V2-8.16)',
  }),
  d('trash restore', 'project', {
    note: 'brings one canvas or artboard back for everyone; a taken name gets a new one',
  }),
  d('trash clear', 'human', {
    note: 'deletes for good what the team could still restore — the owner’s, with a question first',
  }),
  d('trash', 'shared', { note: 'any other trash sub-verb prompts until it gets its own entry' }),
  d('history undo', 'shared', { note: 'undoes an accepted action for everyone (V2-1.5)' }),
  d('history name', 'shared', {
    note: 'names a version everyone in the project sees (V2-1.9 §5.4)',
  }),
  d('exports', 'external', {
    note: 'a sub-verb not tiered above (a cloud render lane, a retry) prompts until it gets its own entry',
  }),
  d('sync resync', 'shared', {
    note: 'compares every file with the cloud copy and sends what is newer here (nothing is overwritten)',
  }),
  d('sync', 'shared', {
    note: 'a sub-verb not tiered above prompts until it gets its own entry',
  }),
  d('runs', 'shared', {
    note: 'a sub-verb not tiered above prompts until it gets its own entry',
  }),
  // S10.3 (V2-1.6 §5.12, S10 §2.4) — the design-system verbs. `status`, `usage` and
  // `revisions list` read (the helper refuses any other word after them); every other sub-verb
  // changes the system for everyone and prompts. Clearing a token out of the trash is the owner's
  // — the studio refuses anyone else (rule 12). A future `revisions` write (prune) gets its own
  // sub-verb, never a flag on `revisions`.
  d('ds status', 'none'),
  d('ds usage', 'none'),
  // S10.19. Runs the check over the system's files and keeps one file under `_state/` (per Mac, ignored).
  d('ds check-system', 'none', { note: 'reads the system; keeps _state/ds-check/<ds>.json' }),
  d('ds revisions', 'none', {
    note: 'only `revisions list <ds>`; the helper refuses any other form',
  }),
  d('ds', 'shared', {
    note: 'publish / pending / keep / undo / pick / canvas / trash / restore / clear / make / draft / use / mix / done change the system for everyone',
  }),
  // S9.7b — one `POST /_api/comments/op` each, as the session, marked AI-written (C3: no mentions).
  d('comments reply', 'shared', { note: 'posts a reply where others see it' }),
  d('comments resolve', 'shared', { note: 'resolves a thread for everyone' }),
  d('comments reopen', 'shared', { note: 'reopens a thread for everyone' }),
  d('comments add', 'shared', {
    note: '--as-ai: an AI-written comment (or a critic round, --findings)',
  }),
  d('comments', 'shared', {
    note: 'any sub-verb but `list` posts or resolves where others see it (S9: reply/resolve/add --as-ai)',
  }),
  d('history', 'destructive', {
    note: '`restore` puts an old version over Now (as a new version, C5); any sub-verb but list/show/diff prompts',
  }),
  // ── `maude design`, human ─────────────────────────────────────────────────────────────────
  d('link', 'human'),
  d('adopt', 'human'),
  d('unlink', 'human'),
  d('detach', 'human'),

  // ── top-level `maude` ─────────────────────────────────────────────────────────────────────
  t('version', 'none'),
  t('doctor', 'none', { note: '--fix skips installs and .gitignore edits without a TTY' }),
  t('config show', 'none'),
  t('config get', 'none'),
  t('config set', 'external', { note: 'writes `quality` gates that flow `eval`s' }),
  t('config', 'external', { note: 'any other config sub-verb' }),
  t('kg context', 'none'),
  t('kg resolve', 'none'),
  t('kg doctor', 'none'),
  t('kg ingest', 'project', { hold: KG_LOG }),
  t('kg record-log', 'project', { hold: KG_LOG }),
  t('kg import', 'project', { hold: KG_LOG }),
  t('kg sync', 'shared'),
  t('kg session-sync', 'shared'),
  t('kg check-upstream', 'external'),
  t('kg', 'shared', { note: 'any other kg sub-verb (scope, help, …)' }),
  t('help', 'none'),
  t('flow usage', 'none', {
    note: "reads this project's Claude Code session records for token spend (flow refactor #159); prints numbers, writes nothing",
  }),
  t('preflight', 'none'),
  t('scenario-report', 'project', { hold: 'not tiered by the contract' }),
  t('migrate', 'destructive'),
  t('hub', 'human'),
  t('init', 'human'),
  t('harness', 'human'),
  t('codex', 'human'),
  t('cache', 'human'),
];

export function verbTier(v: VerbDef): VerbTier {
  if (v.effect === 'human') return 'human';
  if ((v.effect === 'none' || v.effect === 'project') && !v.hold) return 'auto';
  return 'prompt';
}

/**
 * The read-only help FLAG forms, as EXACT rules (no `:*`): only that one command line matches, so
 * nothing but the help output gets through. `help` itself is a verb above (`maude help:*`,
 * `maude design help:*`), and `maude design <verb> --help` rides on the verb's own rule — so a
 * prompt / human verb's `--help` still prompts. V2-8.16: `maude design --help` was denied while
 * `maude design help` was allowed, and the terminal agent took every `maude` command for gated.
 */
export const HELP_ALLOW_RULES: readonly string[] = [
  'Bash(maude --help)',
  'Bash(maude design --help)',
];

/** The `Bash(…)` allow rules for every auto-tier verb, in table order, then the help flag forms. */
export function autoAllowRules(): string[] {
  return [
    ...MAUDE_VERBS.filter((v) => verbTier(v) === 'auto').map(
      (v) => `Bash(maude ${v.scope === 'design' ? 'design ' : ''}${v.verb}:*)`
    ),
    ...HELP_ALLOW_RULES,
  ];
}
