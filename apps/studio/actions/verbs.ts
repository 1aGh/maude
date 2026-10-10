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
  /** `scope:'design'` → `maude design <verb>`; `scope:'top'` → `maude <verb>` (may be two words). */
  scope: 'design' | 'top';
  verb: string;
  effect: VerbEffect;
  /** Effect none/project, but kept off the auto list until the lead decides. Names the question. */
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

const HOLD_55 = 'not in §5.5 top-level list (§5.3 tiers it auto) — lead decision';

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
  d('help', 'none'),
  // ── `maude design`, effect project (writes versioned files of this project) ──────────────
  d('annotate', 'project'),
  d('canvas-edit', 'project'),
  d('handoff', 'project'),
  d('import-asset', 'project'),
  d('import-brand', 'project'),
  d('import-tokens', 'project'),
  d('ingest-footage', 'project'),
  d('photo-adjust', 'project'),
  d('export', 'project', {
    hold: '--out is not confined: /design:export documents `--out ~/Downloads/…` — lead decision',
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
  d('photo-bg-remove', 'external', { note: 'first-use ~40 MB model-weight fetch (§5.3 †)' }),
  d('init', 'destructive', { note: '--force overwrites (§5.3 †)' }),
  d('ds-upgrade', 'destructive', { note: '`apply` rewrites system files (V2-1.13 §5.10)' }),
  d('bulk-deletes', 'shared'),
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
  t('kg ingest', 'project', { hold: HOLD_55 }),
  t('kg record-log', 'project', { hold: HOLD_55 }),
  t('kg import', 'project', { hold: HOLD_55 }),
  t('kg sync', 'shared'),
  t('kg session-sync', 'shared'),
  t('kg check-upstream', 'external'),
  t('kg', 'shared', { note: 'any other kg sub-verb (scope, help, …)' }),
  t('help', 'none', { hold: HOLD_55 }),
  t('preflight', 'none', { hold: HOLD_55 }),
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

/** The `Bash(…)` allow rules for every auto-tier verb, in table order. */
export function autoAllowRules(): string[] {
  return MAUDE_VERBS.filter((v) => verbTier(v) === 'auto').map(
    (v) => `Bash(maude ${v.scope === 'design' ? 'design ' : ''}${v.verb}:*)`
  );
}
