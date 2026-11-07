/**
 * diagram-data.ts — consolidated data source for the docs-site diagram primitives
 * (`site/components/mdcc/diagrams/*`). One file instead of three (commands / loops /
 * install-steps) — see phase-17 plan "Files to Create".
 *
 * The command catalog lives in the sibling `command-catalog.mjs` (plain ESM, so the
 * node prebuild `build-command-reference.mjs` can import the SAME source). This file
 * re-exports it so React components have one import surface.
 */

import {
  CATEGORY_META,
  CATEGORY_ORDER,
  COMMAND_CATALOG,
  groupByCategory,
  isDaily,
} from './command-catalog.mjs';
import statsJson from './stats.json';

export { CATEGORY_META, CATEGORY_ORDER, COMMAND_CATALOG, groupByCategory, isDaily };

export type PluginSlug = 'flow' | 'design' | 'design-video';

/** Catalog shapes (mirror the JSDoc typedefs in command-catalog.mjs). */
export type CatalogCommand = { name: string; category: string };
export type CatalogPlugin = {
  slug: PluginSlug;
  label: string;
  prefix: string;
  commands: CatalogCommand[];
};

/** A category group as returned by `groupByCategory`. */
export type CommandGroup = {
  category: string;
  label: string;
  note: string;
  commands: string[];
};

/* ── LoopDiagram nodes ─────────────────────────────────────────────────────── */
export type LoopNode = { command: string; caption: string; active?: boolean };

/** The design canvas loop — `edit` is where you live; everything else bookends it. */
export const DESIGN_LOOP: LoopNode[] = [
  { command: 'init', caption: 'one-time' },
  { command: 'setup-ds', caption: 'design system' },
  { command: 'new', caption: 'scaffold canvas' },
  { command: 'edit', caption: 'iterate in place', active: true },
  { command: 'critic', caption: 'panel review' },
  { command: 'handoff', caption: 'ship to code' },
  { command: 'repeat', caption: 'next surface' },
];

/** The flow feature lifecycle. */
export const FLOW_LOOP: LoopNode[] = [
  { command: 'init', caption: 'one-time' },
  { command: 'setup-prd', caption: 'PRD + plans' },
  { command: 'plan', caption: 'context-rich' },
  { command: 'execute', caption: 'edit · verify', active: true },
  { command: 'done', caption: 'validate · ship' },
  { command: 'repeat', caption: 'next feature' },
];

/* ── CommandFlow steps ─────────────────────────────────────────────────────── */
export type FlowStep = { n: string; command: string; caption: string };

/** Getting-started: a fresh repo to the first slash command (mirrors the page's 4 sections). */
export const INSTALL_STEPS: FlowStep[] = [
  { n: '01', command: 'npm i -g @1agh/maude', caption: 'install the CLI' },
  { n: '02', command: '/plugin marketplace add', caption: 'add 1aGh/maude' },
  { n: '03', command: '/plugin install', caption: 'design + flow' },
  { n: '04', command: '/flow:init', caption: 'scaffold .ai/ · ready' },
];

/** cli.mdx: `maude init` from install to ready. */
export const INIT_FLOW: FlowStep[] = [
  { n: '01', command: 'install', caption: 'npm i -g @1agh/maude' },
  { n: '02', command: 'maude init', caption: 'scaffold .ai/ skeleton' },
  { n: '03', command: '/flow:init', caption: 'autodetect + config' },
  { n: '04', command: 'ready', caption: 'first /flow:plan' },
];

/** CommandFlow variant → steps. Keeps .mdx free of JS imports (variant="install"). */
export const FLOW_STEPS = {
  install: INSTALL_STEPS,
  init: INIT_FLOW,
} as const;

export type FlowStepVariant = keyof typeof FLOW_STEPS;

/* ── FileTree rows ─────────────────────────────────────────────────────────── */
export type FileRow = {
  depth: number;
  glyph: string;
  label: string;
  hint?: string;
  highlight?: 'add' | 'change';
};

/** The .ai/ skeleton `/flow:init` writes — mirrors the getting-started ASCII fence
 * it replaces (no info lost), with workflows.config.json highlighted. */
export const AI_SKELETON: FileRow[] = [
  { depth: 0, glyph: '', label: '.ai/' },
  {
    depth: 1,
    glyph: '├─',
    label: 'workflows.config.json',
    hint: '← the only file you usually edit',
    highlight: 'add',
  },
  { depth: 1, glyph: '├─', label: 'decisions/', hint: 'DDRs' },
  { depth: 1, glyph: '├─', label: 'plans/', hint: '+ archive/' },
  { depth: 1, glyph: '├─', label: 'state/', hint: 'STATE.md · HANDOFF.md' },
  { depth: 1, glyph: '├─', label: 'docs/', hint: 'PRD · codebase map' },
  { depth: 1, glyph: '├─', label: 'retros/', hint: 'post-feature' },
  { depth: 1, glyph: '└─', label: 'scenarios/', hint: 'cross-platform UI' },
];

/** The maude CLI surface (cli.mdx). */
export const CLI_SUBCOMMANDS: FileRow[] = [
  { depth: 0, glyph: '', label: 'maude' },
  { depth: 1, glyph: '├─', label: 'init', hint: 'scaffold .ai/' },
  { depth: 1, glyph: '├─', label: 'config', hint: 'show · get · set' },
  { depth: 1, glyph: '├─', label: 'doctor', hint: 'deps + config health' },
  { depth: 1, glyph: '├─', label: 'cache', hint: 'sidecar cache' },
  { depth: 1, glyph: '├─', label: 'design', hint: 'serve · export · link' },
  { depth: 1, glyph: '└─', label: 'hub', hint: 'self-hostable sync' },
];

export const FILE_TREES = {
  '.ai/': AI_SKELETON,
  'cli-subcommands': CLI_SUBCOMMANDS,
} as const;

export type FileTreeVariant = keyof typeof FILE_TREES;

/* ── StatPanel cells ───────────────────────────────────────────────────────── */
export type StatCell = { value: string | number; label: string; hint?: string };

const stats = statsJson as {
  plugins: { design: { commands: number }; flow: { commands: number } };
};

/**
 * The catalog at a glance. `commands` is number-driven from build-stats; the rest are
 * structural constants of the product (2 plugins, 1 CLI, 0 telemetry by design;
 * `critics` = the count of `*-critic` agents under plugins/design/agents/).
 */
export const CATALOG_STATS: StatCell[] = [
  {
    value: stats.plugins.design.commands + stats.plugins.flow.commands,
    label: 'commands',
    hint: 'design + flow',
  },
  { value: 12, label: 'critics', hint: 'panel agents' },
  { value: 2, label: 'plugins', hint: 'design · flow' },
  { value: 1, label: 'CLI', hint: '@1agh/maude' },
  { value: 0, label: 'telemetry', hint: 'by design' },
];
