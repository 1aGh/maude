// Ported once from .design/ui/Public Site v2.tsx (DocsPage) on 2026-11-04; site/ is the source now.
// Two doors at the top of /docs: Using Maude (the app) and Advanced (Claude Code, the CLI,
// self-hosting). The same docs tree, split at the one seam it already has. Every page stays.
import Link from 'next/link';
import '@/app/site-v2.css';
import { Icon } from './kit/glyphs';
import { major, newest } from './released';

const USING: [title: string, href: string, note?: string][] = [
  ['Getting started', '/docs/getting-started', '5 min'],
  ['The Mac app', '/docs/desktop'],
  ['Share links and inviting', '/docs/share-links'],
  ['Maude Cloud', '/docs/cloud/trust'],
  ['Moving from Maude 1', '/docs/moving-from-1'],
];

type Item = [title: string, href: string];
const ADVANCED: { group: string; shown: Item[]; more?: Item[] }[] = [
  {
    group: 'Explore',
    shown: [
      ['Use Maude from your agent', '/docs/use-from-your-agent'],
      ['The design plugin', '/docs/design'],
      ['The flow plugin', '/docs/flow'],
      ['The maude CLI', '/docs/cli'],
      ['Self-hosted hub', '/docs/hub'],
      ['Flow migration', '/docs/flow-migration'],
    ],
    more: [
      ['Orchestration', '/docs/orchestration'],
      ['Codex', '/docs/codex'],
      ['Config', '/docs/config'],
      ['Security', '/docs/security'],
    ],
  },
  {
    group: 'Look up',
    shown: [
      ['Design commands', '/docs/commands-design/help'],
      ['Flow commands', '/docs/commands-flow/plan'],
      ['Config schema', '/docs/config-schema'],
      ['Design system schema', '/docs/design-system-schema'],
    ],
  },
  {
    group: 'Recipes',
    shown: [
      ['Next.js', '/docs/recipes/nextjs'],
      ['Expo', '/docs/recipes/expo'],
      ['pnpm monorepo', '/docs/recipes/monorepo'],
    ],
  },
];

const START: [icon: string, title: string, body: string, href: string][] = [
  ['frame', 'Make your first canvas', 'Ask AI for a draft, or draw it.', '/docs/getting-started'],
  ['people', 'Invite your team', 'One Share button, three roles.', '/docs/share-links'],
  ['system', 'Bring your design system', 'Colours, type, components.', '/docs/design/bootstrap'],
  ['export', 'Export anything', 'PNG, PDF, video, or code.', '/docs/commands-design/export'],
];

export function DocsDoors() {
  return (
    <div className="v2-site not-prose">
      <div className="ps-doors">
        <div className="ps-grid-2">
          <article className="ps-card ps-door" aria-labelledby="h-door-using">
            <div className="ps-row">
              <span className="ps-ico">
                <Icon name="home" size={18} />
              </span>
              <div>
                <h2 id="h-door-using" className="ps-h3">
                  Using Maude
                </h2>
                <p className="ps-door-for">For designers and teams. No terminal needed.</p>
                <p className="ps-door-mode">Tutorials and how-to guides</p>
              </div>
            </div>
            <div className="ps-door-list">
              {USING.map(([t, href, note]) => (
                <Link key={t} className="ps-door-link" href={href}>
                  {t}
                  {note ? <span className="ps-small">{note}</span> : null}
                  <span
                    className="ps-small"
                    style={{ marginLeft: note ? 'var(--space-2)' : 'auto' }}
                    aria-hidden="true"
                  >
                    <Icon name="submenu" size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </article>

          <article
            id="advanced"
            className="ps-card ps-door ps-door--adv"
            aria-labelledby="h-door-adv"
          >
            <div className="ps-row">
              <span className="ps-ico ps-ico--plain">
                <Icon name="terminal" size={18} />
              </span>
              <div>
                <h2 id="h-door-adv" className="ps-h3">
                  Advanced
                </h2>
                <p className="ps-door-for">
                  For Claude Code, Codex, the command line and self-hosting.
                </p>
                <p className="ps-door-mode">
                  Reference, explanations and recipes · every page kept
                </p>
              </div>
            </div>
            <div className="ps-door-cols">
              {ADVANCED.map(({ group, shown, more }) => (
                <div key={group} className="ps-door-list">
                  <span className="ps-door-group">{group}</span>
                  {shown.map(([t, href]) => (
                    <Link key={t} className="ps-door-link" href={href}>
                      {t}
                    </Link>
                  ))}
                  {more ? (
                    <span className="ps-door-more">
                      More:{' '}
                      {more.map(([t, href], i) => (
                        <span key={t}>
                          {i ? ', ' : ''}
                          <Link href={href}>{t}</Link>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </div>

        <h2 id="h-pop" className="ps-h3 ps-doors-h">
          People start here
        </h2>
        <div className="ps-grid-4">
          {START.map(([icon, t, d, href]) => (
            <Link key={t} className="ps-card" href={href}>
              <span className="ps-ico">
                <Icon name={icon} size={16} />
              </span>
              <b>{t}</b>
              <span className="ps-small">{d}</span>
            </Link>
          ))}
        </div>

        <div className="ps-card ps-card--flat ps-release">
          <span className="chip chip--accent">New</span>
          <span className="ps-body">
            <b>Maude {major}</b> · {newest.title}
          </span>
          <Link className="btn btn--sm btn--ghost" href="/changelog">
            Read the changelog
          </Link>
        </div>
      </div>
    </div>
  );
}
