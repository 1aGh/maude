// client/v2/inspector/colour-groups.js — P6 T1 (inspector-ux-rules IR-8): the system's colours as the picker groups them.
//
// The order is the DS schema's (`schema/ds-schema-v1.json` roles of type colour, by group): Surfaces · Text · Borders ·
// Accent · Status, then "More" (Presence · Focus · Selection · Overlay), then the system's expressive slots (brand,
// palette, chart, accent-n), then its own `--x-*` tokens, then "Other" — a colour token the registry does not name.
// The role list is copied here (not imported) so the shell bundle does not carry the whole 56 kB registry; a test
// (`v2-inspector-colour-groups.test.ts`) holds it equal to the schema. Pure — no DOM, no fetch.

/** The schema's colour roles, by group, in schema order. */
export const COLOUR_ROLE_GROUPS = Object.freeze([
  { id: 'surfaces', label: 'Surfaces', roles: ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-4'] },
  { id: 'text', label: 'Text', roles: ['--fg-0', '--fg-1', '--fg-2', '--fg-3'] },
  {
    id: 'borders',
    label: 'Borders',
    roles: ['--border-subtle', '--border-default', '--border-strong'],
  },
  {
    id: 'accent',
    label: 'Accent',
    roles: [
      '--accent',
      '--accent-hover',
      '--accent-active',
      '--accent-fg',
      '--accent-soft',
      '--accent-on-soft',
      '--accent-text',
    ],
  },
  {
    id: 'status',
    label: 'Status',
    roles: [
      '--status-success',
      '--status-warn',
      '--status-error',
      '--status-info',
      '--status-success-fg',
      '--status-warn-fg',
      '--status-error-fg',
      '--status-info-fg',
      '--status-success-soft',
      '--status-warn-soft',
      '--status-error-soft',
      '--status-info-soft',
      '--status-success-text',
      '--status-warn-text',
      '--status-error-text',
      '--status-info-text',
    ],
  },
  {
    id: 'presence',
    label: 'Presence',
    roles: ['--presence-online', '--presence-away', '--presence-offline'],
  },
  { id: 'focus', label: 'Focus', roles: ['--focus-ring'] },
  { id: 'selection', label: 'Selection', roles: ['--selection'] },
  { id: 'overlay', label: 'Overlay', roles: ['--scrim'] },
]);

/** The groups drawn first, each on its own; the rest fold into one "More" group (IR-8). */
const MAIN = new Set(['surfaces', 'text', 'borders', 'accent', 'status']);

/** The schema's colour slot patterns (brand, palette, chart, accent-n). */
const SLOT_RES = [
  /^--brand(?:-(?:[2-9]|[1-9][0-9]))?(?:-fg)?$/,
  /^--palette-(?:[1-9][0-9]?)(?:-fg)?$/,
  /^--palette-ink$/,
  /^--chart-(?:[1-9][0-9]?)$/,
  /^--accent-(?:[2-9]|1[0-2])(?:-(?:hover|active|fg|soft|on-soft|text))?$/,
];
const OWN_RE = /^--x-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ROLE_GROUP = new Map(COLOUR_ROLE_GROUPS.flatMap((g) => g.roles.map((r) => [r, g.id])));

/** Which group a token belongs to: a schema role group id, `slots`, `own` or `other`. */
export function groupOf(name) {
  const g = ROLE_GROUP.get(name);
  if (g) return MAIN.has(g) ? g : 'more';
  if (SLOT_RES.some((re) => re.test(name))) return 'slots';
  if (OWN_RE.test(name)) return 'own';
  return 'other';
}

const EXTRA = [
  { id: 'more', label: 'More' },
  { id: 'slots', label: 'Expressive' },
  { id: 'own', label: 'This system’s own' },
  { id: 'other', label: 'Other tokens' },
];

/**
 * A system's colour token names → the picker's groups, in order, each `{ id, label, tokens }`; an empty group is left
 * out. Roles keep schema order; slots, own and other keep the order the system declares them in.
 * @param {string[]} names
 */
export function colourGroups(names = []) {
  const have = new Set(names);
  const out = [];
  for (const g of COLOUR_ROLE_GROUPS) {
    if (!MAIN.has(g.id)) continue;
    const tokens = g.roles.filter((r) => have.has(r));
    if (tokens.length) out.push({ id: g.id, label: g.label, tokens });
  }
  const more = COLOUR_ROLE_GROUPS.filter((g) => !MAIN.has(g.id)).flatMap((g) =>
    g.roles.filter((r) => have.has(r))
  );
  const byExtra = { more, slots: [], own: [], other: [] };
  for (const n of names) {
    const g = groupOf(n);
    if (g === 'slots' || g === 'own' || g === 'other') byExtra[g].push(n);
  }
  for (const e of EXTRA) if (byExtra[e.id].length) out.push({ ...e, tokens: byExtra[e.id] });
  return out;
}

/**
 * The swatch of a token in both themes: `{ light, dark }` resolved CSS (dark null in a one-theme system, or when the
 * token has the same value in both). `tokens` is a `parseTokensCss` result.
 */
export function swatchOf(name, tokens) {
  const th = tokens?.themes || {};
  const light = th.light?.[name] ?? tokens?.vals?.[name] ?? null;
  const dark = th.dark?.[name] ?? null;
  if (!th.light && dark) return { light: dark, dark: null };
  return { light, dark: dark && dark !== light ? dark : null };
}
