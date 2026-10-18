// S1.5 — ⌘K across projects (11 · pn-k-across): once another project answers, results group by
// project — this tab first, under its square, then the others with where they are ("in another tab" /
// "not open — opens a tab"); this project never answers twice; ↵ on another project's row asks the shell
// with ids only; a browser tab asks nobody.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectSquare } from '../client/home/home-icons.jsx';
import { assemble, remoteRows } from '../client/v2/search/search-model.js';
import {
  acrossProjects,
  assembleAcross,
  desktopProjectsEnv,
  OTHER_PROJECT_CAP,
  openSearchResult,
  ownPidOf,
  PLACE_ASIDE,
  projectGroups,
  projectSquare,
  searchProjects,
} from '../client/v2/search/search-projects.js';
import { parityFor } from '../client/v2/shell/shell-parity.js';

const SELF = `l${'a'.repeat(16)}`;
const STUDIO = `l${'b'.repeat(16)}`;
const FOLIO = `l${'c'.repeat(16)}`;

// What this tab's own index answers (`/_api/index?q=mobil`)
const OWN = remoteRows(
  {
    rows: [
      {
        group: 'canvases',
        key: 'web/responsive.tsx',
        name: 'responsive',
        meta: 'web',
        score: 4,
        close: false,
        marks: [],
      },
      {
        group: 'artboards',
        key: 'web/website.tsx#nabor',
        name: 'Mobil · nábor 2027',
        meta: 'website web',
        score: 4,
        close: false,
        marks: [],
      },
    ],
  },
  { query: 'mobil' }
);

// What Rust `index_search` answers (V2-1.1 §5.4: other projects of this profile, placed, thumbs inline)
const ACROSS = {
  groups: [
    {
      pid: STUDIO,
      name: 'Studio site',
      place: 'tab',
      rows: [
        {
          group: 'canvases',
          key: 'ui/Mobile-detail.tsx',
          name: 'Mobile — detail',
          meta: 'ui',
          score: 4,
          close: false,
          marks: [],
          cover: 'k1',
          thumb: 'data:image/jpeg;base64,AAAA',
        },
        {
          group: 'artboards',
          key: 'ui/Homepage.tsx#mobile',
          name: 'Mobile',
          meta: 'Homepage ui web',
          score: 4,
          close: false,
          marks: [],
        },
      ],
    },
    {
      pid: FOLIO,
      name: 'Portfolio 2026',
      place: 'closed',
      rows: [
        {
          group: 'canvases',
          key: 'case/Mobilni-app.tsx',
          name: 'Mobilní app — case study',
          meta: 'case',
          score: 3,
          close: false,
          marks: [],
          thumb: 'javascript:alert(1)',
        },
      ],
    },
  ],
};

describe('projectGroups — the shell’s answer in ⌘K’s shape', () => {
  test('one group per other project; rows carry ids the shell can open, never a path', () => {
    const gs = projectGroups(ACROSS, { ownPid: SELF, query: 'mobil' });
    expect(gs.map((g) => [g.pid, g.name, g.place])).toEqual([
      [STUDIO, 'Studio site', 'tab'],
      [FOLIO, 'Portfolio 2026', 'closed'],
    ]);
    const [canvas, board] = gs[0].rows;
    expect(canvas).toMatchObject({
      id: `project:${STUDIO}:canvas:ui/Mobile-detail.tsx`,
      pid: STUDIO,
      canvasRel: 'ui/Mobile-detail.tsx',
      artboardId: null,
      path: null,
    });
    expect(board).toMatchObject({
      pid: STUDIO,
      canvasRel: 'ui/Homepage.tsx',
      artboardId: 'mobile',
      meta: 'artboard in Homepage',
    });
    expect(canvas.thumb).toBe('data:image/jpeg;base64,AAAA');
    expect(gs[1].rows[0].thumb, 'only the inlined JPEG is a picture').toBeNull();
  });

  test('this project never answers twice — nor a repeated, malformed or empty group', () => {
    const gs = projectGroups(
      {
        groups: [
          { pid: SELF, name: 'Alligators brand', place: 'tab', rows: ACROSS.groups[0].rows },
          ACROSS.groups[0],
          { ...ACROSS.groups[0], name: 'again' },
          { pid: '../etc', name: 'x', place: 'tab', rows: ACROSS.groups[0].rows },
          { pid: FOLIO, name: 'Portfolio 2026', place: 'closed', rows: [{ name: 'no key' }] },
        ],
      },
      { ownPid: SELF }
    );
    expect(gs.map((g) => g.pid)).toEqual([STUDIO]);
  });

  test('an unknown place reads as not open (it opens a tab)', () => {
    const gs = projectGroups({ groups: [{ ...ACROSS.groups[1], place: 'weird' }] });
    expect(gs[0].place).toBe('closed');
  });
});

describe('assembleAcross — grouped by project once another project answers', () => {
  const own = { pid: SELF, name: 'Alligators brand' };

  test('nobody else answered: today’s Canvases · Artboards view, unchanged', () => {
    const a = assembleAcross({ query: 'mobil', remote: OWN, others: [], own });
    const b = assemble({ query: 'mobil', remote: OWN });
    expect(a).toEqual(b);
    expect(a.groups.map((g) => g.id)).toEqual(['canvases', 'artboards']);
  });

  test('2+ projects: this tab first under its square, then the others with where they are', () => {
    const others = projectGroups(ACROSS, { ownPid: SELF, query: 'mobil' });
    const v = assembleAcross({ query: 'mobil', remote: OWN, others, own });
    expect(v.groups.map((g) => g.id)).toEqual([
      'project-self',
      `project-${STUDIO}`,
      `project-${FOLIO}`,
    ]);
    expect(v.groups.map((g) => [g.title, g.aside])).toEqual([
      ['Alligators brand', 'this tab'],
      ['Studio site', 'in another tab'],
      ['Portfolio 2026', 'not open — opens a tab'],
    ]);
    // this tab's canvases then its artboards, in one group
    expect(v.groups[0].rows.map((r) => r.id)).toEqual([
      'canvas:web/responsive.tsx',
      'artboard:web/website.tsx#nabor',
    ]);
    expect(v.groups[0].square).toEqual(projectSquare(SELF, 'Alligators brand'));
    expect(v.total).toBe(5);
    expect(v.items.map((r) => r.id)).toEqual([...v.groups.flatMap((g) => g.rows.map((r) => r.id))]);
    // no row of this project in another project's group
    const ids = v.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a resting tab is still “in another tab”', () => {
    expect(PLACE_ASIDE.resting).toBe('in another tab');
  });

  test('only another project answered: its group, no empty “this tab” header', () => {
    const others = projectGroups(ACROSS, { ownPid: SELF, query: 'mobil' });
    const v = assembleAcross({ query: 'mobil', remote: [], others, own });
    expect(v.groups.map((g) => g.id)).toEqual([`project-${STUDIO}`, `project-${FOLIO}`]);
  });

  // S15-A2: "Did you mean" is one flat list — a row of another project keeps its project ON the row
  // (square, name, "not open — opens a tab"), since ↵ on it switches project.
  test('“Did you mean”: another project’s row still says which project it is and where', () => {
    // every row reached through a typo: the index answers what is close to "mobjle"
    const typo = {
      groups: [
        ACROSS.groups[0],
        {
          ...ACROSS.groups[1],
          rows: [{ ...ACROSS.groups[1].rows[0], key: 'case/Mobile-app.tsx', name: 'Mobile app' }],
        },
      ],
    };
    const others = projectGroups(typo, { ownPid: SELF, query: 'mobjle' });
    const v = assembleAcross({ query: 'mobjle', remote: [], others, own });
    expect(v.didYouMean).toBe(true);
    expect(v.groups.map((g) => g.id)).toEqual(['did-you-mean']);
    const rows = v.groups[0].rows.filter((r) => r.pid);
    expect(new Set(rows.map((r) => r.pid))).toEqual(new Set([STUDIO, FOLIO]));
    for (const r of rows) {
      const g = typo.groups.find((x) => x.pid === r.pid);
      expect(r.project).toEqual({
        name: g.name,
        square: projectSquare(g.pid, g.name),
        aside: PLACE_ASIDE[g.place],
      });
    }
    expect(v.items.filter((r) => r.pid).every((r) => r.project)).toBe(true);
    // The palette draws it on the row (it is not a group header any more).
    const src = readFileSync(
      join(import.meta.dir, '../client/dialogs/command-palette.jsx'),
      'utf8'
    );
    expect(src).toContain('data-testid="palette-project-label"');
    expect(src).toContain('{item.project.name} · {item.project.aside}');
  });

  test('another project shows its first rows; the rest are one more word away', () => {
    const many = {
      groups: [
        {
          pid: STUDIO,
          name: 'Studio site',
          place: 'tab',
          rows: Array.from({ length: 10 }, (_, i) => ({
            group: 'canvases',
            key: `ui/Mobil-${i}.tsx`,
            name: `Mobil ${i}`,
            meta: 'ui',
            score: 1,
            close: false,
            marks: [],
          })),
        },
      ],
    };
    const v = assembleAcross({
      query: 'mobil',
      others: projectGroups(many, { query: 'mobil' }),
      own,
    });
    expect(v.groups[0].rows.length).toBe(OTHER_PROJECT_CAP);
    expect(v.total).toBe(10);
  });
});

describe('the square — the same project wears the same colour on Home', () => {
  test('tone and initial agree with Home’s ProjectSquare for the same pid', () => {
    for (const [pid, name] of [
      [SELF, 'Alligators brand'],
      [STUDIO, 'Studio site'],
      [FOLIO, 'portfolio'],
      [`l${'f'.repeat(16)}`, ''],
    ]) {
      const sq = projectSquare(pid, name);
      const home = ProjectSquare({ id: pid, name }) as {
        props: { className: string; children: string };
      };
      expect(home.props.className).toContain(`home-sq--${sq.tone}`);
      expect(home.props.children).toBe(sq.initial);
    }
  });
});

describe('the shell calls — ids only', () => {
  test('searchProjects asks index_search; nothing typed, no shell or a refusal is no answer', async () => {
    const calls: [string, unknown][] = [];
    const invoke = async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      return ACROSS;
    };
    expect(await searchProjects('mobil', { invoke })).toEqual(ACROSS);
    expect(calls).toEqual([['index_search', { q: 'mobil', limit: 50 }]]);
    expect(await searchProjects('  ', { invoke })).toBeNull();
    expect(await searchProjects('mobil', {})).toBeNull();
    expect(
      await searchProjects('mobil', {
        invoke: async () => {
          throw new Error('That result isn’t one this tab can open.');
        },
      })
    ).toBeNull();
    const ctl = new AbortController();
    ctl.abort();
    expect(
      await searchProjects('mobil', { invoke, signal: ctl.signal }),
      'a stale keystroke'
    ).toBeNull();
  });

  test('openSearchResult names a project id, a canvas rel and an artboard id — never a path or a URL', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const invoke = async (cmd: string, args: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return { label: `p-${STUDIO}`, opened: 'existing' };
    };
    const [canvas, board] = projectGroups(ACROSS, { query: 'mobil' })[0].rows;
    await openSearchResult(board, { invoke });
    await openSearchResult(canvas, { invoke });
    expect(calls).toEqual([
      ['open_search_result', { pid: STUDIO, canvas: 'ui/Homepage.tsx', artboard: 'mobile' }],
      ['open_search_result', { pid: STUDIO, canvas: 'ui/Mobile-detail.tsx', artboard: null }],
    ]);
    // this tab's own rows are not the shell's to open
    expect(await openSearchResult(OWN[0], { invoke })).toBeNull();
    expect(calls.length).toBe(2);
  });

  test('desktopProjectsEnv: the desktop app binds both calls and this tab’s pid; a browser tab binds nothing', async () => {
    expect(desktopProjectsEnv({ win: {} as never })).toEqual({});
    const calls: string[] = [];
    const win = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string) => {
            calls.push(cmd);
            return { groups: [] };
          },
        },
      },
      __TAURI_INTERNALS__: { metadata: { currentWebview: { label: `p-${SELF}` } } },
    };
    const env = desktopProjectsEnv({ win: win as never, projectName: 'Alligators brand' });
    expect(env.ownProject).toEqual({ pid: SELF, name: 'Alligators brand' });
    await env.searchProjects?.('mobil');
    expect(calls).toEqual(['index_search']);
    expect(ownPidOf('home')).toBeNull();
    expect(ownPidOf(`p-${SELF}`)).toBe(SELF);
  });
});

describe('shell parity — the browser tab says why it has no other projects', () => {
  test('desktop: ⌘K reaches the other projects; every other shell with chrome says it cannot', () => {
    expect(acrossProjects({ native: true }).present).toBe(true);
    expect(parityFor('desktop').parts['window-tabs'].search).toEqual(
      acrossProjects({ native: true })
    );
    for (const id of ['browser', 'cloud-owner', 'cloud-member', 'cloud-viewer', 'viewer']) {
      const s = parityFor(id).parts['window-tabs'].search;
      expect(s?.present, id).toBe(false);
      expect(s?.why, id).toContain('⌘K searches this project only');
    }
  });
});
