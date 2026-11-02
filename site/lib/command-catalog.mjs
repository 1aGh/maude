// @ts-check
/**
 * SINGLE SOURCE OF TRUTH for the maude command catalog (structure + grouping).
 *
 * Consumed by BOTH:
 *   - site/scripts/build-command-reference.mjs  (node prebuild — generates one MDX
 *     page per command + the sidebar meta.json grouping)
 *   - site/lib/diagram-data.ts                  (the CommandTree diagram, re-exported)
 *
 * Why a plain `.mjs` (not folded into diagram-data.ts)? The prebuild step runs
 * `node scripts/build-command-reference.mjs` with no TS loader, so it cannot import
 * a `.ts` file. Keeping the catalog as plain ESM lets the node script AND the React
 * component share ONE source — the phase-17 Risk #1 source-of-truth wiring. The build
 * script asserts catalog ↔ plugins/<plugin>/commands/*.md parity and FAILS LOUD on
 * drift, so a command added without a catalog entry (or vice-versa) breaks the build
 * rather than silently diverging from this diagram.
 *
 * `category` mirrors each command's `category:` frontmatter verbatim. `isDaily` is
 * derived (category === 'daily'); there is no separate daily list to drift.
 */

/** @typedef {{ name: string, category: string }} CatalogCommand */
/** @typedef {{ slug: 'flow' | 'design', label: string, prefix: string, commands: CatalogCommand[] }} CatalogPlugin */

/** Sidebar + tree group order. Unlisted categories sort alphabetically after these. */
export const CATEGORY_ORDER = [
  'daily',
  'setup',
  'utils',
  'validate',
  'bug',
  'record',
  'maintain',
  'review',
  'release',
  'uncategorized',
];

/**
 * Display label per category group (the CommandTree group heading + a one-line note).
 * @type {Record<string, { label: string, note: string }>}
 */
export const CATEGORY_META = {
  daily: { label: 'daily', note: 'every feature cycle' },
  setup: { label: 'setup', note: 'run once' },
  utils: { label: 'utils', note: 'inner-loop checks' },
  validate: { label: 'validate', note: 'regression gates' },
  bug: { label: 'bug', note: 'RCA → fix' },
  record: { label: 'record', note: 'decisions & retros' },
  maintain: { label: 'maintain', note: 'housekeeping' },
  review: { label: 'review', note: 'pre-commit' },
  release: { label: 'release', note: 'ship a version' },
  uncategorized: { label: 'misc', note: '' },
};

/** @type {CatalogPlugin[]} */
export const COMMAND_CATALOG = [
  {
    slug: 'flow',
    label: 'Flow',
    prefix: '/flow:',
    commands: [
      { name: 'plan', category: 'daily' },
      { name: 'execute', category: 'daily' },
      { name: 'done', category: 'daily' },
      { name: 'validate', category: 'daily' },
      { name: 'release', category: 'daily' },
      { name: 'run', category: 'daily' },
      { name: 'init', category: 'setup' },
      { name: 'bug-rca', category: 'bug' },
      { name: 'bug-fix', category: 'bug' },
      { name: 'record-ddr', category: 'record' },
    ],
  },
  {
    slug: 'design',
    label: 'Design',
    prefix: '/design:',
    commands: [
      { name: 'new', category: 'daily' },
      { name: 'edit', category: 'daily' },
      { name: 'board', category: 'daily' },
      { name: 'chat', category: 'daily' },
      { name: 'critic', category: 'daily' },
      { name: 'browse', category: 'daily' },
      { name: 'screenshot', category: 'daily' },
      { name: 'rollback', category: 'daily' },
      { name: 'draw', category: 'daily' },
      { name: 'export', category: 'daily' },
      { name: 'handoff', category: 'daily' },
      { name: 'to-lottie', category: 'daily' },
      { name: 'to-rn', category: 'daily' },
      { name: 'photo', category: 'daily' },
      { name: 'reel', category: 'daily' },
      { name: 'video-analyze', category: 'daily' },
      { name: 'generate', category: 'daily' },
      { name: 'import', category: 'daily' },
      { name: 'assets', category: 'daily' },
      { name: 'comments', category: 'daily' },
      { name: 'history', category: 'daily' },
      { name: 'open', category: 'daily' },
      { name: 'present', category: 'daily' },
      { name: 'system', category: 'daily' },
      { name: 'trash', category: 'daily' },
      { name: 'help', category: 'daily' },
      { name: 'init', category: 'setup' },
      { name: 'setup-ds', category: 'setup' },
      { name: 'setup-docs', category: 'setup' },
      { name: 'hub-workspace', category: 'hub' },
      { name: 'smoke', category: 'validate' },
    ],
  },
];

/**
 * A command is a daily verb iff its category is 'daily'.
 * @param {CatalogCommand} command
 */
export function isDaily(command) {
  return command.category === 'daily';
}

/**
 * Group a plugin's commands by category in CATEGORY_ORDER, sorting names within a
 * group. Shared by build-command-reference.mjs (sidebar) and the CommandTree diagram.
 * @param {CatalogPlugin} plugin
 * @returns {{ category: string, label: string, note: string, commands: string[] }[]}
 */
export function groupByCategory(plugin) {
  /** @type {Map<string, string[]>} */
  const byCat = new Map();
  for (const cmd of plugin.commands) {
    let list = byCat.get(cmd.category);
    if (!list) {
      list = [];
      byCat.set(cmd.category, list);
    }
    list.push(cmd.name);
  }
  const keys = [
    ...CATEGORY_ORDER.filter((k) => byCat.has(k)),
    ...[...byCat.keys()].filter((k) => !CATEGORY_ORDER.includes(k)).sort(),
  ];
  return keys.map((category) => {
    const meta = CATEGORY_META[category] ?? { label: category, note: '' };
    return {
      category,
      label: meta.label,
      note: meta.note,
      commands: (byCat.get(category) ?? []).slice().sort(),
    };
  });
}
