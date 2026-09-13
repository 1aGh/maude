import { Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/ui/tabs';
import Link from 'next/link';
import { CopyButton } from './copy-button';

const HOSTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    install: `npm i -g @1agh/maude
claude plugin marketplace add 1aGh/maude
claude plugin install flow@maude
claude plugin install design@maude`,
    init: `/flow:init
/design:init`,
    guide: '/docs/getting-started',
  },
  {
    id: 'codex',
    label: 'Codex',
    install: `npm i -g @1agh/maude
codex plugin marketplace add 1aGh/maude
codex plugin add flow@maude
codex plugin add design@maude`,
    init: `$flow:source-command-init
$design:source-command-init`,
    guide: '/docs/codex',
  },
];

export function QuickStart() {
  return (
    <section className="mdcc-install" aria-label="Quick start">
      <div className="mdcc-install-head">
        <strong>Quick start</strong>
      </div>
      <Tabs defaultValue="claude">
        <TabsList className="mdcc-install-tabs" aria-label="Choose your coding agent">
          {HOSTS.map((host) => (
            <TabsTrigger key={host.id} value={host.id} className="mdcc-install-tab">
              {host.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {HOSTS.map((host) => (
          <TabsContent key={host.id} value={host.id} className="mdcc-install-panel">
            <div className="mdcc-install-head">
              <span>1. In your terminal</span>
              <CopyButton
                text={host.install}
                ariaLabel={`Copy ${host.label} installation commands`}
              />
            </div>
            <pre>
              <code>{host.install}</code>
            </pre>
            <p className="mdcc-install-note">
              Then open a fresh {host.label} session in your project.
            </p>
            <div className="mdcc-install-head">
              <span>2. Inside {host.label}</span>
              <CopyButton text={host.init} ariaLabel={`Copy ${host.label} workspace commands`} />
            </div>
            <pre>
              <code>{host.init}</code>
            </pre>
            <p className="mdcc-install-note">
              {host.id === 'codex' && (
                <>
                  The GitHub install requires the native plugin update to be published. Until then,
                  use the local checkout steps in the guide.{' '}
                </>
              )}
              <Link href={host.guide}>Full {host.label} setup →</Link>
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
