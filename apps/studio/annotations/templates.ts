/**
 * @file       annotations/templates.ts — the eight whiteboard templates (S4.4)
 * @scope      apps/studio/annotations/templates.ts
 * @purpose    ONE list behind every way to start a board from a template: the Templates panel
 *             (client/v2/annotations/templates-panel.jsx, the pick goes down as dgn `insert-template`),
 *             the ⌘K "Templates" rows (registry `annotations.template`), and the agent verb
 *             `maude design annotate <canvas> --board <template-id>`. They all expand the SAME
 *             `board` spec through the same layout engine, so the elements a person gets from the
 *             panel and the ones an agent writes from the verb are identical (rule 14).
 *
 * Pure data, no imports: the shell bundle, Bun and Node can all load it. The `board` value has the
 * shape `annotate --board` takes (`{ title?, layout?, groups?, nodes?, edges? }`); a template never
 * carries colours, so every sticky and section starts from the model defaults and the person (or AI)
 * colours what matters.
 *
 * Words are CONTRACT §3–§4 and canvas 15 (artboard 11): the tile title and its one-line description.
 * The ids are API — the verb accepts them and the registry derives its rows from them; append only.
 */

export interface BoardTemplate {
  /** `--board <id>`, `annotations.template.<id>`, the `insert-template` message's `id`, the panel's testid suffix. */
  id: string;
  /** The tile title. */
  title: string;
  /** The tile's one-line description. */
  desc: string;
  /** Which thumbnail the panel draws (canvas 15 `.an-tpl-th--<thumb>`). */
  thumb: 'kanban' | 'retro' | 'flow' | 'cal' | 'road' | 'brain' | 'check' | 'blank';
  /** The `annotate --board` spec this template expands to. */
  board: BoardSpec;
}

/** The part of the `--board` JSON the templates use (the verb accepts more; see `annotate --help`). */
export interface BoardSpec {
  title?: string;
  layout?: 'columns' | 'radial' | 'flow';
  groups?: { title: string; cards?: string[] }[];
  nodes?: { id: string; label: string; shape?: string }[];
  edges?: { from: string; to: string; label?: string }[];
}

const cards = (...text: string[]) => text;

export const TEMPLATES: readonly BoardTemplate[] = Object.freeze([
  {
    id: 'kanban',
    title: 'Kanban',
    desc: 'To do · Doing · Done',
    thumb: 'kanban',
    board: {
      groups: [
        { title: 'To do', cards: cards('', '') },
        { title: 'Doing', cards: cards('') },
        { title: 'Done', cards: cards('') },
      ],
    },
  },
  {
    id: 'retro',
    title: 'Retro',
    desc: 'Went well · To improve · Actions',
    thumb: 'retro',
    board: {
      groups: [
        { title: 'Went well', cards: cards('', '') },
        { title: 'To improve', cards: cards('', '') },
        { title: 'Actions', cards: cards('') },
      ],
    },
  },
  {
    id: 'flow',
    title: 'Flowchart',
    desc: 'Steps and decisions',
    thumb: 'flow',
    board: {
      layout: 'flow',
      nodes: [
        { id: 'start', label: 'Start' },
        { id: 'decide', label: 'Decision?', shape: 'diamond' },
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      edges: [
        { from: 'start', to: 'decide' },
        { from: 'decide', to: 'yes', label: 'Yes' },
        { from: 'decide', to: 'no', label: 'No' },
      ],
    },
  },
  {
    id: 'calendar',
    title: 'Content calendar',
    desc: 'One column a day',
    thumb: 'cal',
    board: {
      groups: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((title) => ({
        title,
        cards: cards(''),
      })),
    },
  },
  {
    id: 'roadmap',
    title: 'Roadmap',
    desc: 'One column a month',
    thumb: 'road',
    board: {
      groups: [
        { title: 'This month', cards: cards('', '') },
        { title: 'Next month', cards: cards('', '') },
        { title: 'The month after', cards: cards('') },
      ],
    },
  },
  {
    id: 'brainstorm',
    title: 'Brainstorm',
    desc: 'A topic and ideas round it',
    thumb: 'brain',
    board: {
      title: 'Topic',
      layout: 'radial',
      groups: [{ title: 'Ideas', cards: cards('', '', '', '', '', '') }],
    },
  },
  {
    id: 'checklist',
    title: 'Checklist',
    desc: 'One section, ticks',
    thumb: 'check',
    board: {
      groups: [{ title: 'Checklist', cards: cards('☐', '☐', '☐', '☐') }],
    },
  },
  {
    id: 'blank',
    title: 'Blank section',
    desc: 'Draw it, name it',
    thumb: 'blank',
    board: { groups: [{ title: 'Section' }] },
  },
]);

/** The template with this id, or null. */
export function findTemplate(id: unknown): BoardTemplate | null {
  return typeof id === 'string' ? (TEMPLATES.find((t) => t.id === id) ?? null) : null;
}

/** A fresh, mutable copy of the template's `--board` spec (the layout engine may not touch the shared one). */
export function templateBoard(id: string): BoardSpec | null {
  const t = findTemplate(id);
  return t ? (JSON.parse(JSON.stringify(t.board)) as BoardSpec) : null;
}
