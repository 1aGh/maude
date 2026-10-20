// client/v2/settings/connections-section.jsx — S11.14: Settings › Connections (06 ad-edge-hub; D11, D12, D14).
//
//   ☁  Maude Cloud                Signed in as You                        [Sign out]   › Advanced
//      Cloud projects on this Mac: Connect · Disconnect (D11)
//   ▣  Studio site — your team's own server   ● Connected · saved 1 min ago [Sign out] › Advanced
//         Address  https://hub.studio-brno.cz  [Copy]
//         Access token  •••• •••• a91f  [Replace…]
//         Hub version  maude-hub 2.0.0
//   ⌁  GitHub                     Not connected                           [Connect]    › Advanced
//   ✦  AI images, video and voice 2 keys · Gemini, ElevenLabs             [Manage]     › Advanced
//   ▢  Figma                      Connected · for imports          [Test] [Disconnect] › Advanced
//
// A self-hosted hub looks exactly like the cloud: the window says Saved like any cloud project, and
// the address and the token appear only under that connection's Advanced. Every row runs on the hooks
// in use-connections.js — the v1 rows (CloudBar / IdentityBar / FigmaConnectCard / ProviderKeys) are
// no longer mounted here. The token is never rendered beyond its last four characters, and Replace…
// writes through the existing credential route only.
//
// Desktop only (`cloud === null`): a browser tab has no keychain, and the routes behind these rows are
// refused in a cell by design (DDR-209 D1). The sheet doesn't render this section there.

import { useState } from 'react';

import {
  CloudDeviceDialog,
  isLinkedProjectRow,
  openExternal,
  shareViewUrl,
} from '../../panels/CloudBar.jsx';
import { GitHubDeviceDialog } from '../../panels/IdentityBar.jsx';
import { ProviderCard } from '../../panels/SettingsPanel.jsx';
import { TeamProjectsDialog } from '../../panels/TeamProjects.jsx';
import { ConnectionRow, ConnField } from './connection-row.jsx';
import {
  cloudRow,
  figmaRow,
  figmaTestWords,
  githubRow,
  hubRow,
  maskedToken,
  providerSummary,
} from './connections-model.js';
import {
  useCloudConnection,
  useFigmaConnection,
  useGitHubConnection,
  useHubDetails,
  useProviderKeys,
} from './use-connections.js';

const btn = 'btn btn--sm';

function CloudProjects({ c }) {
  const { projects, local, cloudUrl, busy } = c;
  if (projects === null)
    return (
      <div className="v2s-conn-li" aria-disabled="true">
        Loading projects…
      </div>
    );
  if (projects.length === 0)
    return (
      <div className="v2s-conn-li" aria-disabled="true">
        No projects yet — start one on the dashboard.
      </div>
    );
  return projects.map((p) => {
    const name = p.name || p.id;
    // Viewer dignity (Phase 17 T4): no dead Connect that would 403 at the workspace — viewing has a
    // first-class home in the browser, and the label says why.
    if (p.role === 'viewer')
      return (
        <div className="v2s-conn-li" key={p.id}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => openExternal(shareViewUrl(p.url, p.id))}
            title="Viewing works in the browser. Editing in the app needs the member role — ask whoever runs the project."
            data-testid={`cloud-project-${p.id}`}
          >
            {`View ${name} in the browser`}
          </button>
        </div>
      );
    const linked = isLinkedProjectRow({
      projectUrl: p.url,
      linkedHubUrl: local.linkedHub?.url,
      linkedHubCredentialed: local.linkedHub?.credentialed,
      cloudUrl,
    });
    return linked ? (
      <div className="v2s-conn-li is-connected" key={p.id} data-testid={`cloud-project-${p.id}`}>
        <span>{name}</span>
        <span className="v2s-conn-s v2s-conn-s--ok">Connected</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy === 'disconnect'}
          onClick={c.disconnect}
          aria-label={`Disconnect this folder from ${name}`}
          data-testid={`cloud-disconnect-${p.id}`}
        >
          {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
    ) : (
      <div className="v2s-conn-li" key={p.id}>
        <span>{name}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy === p.id}
          onClick={() => c.connect(p.id)}
          title={`Connect this folder to ${name}`}
          data-testid={`cloud-project-${p.id}`}
        >
          {busy === p.id ? 'Connecting…' : `Connect ${name}`}
        </button>
      </div>
    );
  });
}

/** Replace… — a password field, sent once through `POST /_api/hub/link`, then cleared. */
function ReplaceToken({ hub }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open)
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setOpen(true)}
        data-testid="settings-hub-token-replace"
      >
        Replace…
      </button>
    );
  const done = async () => {
    const ok = await hub.replace(value);
    setValue('');
    if (ok) setOpen(false);
  };
  return (
    <span className="v2s-conn-replace">
      <input
        className="input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder="Paste the new token"
        aria-label="New access token"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done();
          if (e.key === 'Escape') {
            setValue('');
            setOpen(false);
          }
        }}
        data-testid="settings-hub-token-input"
      />
      <button
        type="button"
        className={btn}
        disabled={hub.busy || !value.trim()}
        onClick={done}
        data-testid="settings-hub-token-save"
      >
        {hub.busy ? 'Saving…' : 'Replace'}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => {
          setValue('');
          setOpen(false);
        }}
      >
        Cancel
      </button>
    </span>
  );
}

/** The linked workspace's address + masked token — under the row the link belongs to. */
function HubFields({ url, hub, replace, credentialed }) {
  const d = hub.details;
  // Until the details answer, the link's own corroboration says whether a token is stored at all.
  const stored = d ? d.credentialed : !!credentialed;
  return (
    <div data-testid="settings-hub-address">
      <ConnField k="Address" mono copy={url}>
        {url}
      </ConnField>
      <ConnField k="Access token" mono testid="settings-hub-token">
        <span className="v2s-conn-inline">
          {stored ? maskedToken(d?.tokenLast4) : 'None saved for this folder'}
          {replace && stored ? <ReplaceToken hub={hub} /> : null}
        </span>
      </ConnField>
      {d?.version ? (
        <ConnField k="Hub version" mono testid="settings-hub-version">
          {d.version}
        </ConnField>
      ) : null}
      {hub.error ? (
        <p className="v2s-conn-err" role="alert">
          {hub.error}
        </p>
      ) : null}
    </div>
  );
}

function FigmaToken({ f }) {
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
          onClick={save}
          data-testid="figma-connect-save"
        >
          {configured ? 'Replace' : 'Save'}
        </button>
      </span>
    </>
  );
}

export default function ConnectionsSection({ onLinkedHub, onLocalProject, syncStatus }) {
  const cloud = useCloudConnection({ onLinkedHub, onLocalProject, syncStatus });
  const gh = useGitHubConnection();
  const keys = useProviderKeys();
  const figma = useFigmaConnection();
  const [teamOpen, setTeamOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);

  const linkedUrl = cloud.local.linkedHub?.url ?? null;
  const team = hubRow({
    linkedHub: cloud.local.linkedHub,
    cloudUrl: cloud.cloudUrl,
    project: cloud.local.project,
    lastSyncAt: syncStatus?.lastSyncAt,
  });
  const hub = useHubDetails(linkedUrl);
  const cr = cloudRow({ state: cloud.state, email: cloud.email });
  const gr = githubRow({ native: gh.native, state: gh.state, login: gh.login });
  const fr = figmaRow(figma.status);
  const tested = figmaTestWords(figma.test);

  if (cloud.state === 'loading') return null;

  return (
    <div className="v2s-conns" data-testid="settings-connections">
      <ConnectionRow
        row="cloud"
        testid="settings-cloud"
        icon="cloud"
        title="Maude Cloud"
        rowTestid={cloud.state === 'in' ? 'cloud-account' : undefined}
        status={cr.status}
        tone={cr.tone}
        action={
          cr.action === 'sign-out' ? (
            <button
              type="button"
              className={btn}
              disabled={cloud.busy === 'signout'}
              onClick={cloud.signOut}
              data-testid="cloud-sign-out"
            >
              Sign out
            </button>
          ) : cr.action === 'sign-in' ? (
            <button
              type="button"
              className={btn}
              onClick={cloud.startSignIn}
              data-testid="cloud-signin"
            >
              Sign in
            </button>
          ) : null
        }
        advanced={
          <>
            {cloud.cloudUrl ? (
              <ConnField k="Address" mono copy={cloud.cloudUrl}>
                {cloud.cloudUrl}
              </ConnField>
            ) : null}
            {cloud.email ? (
              <ConnField k="Signed in as" mono>
                {cloud.email}
              </ConnField>
            ) : null}
            {linkedUrl && !team.linked ? (
              <HubFields
                url={linkedUrl}
                hub={hub}
                credentialed={cloud.local.linkedHub?.credentialed}
              />
            ) : null}
          </>
        }
      >
        {/* `cloud-bar`: the account's own words — the projects, the Connect outcome, an error. */}
        <div className="v2s-conn-body" data-testid="cloud-bar">
          {cloud.state === 'in' ? (
            <div className="v2s-conn-list">
              <p className="v2s-conn-h">Cloud projects on this Mac</p>
              <div data-testid="settings-cloud-projects">
                <CloudProjects c={cloud} />
              </div>
              {cloud.note ? (
                <p
                  className="v2s-hint"
                  role="status"
                  aria-live="polite"
                  data-testid="cloud-connect-note"
                >
                  {cloud.note.text}
                </p>
              ) : null}
            </div>
          ) : null}
          {cloud.error ? (
            <p className="v2s-conn-err" role="alert">
              {cloud.error}
            </p>
          ) : null}
        </div>
      </ConnectionRow>

      <ConnectionRow
        row="hub"
        icon="box"
        title={team.title}
        status={team.status}
        tone={team.tone}
        action={
          team.action === 'sign-out' ? (
            <button
              type="button"
              className={btn}
              disabled={cloud.busy === 'disconnect'}
              onClick={cloud.disconnect}
              data-testid="settings-hub-sign-out"
            >
              Sign out
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              onClick={() => setTeamOpen(true)}
              data-testid="settings-team-server-add"
            >
              {team.action === 'sign-in' ? 'Sign in…' : 'Add a team server…'}
            </button>
          )
        }
        advanced={
          team.linked ? (
            <HubFields
              url={linkedUrl}
              hub={hub}
              replace
              credentialed={cloud.local.linkedHub?.credentialed}
            />
          ) : null
        }
      >
        {team.action === 'sign-out' ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm v2s-conn-more"
            onClick={() => setTeamOpen(true)}
            data-testid="settings-team-server-add"
          >
            Add another team server…
          </button>
        ) : null}
        {teamOpen ? (
          <TeamProjectsDialog
            serverOnly
            title="Add a team server"
            onClose={() => setTeamOpen(false)}
          />
        ) : null}
      </ConnectionRow>

      <ConnectionRow
        row="github"
        testid="settings-github"
        icon="link"
        title="GitHub"
        status={gr.status}
        tone={gr.tone}
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
        advanced={
          gh.native ? (
            <>
              {gh.login ? (
                <ConnField k="Signed in as" mono>
                  @{gh.login}
                </ConnField>
              ) : null}
              <ConnField k="Token">Kept in this Mac’s keychain — never shown</ConnField>
            </>
          ) : null
        }
      >
        {gh.error ? (
          <p className="v2s-conn-err" role="alert">
            {gh.error}
          </p>
        ) : null}
      </ConnectionRow>

      <ConnectionRow
        row="ai"
        testid="settings-ai-keys"
        icon="sparkle"
        title="AI images, video and voice"
        status={providerSummary(keys.providers)}
        action={
          <button
            type="button"
            className={btn}
            aria-expanded={keysOpen}
            aria-controls="v2s-ai-keys"
            onClick={() => setKeysOpen((v) => !v)}
            data-testid="settings-ai-keys-toggle"
          >
            {keysOpen ? 'Hide' : 'Manage'}
          </button>
        }
        advanced={
          <ConnField k="Where the keys are">
            On this Mac only — never sent anywhere but the provider, never shown to a canvas.
          </ConnField>
        }
      >
        {keysOpen ? (
          <div id="v2s-ai-keys" className="v2s-conn-keys">
            {keys.error ? <p className="v2s-conn-err">{keys.error}</p> : null}
            {(keys.providers ?? []).map((p) => (
              <ProviderCard key={p.id} provider={p} onChanged={keys.reload} />
            ))}
          </div>
        ) : null}
      </ConnectionRow>

      <ConnectionRow
        row="figma"
        testid="figma-connect-card"
        icon="image"
        title="Figma"
        status={fr.status}
        tone={fr.tone}
        action={
          fr.configured ? (
            <>
              <button
                type="button"
                className={btn}
                disabled={figma.busy}
                onClick={figma.runTest}
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
          ) : null
        }
        advanced={fr.configured ? <FigmaToken f={figma} /> : null}
      >
        {!fr.configured && figma.status ? <FigmaToken f={figma} /> : null}
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
      </ConnectionRow>

      {cloud.device ? (
        <CloudDeviceDialog
          device={cloud.device}
          cloudUrl={cloud.cloudUrl}
          openFailed={cloud.openFailed}
          onOpenResult={(s) => cloud.setOpenFailed(s === 'ok' ? '' : s)}
          onCancel={cloud.cancelSignIn}
        />
      ) : null}
      {gh.device ? <GitHubDeviceDialog device={gh.device} onClose={gh.closeDevice} /> : null}
    </div>
  );
}
