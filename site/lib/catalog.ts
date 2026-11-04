import stats from './stats.json';

/** The Advanced door's four install lines (the terminal route under the Mac app). */
export const CATALOG = [
  {
    slug: 'design',
    summary: 'Canvases, critics and the dev server, in Claude Code.',
    install: '/plugin install design@maude',
    docs: '/docs/design',
    detail: `${stats.plugins.design.commands} commands · ${stats.plugins.design.agents} critics`,
  },
  {
    slug: 'flow',
    summary: 'Plan, build and ship the whole feature.',
    install: '/plugin install flow@maude',
    docs: '/docs/flow',
    detail: `${stats.plugins.flow.commands} commands · ${stats.plugins.flow.agents} agents`,
  },
  {
    slug: 'CLI',
    summary: 'Scaffold, configure and run Maude from a shell.',
    install: 'npm i -g @1agh/maude',
    docs: '/docs/cli',
    detail: `${stats.plugins.maude.subcommands} subcommands`,
  },
  {
    slug: 'Self-hosted hub',
    summary: "Your team's server, on your own box.",
    install: 'maude hub workspace-up',
    docs: '/docs/hub',
    detail: 'Docker or Fly',
  },
] as const;
