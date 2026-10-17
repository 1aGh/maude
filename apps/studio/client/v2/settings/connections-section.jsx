// client/v2/settings/connections-section.jsx — V2-4.7a: Settings › Connections (06 ad-edge-hub).
//
// Where your projects live and what Maude is signed in to: Maude Cloud (account, cloud projects on
// this Mac, the linked workspace's address), your team's own server, GitHub, the AI keys, Figma.
// Every row WRAPS today's component with today's handlers — CloudBar (variant "settings"),
// IdentityBar (variant "settings"), TeamProjects (the server form only), the provider and Figma
// cards. A token or key is never read back into this page: the cards show a masked "configured"
// state, the workspace token stays in the keychain.
//
// Desktop only (`cloud === null`): a browser tab has no keychain, and the routes behind these rows are
// refused in a cell by design (DDR-209 D1). The sheet doesn't render this section there.

import { useState } from 'react';

import CloudBar from '../../panels/CloudBar.jsx';
import IdentityBar from '../../panels/IdentityBar.jsx';
import { FigmaConnectCard, ProviderKeys } from '../../panels/SettingsPanel.jsx';
import { TeamProjectsDialog } from '../../panels/TeamProjects.jsx';
import { Group } from './parts.jsx';

export default function ConnectionsSection({ onLinkedHub, onLocalProject, syncStatus }) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);

  return (
    <>
      <Group title="Maude Cloud" testid="settings-cloud">
        <CloudBar
          variant="settings"
          syncStatus={syncStatus}
          onLinkedHub={onLinkedHub}
          onLocalProject={onLocalProject}
        />
      </Group>

      <Group title="Your team’s own server">
        <div className="cb-settings-row">
          <span className="cb-settings-t">
            <strong>A server your team runs</strong>
            <span>
              A self-hosted server, beside the cloud. Sign in with your email and password.
            </span>
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setTeamOpen(true)}
            data-testid="settings-team-server-add"
          >
            Add a team server…
          </button>
        </div>
        {teamOpen && (
          <TeamProjectsDialog
            serverOnly
            title="Add a team server"
            onClose={() => setTeamOpen(false)}
          />
        )}
      </Group>

      <Group title="GitHub">
        <IdentityBar variant="settings" />
      </Group>

      <Group title="AI images, video and voice">
        <div className="cb-settings-row" data-testid="settings-ai-keys">
          <span className="cb-settings-t">
            <strong>Your own provider keys</strong>
            <span>Kept on this Mac only — never sent anywhere but the provider.</span>
          </span>
          <button
            type="button"
            className="btn btn--sm"
            aria-expanded={keysOpen}
            aria-controls="v2s-ai-keys"
            onClick={() => setKeysOpen((v) => !v)}
            data-testid="settings-ai-keys-toggle"
          >
            {keysOpen ? 'Hide' : 'Manage'}
          </button>
        </div>
        {keysOpen && (
          <div id="v2s-ai-keys">
            <ProviderKeys />
          </div>
        )}
      </Group>

      <Group title="Figma">
        <FigmaConnectCard />
      </Group>
    </>
  );
}
