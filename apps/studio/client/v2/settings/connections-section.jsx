// client/v2/settings/connections-section.jsx — S11.14: Settings › Connections (06 ad-edge-hub; D12, D14).
// 2.1.1 T6 (canvas 17 · 10): one column of cards, only the person's own integrations —
//
//   ✦  AI — your Claude account     Pro or Max, or an API key.     ● Connected        [Change…]  ›
//   ▢  Figma                        For Import from Figma.         ● Not connected    [Add token…] ›
//   ⌁  GitHub                       GitHub projects and invites…   ● Connected as @…  [Disconnect] ›
//   ▣  AI images, video and voice   Your own keys for pictures…    ● 2 keys · …       [Manage…]  ›
//   Which account a project uses, and where it lives, is in General › This project.
//
// Claude, Figma, GitHub and the AI providers follow the person into every project. Maude Cloud and your
// team's own server belong to a project, so they moved to General › This project (this-project-card.jsx):
// the cloud account and its projects on this Mac (D11), the server's address, masked token and Replace…
// (D12), its Sign out. Every card runs on the hooks in use-connections.js; the mono words live only under
// a card's own Advanced fold (`connections.<row>`).
//
// Desktop only (`cloud === null`): a browser tab has no keychain, and the routes behind these rows are
// refused in a cell by design (DDR-209 D1). The sheet doesn't render this section there.

import { useState } from 'react';

import { openExternal } from '../../panels/CloudBar.jsx';
import { GitHubDeviceDialog } from '../../panels/IdentityBar.jsx';
import { ProviderCard } from '../../panels/SettingsPanel.jsx';
import { ConnectSheet } from '../ai/ConnectSheet.jsx';
import { reasonProps } from '../access/disabled-reason.js';
import { AgentsCard } from './agents-card.jsx';
import { ConnField } from './connection-row.jsx';
import {
  claudeRow,
  connectionFoldId,
  figmaRow,
  figmaTestWords,
  githubRow,
  providerSummary,
} from './connections-model.js';
import { SettingsCard } from './settings-card.jsx';
import {
  useClaudeAccount,
  useFigmaConnection,
  useGitHubConnection,
  useProviderKeys,
} from './use-connections.js';
import { useOpenCard } from './use-open-card.js';

const btn = 'btn btn--sm';
const swOf = (tone) => (tone === 'ok' ? 'ok' : 'off');

export function FigmaToken({ f }) {
  const [value, setValue] = useState('');
  const configured = !!f.status?.configured;
  const save = async () => {
    await f.save(value);
    // Cleared at once — the value is never read back, so leaving it on screen only risks a shoulder-surf.
    setValue('');
  };
  return (
    <>
      <p className="v2s-hint">
        A personal access token with the{' '}
        <code>{f.status?.requiredScope || 'file_content:read'}</code> scope. Kept on this Mac only
        and never sent anywhere but Figma.
      </p>
      {f.status?.tokenUrl ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => openExternal(f.status.tokenUrl)}
        >
          Get a token ↗
        </button>
      ) : null}
      <span className="v2s-conn-replace">
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={configured ? '•••••••• stored' : 'figd_…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          aria-label="Figma personal access token"
          data-testid="figma-connect-input"
        />
        <button
          type="button"
          className={btn}
          disabled={f.busy || !value.trim()}
          {...reasonProps(f.busy || !value.trim(), f.busy ? 'Saving…' : 'Paste the token first.')}
          onClick={save}
          data-testid="figma-connect-save"
        >
          {configured ? 'Replace' : 'Save'}
        </button>
      </span>
    </>
  );
}

export default function ConnectionsSection({ focus = null }) {
  const gh = useGitHubConnection();
  const keys = useProviderKeys();
  const figma = useFigmaConnection();
  const claude = useClaudeAccount();
  const { open, toggle, show } = useOpenCard('connections', focus);
  const [connecting, setConnecting] = useState(false);

  const gr = githubRow({ native: gh.native, state: gh.state, login: gh.login });
  const cl = claudeRow(claude.state);
  const fr = figmaRow(figma.status);
  const tested = figmaTestWords(figma.test);
  const card = (id) => ({ open: open === id, onToggle: toggle, reveal: focus?.card === id });

  return (
    <div className="v2s-cards" data-testid="settings-connections">
      <SettingsCard
        id="claude"
        summaryTestid="settings-conn-claude-status"
        testid="settings-claude"
        icon="sparkle"
        title="AI — your Claude account"
        desc="Pro or Max, or an API key."
        summary={cl.status}
        sw={swOf(cl.tone)}
        action={
          cl.action ? (
            <button
              type="button"
              className={btn}
              aria-expanded={connecting}
              aria-controls="v2s-claude-connect"
              onClick={() => {
                setConnecting((v) => !v);
                show('claude');
              }}
              data-testid="settings-claude-action"
            >
              {cl.action === 'change' ? 'Change…' : 'Connect…'}
            </button>
          ) : null
        }
        {...card('claude')}
      >
        <p className="v2s-hint">
          Maude’s AI runs on this account. Sign in through your browser; Claude Code is set up for
          you.
        </p>
        {connecting ? (
          <div id="v2s-claude-connect" className="v2s-conn-keys">
            <ConnectSheet
              inline
              phase={claude.phase}
              error={claude.error}
              title={
                cl.action === 'change'
                  ? 'Change your Claude account?'
                  : 'Connect your Claude account?'
              }
              lead="Sign in through your browser. Claude Code is set up for you."
              fine={null}
              onConnect={async () => {
                const ok = await claude.connect({ force: cl.action === 'change' });
                if (ok) setConnecting(false);
              }}
              onCancel={() => {
                claude.cancel();
                claude.setError('');
                setConnecting(false);
              }}
            />
          </div>
        ) : null}
      </SettingsCard>

      {/* Universal ACP B6 (Design Decision 2): the other AI agents on this Mac — absent with Claude only */}
      <AgentsCard card={card} />

      <SettingsCard
        id="figma"
        summaryTestid="settings-conn-figma-status"
        testid="figma-connect-card"
        icon="vector"
        title="Figma"
        desc="For Import from Figma."
        summary={fr.status}
        sw={swOf(fr.tone)}
        action={
          fr.configured ? (
            <>
              <button
                type="button"
                className={btn}
                disabled={figma.busy}
                onClick={() => {
                  show('figma');
                  figma.runTest();
                }}
                data-testid="figma-test"
              >
                Test
              </button>
              <button
                type="button"
                className={btn}
                disabled={figma.busy}
                onClick={figma.disconnect}
                data-testid="figma-disconnect"
              >
                Disconnect
              </button>
            </>
          ) : figma.status ? (
            <button
              type="button"
              className={btn}
              aria-expanded={open === 'figma'}
              aria-controls="v2s-figma-token"
              onClick={() => toggle('figma')}
              data-testid="figma-add-token"
            >
              Add token…
            </button>
          ) : null
        }
        fold={
          fr.configured
            ? { panel: connectionFoldId('figma'), body: <FigmaToken f={figma} /> }
            : undefined
        }
        {...card('figma')}
      >
        {!fr.configured && figma.status ? (
          <div id="v2s-figma-token" className="v2s-conn-keys">
            <FigmaToken f={figma} />
          </div>
        ) : null}
        {tested ? (
          <p
            className={tested.ok ? 'v2s-hint' : 'v2s-conn-err'}
            role="status"
            data-testid={tested.ok ? 'figma-connected-as' : 'figma-connect-error'}
          >
            {tested.text}
          </p>
        ) : null}
        {figma.error ? (
          <p className="v2s-conn-err" role="alert" data-testid="figma-connect-error">
            {figma.error}
          </p>
        ) : null}
      </SettingsCard>

      <SettingsCard
        id="github"
        summaryTestid="settings-conn-github-status"
        testid="settings-github"
        icon="link"
        title="GitHub"
        desc="GitHub projects and invites by username."
        summary={gr.status}
        sw={swOf(gr.tone)}
        action={
          gr.action === 'connect' ? (
            <button
              type="button"
              className={btn}
              onClick={gh.signIn}
              disabled={gh.signing}
              data-testid="settings-github-signin"
            >
              {gh.signing ? 'Starting…' : 'Connect'}
            </button>
          ) : gr.action === 'disconnect' ? (
            <button
              type="button"
              className={btn}
              onClick={gh.signOut}
              data-testid="settings-github-signout"
            >
              Disconnect
            </button>
          ) : null
        }
        fold={
          gh.native
            ? {
                panel: connectionFoldId('github'),
                body: (
                  <>
                    {gh.login ? (
                      <ConnField k="Signed in as" mono>
                        @{gh.login}
                      </ConnField>
                    ) : null}
                    <ConnField k="Token">Kept in this Mac’s keychain — never shown</ConnField>
                  </>
                ),
              }
            : undefined
        }
        {...card('github')}
      >
        {gh.error ? (
          <p className="v2s-conn-err" role="alert">
            {gh.error}
          </p>
        ) : null}
      </SettingsCard>

      <SettingsCard
        id="ai"
        summaryTestid="settings-conn-ai-status"
        testid="settings-ai-keys"
        icon="image"
        title="AI images, video and voice"
        desc="Your own keys for pictures, video and voice."
        summary={providerSummary(keys.providers)}
        sw={
          Array.isArray(keys.providers) && keys.providers.some((p) => p?.configured) ? 'ok' : 'off'
        }
        action={
          <button
            type="button"
            className={btn}
            aria-expanded={open === 'ai'}
            aria-controls="v2s-ai-keys"
            onClick={() => toggle('ai')}
            data-testid="settings-ai-keys-toggle"
          >
            {open === 'ai' ? 'Hide' : 'Manage…'}
          </button>
        }
        fold={{
          panel: connectionFoldId('ai'),
          body: (
            <ConnField k="Where the keys are">
              On this Mac only — never sent anywhere but the provider, never shown to a canvas.
            </ConnField>
          ),
        }}
        {...card('ai')}
      >
        <div id="v2s-ai-keys" className="v2s-conn-keys">
          {keys.error ? <p className="v2s-conn-err">{keys.error}</p> : null}
          {(keys.providers ?? []).map((p) => (
            <ProviderCard key={p.id} provider={p} onChanged={keys.reload} />
          ))}
        </div>
      </SettingsCard>

      <p className="v2s-hint v2s-cards-foot" data-testid="settings-connections-foot">
        Which account a project uses, and where it lives, is in General › This project.
      </p>

      {gh.device ? <GitHubDeviceDialog device={gh.device} onClose={gh.closeDevice} /> : null}
    </div>
  );
}
