import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoVideo } from '@/components/mdcc/demo-video';
import { DownloadNative } from '@/components/mdcc/download-native';
import { QuickStart } from '@/components/mdcc/quick-start';
import { SkuLabel } from '@/components/mdcc/sku-label';
import stats from '@/lib/stats.json';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const CATALOG = [
  {
    sku: 'MDCC-DSN/01',
    slug: 'design',
    title: 'Iterates canvases until they stop being embarrassing.',
    description:
      'Canvas-first iteration on HTML/JSX mocks. Zero-dep Node dev-server. Cmd+Click element inspector. Snapshot stack per canvas.',
    tags: [
      `commands · ${stats.plugins.design.commands}`,
      `skills · ${stats.plugins.design.skills}`,
      `critics · ${stats.plugins.design.agents}`,
    ],
    install: '/plugin install design@maude',
    docs: '/docs/design',
  },
  {
    sku: 'MDCC-FLW/02',
    slug: 'flow',
    title: 'The agentic loop that ships things eventually.',
    description:
      'Plan, execute, done, validate. Second-brain .ai/ workspace. Project-agnostic via per-repo workflows.config.json. Same plugin runs in Next.js, Expo, Go, anything.',
    tags: [
      `commands · ${stats.plugins.flow.commands}`,
      `skills · ${stats.plugins.flow.skills}`,
      `agents · ${stats.plugins.flow.agents}`,
    ],
    install: '/plugin install flow@maude',
    docs: '/docs/flow',
  },
  {
    sku: 'MDCC-CLI/03',
    slug: 'maude',
    title: 'The plumbing the other two pretend not to need.',
    description:
      'Scaffolds the .ai/ workspace. Reads and writes config. Boots the design dev server. Pure ESM, zero runtime deps beyond Node 20+.',
    tags: [
      `subcommands · ${stats.plugins.maude.subcommands}`,
      `node ${stats.nodeRange.replace('>=', '≥ ')}`,
      'zero deps',
    ],
    install: 'npm i -g @1agh/maude',
    docs: '/docs/cli',
  },
  {
    sku: 'MDCC-HUB/04',
    slug: 'hub',
    title: 'Mirrors your canvases across the team. No SaaS tier.',
    description:
      'Optional self-hosted Yjs sync hub — mirror .design/ across collaborators in real time. Docker or Fly, on your infra, no cloud middleman.',
    tags: ['yjs', 'self-host', 'docker / fly'],
    install: 'maude hub serve',
    docs: '/docs/hub',
  },
];

export default function HomePage() {
  return (
    <main className="mdcc-landing" id="main-content">
      <section className="mdcc-hero" aria-labelledby="land-h1">
        <div className="mdcc-hero-copy">
          <div className="mdcc-hero-sku">
            <SkuLabel>MDCC-MKT/00</SkuLabel>
            <span aria-hidden="true">·</span>
            <span>THE CATALOG</span>
            <span aria-hidden="true">·</span>
            <span>{stats.version}</span>
            <span aria-hidden="true">·</span>
            <span>PUBLISHED {stats.publishedDate}</span>
          </div>
          <h1 id="land-h1">
            The design tool that finally stops{' '}
            <span style={{ color: 'var(--accent)' }}>fighting the AI</span>.
          </h1>
          <div className="mdcc-hero-sku" style={{ marginTop: 0, marginBottom: 'var(--space-3)' }}>
            (maude, how it works mostly.)
          </div>
          <p className="mdcc-hero-punchline">
            Real files. Real git. Real tokens. Nothing here pretends Claude Code doesn&apos;t exist.
            That&apos;s why it just works.
          </p>
          <p>
            <code>design</code> iterates on HTML mocks. <code>flow</code> runs the agentic loop
            until the feature actually ships. <code>maude</code> scaffolds the second-brain{' '}
            <code>.ai/</code> workspace they both pretend they could live without.
          </p>
          <p className="mdcc-hero-fineprint">
            Open-source. Catalog-graded. No telemetry, no signup, no{' '}
            <em className="mdcc-strike">book a demo</em> button. If it crashes,{' '}
            <code>git pull</code> and try again. That&apos;s the entire support contract.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <Link href="/docs" className="mdcc-cta-primary">
              Read the docs.
            </Link>
            <a
              href="https://www.buymeacoffee.com/mdovrtelm"
              target="_blank"
              rel="noopener noreferrer"
              className="mdcc-cta-ghost"
            >
              <span aria-hidden="true">▸</span> Buy me a coffee
            </a>
            <a href="#intro" className="mdcc-watch">
              <span className="mdcc-watch-play" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M3 2.2v6.6l5.5-3.3z" fill="currentColor" />
                </svg>
              </span>
              Watch the intro <span className="mdcc-watch-dur">0:38</span>
            </a>
          </div>
          <p className="mdcc-hero-fineprint">Or skip the terminal — get the native desktop app:</p>
          <DownloadNative />
        </div>

        <QuickStart />
      </section>

      <section aria-labelledby="why-h">
        <div className="mdcc-section-head">
          <h2 id="why-h">Why not just Figma? Why not just Claude Design?</h2>
          <span className="mdcc-eyebrow">the short version</span>
        </div>
        <div className="mdcc-cat-grid">
          <div className="mdcc-cat-card" style={{ cursor: 'default' }}>
            <h3>Figma</h3>
            <p>
              A human-first design tool with an AI panel bolted onto the side. The AI is a guest in
              someone else&apos;s house.
            </p>
          </div>
          <div className="mdcc-cat-card" style={{ cursor: 'default' }}>
            <h3>Claude Design</h3>
            <p>
              A chat box that forgets everything by morning. No git, no files, no design system to
              check new work against.
            </p>
          </div>
          <div className="mdcc-cat-card" style={{ cursor: 'default' }}>
            <h3>
              <code>maude</code>
            </h3>
            <p>
              Built around Claude Code from day one. Real <code>.tsx</code> files, real git history,
              a real dev server. That&apos;s the whole trick.
            </p>
          </div>
        </div>
        <p className="mdcc-hero-fineprint" style={{ marginTop: 'var(--space-4)' }}>
          And it&apos;s not just the canvas. <code>flow</code> runs the same repo-native loop for
          planning and shipping the whole feature, and the optional self-hosted hub brings the team
          into the same <code>.design/</code> in real time.
        </p>
      </section>

      {/* ── Feature spotlight: the latest big shipped feature. Curated, not
          generated — update this block each release. ── */}
      <section className="mdcc-spotlight" aria-labelledby="spot-h">
        <div className="mdcc-spotlight-tag">
          <SkuLabel>MDCC-NEW/05</SkuLabel>
          <span aria-hidden="true">·</span>
          <span>LATEST DROP</span>
          <span aria-hidden="true">·</span>
          <span>{stats.version}</span>
        </div>
        <h2 id="spot-h" className="mdcc-spotlight-title">
          The canvas <span style={{ color: 'var(--accent)' }}>talks back</span> now.
        </h2>
        <p className="mdcc-spotlight-lede">
          Cmd+Click an element and edit its CSS against your real design tokens — Figma-style scrub
          fields, a searchable Variables popover that shows where each token is defined, and one
          colour picker for fill and border alike. It writes straight back to the source{' '}
          <code>.tsx</code>. The AI sits this one out.
        </p>
        <div className="mdcc-spotlight-tags">
          <span>Figma-style token editor</span>
          <span>searchable Variables · provenance</span>
          <span>writes back to source</span>
        </div>
        <div className="mdcc-spotlight-ctas">
          <Link href="/changelog" className="mdcc-cta-primary">
            See what shipped
          </Link>
          <Link href="/docs/design" className="mdcc-cta-ghost">
            Read the design docs
          </Link>
        </div>
      </section>

      <div id="intro">
        <DemoVideo />
      </div>

      <section aria-labelledby="cat-h">
        <div className="mdcc-section-head">
          <h2 id="cat-h">The catalog.</h2>
          <span className="mdcc-eyebrow">
            two plugins · one CLI · one hub · {stats.version} ·{' '}
            <Link href="/changelog">what shipped -&gt;</Link>
          </span>
        </div>
        <div className="mdcc-cat-grid">
          {CATALOG.map((item) => (
            <Link key={item.sku} href={item.docs} className="mdcc-cat-card">
              <div className="mdcc-cat-card-head">
                <SkuLabel>
                  {item.sku} · {item.slug}
                </SkuLabel>
                <span className="text-xs" style={{ color: 'var(--fg-2)' }}>
                  {stats.version}
                </span>
              </div>
              <h3>
                <code>{item.slug}</code> {item.title}
              </h3>
              <p>{item.description}</p>
              <div
                className="flex flex-wrap gap-2"
                style={{ fontSize: 'var(--type-xs)', color: 'var(--fg-2)' }}
              >
                {item.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="mdcc-cat-card-foot">
                <span>read docs</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer>
        <div className="mdcc-maker-signature">
          <SkuLabel>MDCC-MKR/01 · MICHAL</SkuLabel>
          <p>
            Hi I&apos;m Michal, I made this. Open issues if it breaks.{' '}
            <Link href="/about">More.</Link>
          </p>
        </div>
        <dl className="mdcc-meta-footer">
          <div>
            <dt>Published</dt>
            <dd>{stats.publishedDate}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              <a href="https://github.com/1aGh/maude">github.com/1aGh/maude</a>
            </dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>MIT</dd>
          </div>
          <div>
            <dt>Contributors</dt>
            <dd>{stats.contributors}</dd>
          </div>
        </dl>
      </footer>
    </main>
  );
}
