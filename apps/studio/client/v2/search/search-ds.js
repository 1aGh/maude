// client/v2/search/search-ds.js — S10.13: the Design system in Search ⌘K (13 · ds-where-gator).
//
//   "Design system"             one row per system → opens its canvas
//   "In the Design system"      every colour, type style and component by its own name — Czech names too
//                               (`tokens.json` `label` and `valueNames`, `components.json` labels)
//
// PURE: the boards (`GET /_api/ds/board`, maude.ds-board/1) in, rows out. A row runs `ds.go-to` with the system
// and the thing named; the shell opens the canvas, focuses the section and selects the token. An unconverted
// system has no tokens.json to read: it gets its one row and no token rows.

export const DS_GROUP = 'design-system';
export const IN_DS_GROUP = 'in-design-system';

const SECTION_WORD = Object.freeze({
  brand: 'Brand',
  colour: 'Colour',
  type: 'Type',
  space: 'Space & shape',
  motion: 'Motion',
});

const usedIn = (n) =>
  Number.isInteger(n) ? `used in ${n} ${n === 1 ? 'canvas' : 'canvases'}` : '';

/**
 * @param {{ systems: { name: string, label?: string, converted?: boolean, board?: any }[],
 *           run: (params: { ds: string, section?: string, token?: string, component?: string }) => void,
 *           sections?: number }} a
 * @returns {object[]} search rows (client/v2/search/search-model.js row shape)
 */
export function dsSearchRows({ systems, run, sections = 7 }) {
  const rows = [];
  const many = systems.length > 1;
  for (const sys of systems) {
    const label = String(sys.board?.label || sys.label || sys.name);
    const meta = `Design system · ${sys.converted ? `${sections} sections` : 'not on a canvas yet'}`;
    rows.push({
      group: DS_GROUP,
      id: `ds:${sys.name}`,
      name: label,
      meta,
      keys: '',
      where: '',
      advanced: false,
      icon: 'system',
      disabled: false,
      keywords: ['design system', 'design', 'system', 'tokens', 'colours', 'type', 'components'],
      searchRow: true,
      onlyWhenSearched: true,
      runnable: () => true,
      run: () => run({ ds: sys.name }),
    });
    if (!sys.converted || !sys.board) continue;
    const suffix = many ? ` · ${label}` : '';
    for (const t of sys.board.tokens ?? []) {
      if (!t?.css || !t.label) continue;
      const section = t.section in SECTION_WORD ? t.section : 'colour';
      const names = Object.values(t.valueNames ?? {}).filter((v) => typeof v === 'string' && v);
      const meta = [SECTION_WORD[section], t.group, usedIn(t.used)].filter(Boolean).join(' · ');
      rows.push({
        group: IN_DS_GROUP,
        id: `ds-token:${sys.name}:${t.css}`,
        name: t.label,
        meta: `${meta}${suffix}`,
        keys: '',
        where: '',
        advanced: false,
        icon: section === 'type' ? 'type' : 'eyedropper',
        disabled: false,
        // a value's own name ("Klubová zelená") is found as well as the token's
        keywords: [t.css.replace(/^--/, ''), SECTION_WORD[section], t.group, ...names].filter(
          Boolean
        ),
        searchRow: true,
        onlyWhenSearched: true,
        runnable: () => true,
        run: () => run({ ds: sys.name, section, token: t.css }),
      });
    }
    for (const c of sys.board.components ?? []) {
      if (!c?.name) continue;
      rows.push({
        group: IN_DS_GROUP,
        id: `ds-component:${sys.name}:${c.name}`,
        name: c.label || c.name,
        meta: ['Component', usedIn(c.used)].filter(Boolean).join(' · ') + suffix,
        keys: '',
        where: '',
        advanced: false,
        icon: 'button',
        disabled: false,
        keywords: [c.name, 'component'],
        searchRow: true,
        onlyWhenSearched: true,
        runnable: () => true,
        run: () => run({ ds: sys.name, component: c.name }),
      });
    }
  }
  return rows;
}
