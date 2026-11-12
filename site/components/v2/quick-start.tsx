'use client';

// The terminal quick start: the Maude CLI + the design plugin in your own coding agent.
// Restored from the v1 homepage card (components/mdcc/quick-start.tsx, dropped with the v2
// redesign) into the v2 look. Commands verified against the published marketplace on
// 2026-11-12 (Claude Code + Codex 0.154, plugins 2.2.1).
import Link from 'next/link';
import { useId, useState } from 'react';
import { CopyButton } from '@/components/mdcc/copy-button';
import '@/app/site-v2.css';

type Host = {
  id: 'claude' | 'codex';
  label: string;
  install: string;
  flow: string;
  init: string;
  guide: string;
};

export const QUICK_START_HOSTS: Host[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    install: `npm i -g @1agh/maude
claude plugin marketplace add 1aGh/maude
claude plugin install design@maude`,
    flow: 'claude plugin install flow@maude',
    init: '/design:init',
    guide: '/docs/design',
  },
  {
    id: 'codex',
    label: 'Codex',
    install: `npm i -g @1agh/maude
codex plugin marketplace add 1aGh/maude
codex plugin add design@maude`,
    flow: 'codex plugin add flow@maude',
    init: '$design:source-command-init',
    guide: '/docs/codex',
  },
];

function Block({ label, text, copyLabel }: { label: string; text: string; copyLabel: string }) {
  return (
    <div className="ps-qs-block">
      <div className="ps-qs-head">
        <span className="ps-small">{label}</span>
        <CopyButton text={text} className="ps-qs-copy" ariaLabel={copyLabel}>
          Copy
        </CopyButton>
      </div>
      <pre className="ps-qs-pre">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function QuickStart({ heading = true }: { heading?: boolean }) {
  const [active, setActive] = useState<Host['id']>('claude');
  const base = useId();
  const host = QUICK_START_HOSTS.find((h) => h.id === active) ?? QUICK_START_HOSTS[0];

  return (
    <section className="ps-qs" aria-label="Terminal quick start" data-testid="site-quick-start">
      {heading ? <strong className="ps-qs-title">Quick start in your own agent</strong> : null}
      <div className="ps-qs-tabs" role="tablist" aria-label="Choose your coding agent">
        {QUICK_START_HOSTS.map((h) => (
          <button
            key={h.id}
            type="button"
            role="tab"
            id={`${base}-tab-${h.id}`}
            aria-controls={`${base}-panel-${h.id}`}
            aria-selected={active === h.id}
            tabIndex={active === h.id ? 0 : -1}
            className="ps-qs-tab"
            data-testid={`site-quick-start-tab-${h.id}`}
            onClick={() => setActive(h.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = QUICK_START_HOSTS.findIndex((x) => x.id === active);
              const n = QUICK_START_HOSTS.length;
              const next = QUICK_START_HOSTS[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
              setActive(next.id);
              document.getElementById(`${base}-tab-${next.id}`)?.focus();
            }}
          >
            {h.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${host.id}`}
        aria-labelledby={`${base}-tab-${host.id}`}
        className="ps-qs-panel"
      >
        <Block
          label="1. In your terminal: the CLI and the design plugin"
          text={host.install}
          copyLabel={`Copy the ${host.label} install commands`}
        />
        <Block
          label="2. In a fresh session, inside your project"
          text={host.init}
          copyLabel={`Copy the ${host.label} init command`}
        />
        <p className="ps-small">
          Want the plan-to-ship loop too? Add <code className="ps-mono">{host.flow}</code>. Design
          uses its question and memory skills, so it is worth having.{' '}
          <Link href={host.guide}>Full {host.label} setup →</Link>
        </p>
      </div>
    </section>
  );
}

/** The same card inside a docs page: docs pages are outside the `.v2-site` scope. */
export function DocsQuickStart() {
  return (
    <div className="v2-site not-prose">
      <QuickStart heading={false} />
    </div>
  );
}
