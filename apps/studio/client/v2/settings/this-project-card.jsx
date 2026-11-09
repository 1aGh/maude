// client/v2/settings/this-project-card.jsx — 2.1.1 T6: Settings › General › This project (canvas 17 · 08 · 09).
//
// General's first card, open by default: where this project lives, which account it uses, whether it
// connects — with Change… and Switch… beside them — and, when a sign-in broke, the one fix in its header
// (visible while the card is closed). A project only on this Mac offers its two ways out: Put on Maude
// Cloud… and Link your server…. The model is this-project-model.js.
//
// Sync details (the card's own fold, remembered per Mac) holds what used to be Advanced › This project
// (the sync switches and who keeps .design/, project-sync-settings.jsx) and what used to be Connections ›
// Maude Cloud and › Your team's own server: the account, the cloud projects on this Mac (Connect /
// Disconnect, D11), the server's address and masked token with Replace…, its Sign out. Same hooks, same
// routes (use-connections.js) — only the home moved: Connections is about the person, this card is
// about this project.
//
// Switch… runs `account.switch` (the avatar's account list, T4); Link your server… sends
// `account.link-server`'s event (T5's one dialog takes it; nothing taking it opens today's team-server
// form here); Sign in again for a server opens that form on the server's address, for Maude Cloud the
// device sign-in. Moving a project between your folder and a copy Maude keeps has no backend yet —
// Change… draws only what works (Show in Finder).

import { useEffect, useRef, useState } from 'react';

import { isNativeApp } from '../../github.js';
import {
  CloudDeviceDialog,
  isLinkedProjectRow,
  openExternal,
  shareViewUrl,
} from '../../panels/CloudBar.jsx';
import { TeamProjectsDialog } from '../../panels/TeamProjects.jsx';
import { StIcon } from '../../shell/icons.jsx';
import { getPaletteEnv } from '../search/search-env.js';
import { useFold } from '../fold/use-fold.js';
import { menuRunner } from '../shell/menu-runner.js';
import { nativeDoors } from '../shell/native-doors.js';
import { LINK_SERVER_EVENT } from '../shell/project-account-bus.js';
import { AccountBlock } from './account.jsx';
import { ConnField } from './connection-row.jsx';
import { cloudRow, maskedToken } from './connections-model.js';
import ProjectSyncSettings from './project-sync-settings.jsx';
import { CardRow, SettingsCard, StatusLine } from './settings-card.jsx';
import { PROJECT_FOLD } from './settings-model.js';
import { thisProjectModel } from './this-project-model.js';
import { useCloudConnection, useHubDetails } from './use-connections.js';

const btn = 'btn btn--sm';

function useOnline() {
  const [on, setOn] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}

/** The project's square: its first letter (canvas 17 `Sq`). */
function ProjectSquare({ name }) {
  const ch =
    String(name || '?')
      .trim()
      .charAt(0)
      .toUpperCase() || '?';
  return <span className="v2s-sq">{ch}</span>;
}

/** The account's face: an initial, or a laptop for no account (canvas 17 `Face`). */
function Face({ account }) {
  if (account.kind === 'local')
    return (
      <span className="v2s-face v2s-face--mac" aria-hidden="true">
        <StIcon name="laptop" size={12} />
      </span>
    );
  const ch = String(account.label || '?')
    .charAt(0)
    .toUpperCase();
  return (
    <span className="v2s-face" aria-hidden="true">
      {ch}
    </span>
  );
}

/** Lives in: the place chip (canvas 17 `PlaceChip`). */
function PlaceChip({ place }) {
  const icon = place.kind === 'folder' ? 'folder' : place.kind === 'server' ? 'box' : 'cloud';
  return (
    <span className="v2s-place" data-testid="settings-project-place" data-place={place.kind}>
      <StIcon name={icon} size={12} />
      <span>{place.label}</span>
      {place.path ? <span className="v2s-place-path">{place.path}</span> : null}
    </span>
  );
}

/** Change… — where the project lives, and what this Mac can do about it today. */
function ChangeMenu({ m, onShowInFinder }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    const away = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const shown = m.changeOptions.filter((o) => o.available);
  const places = shown.filter((o) => o.id !== 'finder');
  const finder = shown.find((o) => o.id === 'finder');
  return (
    <span className="v2s-menu-host">
      <button
        ref={btnRef}
        type="button"
        className={btn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="settings-project-change"
      >
        Change…
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="v2s-menu"
          role="menu"
          aria-label={`Where ${m.name} lives`}
          data-testid="settings-project-change-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          <p className="v2s-menu-h">Where {m.name} lives</p>
          {places.map((o) => (
            <div
              key={o.id}
              role="menuitemradio"
              aria-checked={o.current}
              aria-disabled="true"
              tabIndex={-1}
              className="v2s-menu-i"
              data-testid={`settings-project-place-${o.id}`}
            >
              <span className="v2s-menu-ck">
                {o.current ? <StIcon name="check" size={12} /> : null}
              </span>
              <span>{o.label}</span>
              {o.detail ? <span className="v2s-menu-d">{o.detail}</span> : null}
            </div>
          ))}
          {finder ? (
            <>
              <span className="v2s-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="v2s-menu-i"
                onClick={() => {
                  close();
                  onShowInFinder();
                }}
                data-testid="settings-project-finder"
              >
                <span className="v2s-menu-ck">
                  <StIcon name="folder" size={12} />
                </span>
                <span>Show in Finder</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

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
            e.preventDefault();
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

/** The linked server's address + masked token — never more than its last four characters. */
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
      {typeof d?.account === 'string' && d.account ? (
        <ConnField k="Signed in as" mono testid="settings-hub-account">
          {d.account}
        </ConnField>
      ) : null}
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

/** Run a registry action through the one runner, when the shell can; false when it cannot. */
function runAction(id, params) {
  if (!menuRunner.canRun(id)) return false;
  return menuRunner.run(id, params);
}

export default function ThisProjectCard({
  open,
  onToggle,
  focus,
  syncStatus,
  onLinkedHub,
  onLocalProject,
  onCloseSheet,
}) {
  const cloud = useCloudConnection({ onLinkedHub, onLocalProject, syncStatus });
  const online = useOnline();
  const linkedUrl = cloud.local.linkedHub?.url ?? null;
  const hub = useHubDetails(linkedUrl);
  const [, setFold] = useFold(PROJECT_FOLD);
  const [teamOpen, setTeamOpen] = useState(false);
  const [signInAt, setSignInAt] = useState(null);
  const native = isNativeApp();

  // ⌘K found a row of this card: nearly all of them sit under Sync details, so the fold opens too (it
  // stays open, like any fold opened by hand).
  const focusN = focus?.n ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new ask (`n`) opens it again
  useEffect(() => {
    if (focus?.card === 'this-project') setFold(true);
  }, [focusN]);

  const m = thisProjectModel({
    status: {
      connected: cloud.state === 'in',
      email: cloud.email,
      url: cloud.cloudUrl,
      project: cloud.local.project,
      linkedHub: cloud.local.linkedHub,
      place: cloud.local.place,
    },
    syncStatus,
    hubAccount: hub.details?.account ?? null,
    online,
    native,
  });
  const cr = cloudRow({ state: cloud.state, email: cloud.email });

  const signInAgain = () => {
    if (m.linkKind === 'cloud') cloud.startSignIn();
    else setSignInAt(m.hubUrl ?? '');
  };
  const linkServer = () => {
    // `account.link-server`'s event (shell/project-account-bus.js): 2.1.1 T5's one dialog takes it; when
    // nothing does, today's team-server form opens here, in the sheet
    const ev = new CustomEvent(LINK_SERVER_EVENT, { detail: { intent: 'link' }, cancelable: true });
    window.dispatchEvent(ev);
    if (ev.defaultPrevented) onCloseSheet?.();
    else setTeamOpen(true);
  };
  const canMove = menuRunner.canRun('share.move-to-cloud');
  const canSwitch = menuRunner.canRun('account.switch');
  const showInFinder = () => {
    const rel = getPaletteEnv()?.designRel || '.design';
    nativeDoors()
      .revealPath(rel)
      .catch(() => {});
  };

  const fix = m.fixLabel ? (
    <button
      type="button"
      className="btn btn--sm btn--primary"
      onClick={signInAgain}
      data-testid="settings-project-sign-in-again"
    >
      {m.fixLabel}
    </button>
  ) : null;

  if (cloud.state === 'loading') return null;

  return (
    <>
      <SettingsCard
        id="this-project"
        testid="settings-this-project"
        label="This project"
        iconNode={<ProjectSquare name={m.name} />}
        title="This project"
        titleExtra={m.name}
        desc={m.desc}
        summary={m.statusWord}
        sw={m.sw}
        bad={m.bad}
        // the fix never hides inside a closed card (09): open, it is the callout's button instead
        action={m.bad && !open ? fix : undefined}
        open={open}
        onToggle={onToggle}
        reveal={focus?.card === 'this-project'}
        fold={{
          panel: PROJECT_FOLD,
          label: 'Sync details',
          hint: m.local ? 'Maude Cloud · cloud projects' : 'Project files · trash · first link',
          testid: 'settings-sync-details',
          body: (
            <div className="v2s-sync-details">
              <ProjectSyncSettings cloud={null} />

              <section className="v2s-sub" aria-label="Maude Cloud" data-testid="settings-cloud">
                <h4 className="v2s-sub-t">Maude Cloud</h4>
                <div
                  className="v2s-sub-r"
                  data-testid={cloud.state === 'in' ? 'cloud-account' : undefined}
                >
                  <StatusLine
                    sw={cr.tone === 'ok' ? 'ok' : 'off'}
                    testid="settings-conn-cloud-status"
                  >
                    {cr.status}
                  </StatusLine>
                  {cr.action === 'sign-out' ? (
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
                  ) : null}
                </div>
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
                {cloud.cloudUrl ? (
                  <ConnField k="Address" mono copy={cloud.cloudUrl}>
                    {cloud.cloudUrl}
                  </ConnField>
                ) : null}
                {linkedUrl && m.linkKind === 'cloud' ? (
                  <HubFields
                    url={linkedUrl}
                    hub={hub}
                    credentialed={cloud.local.linkedHub?.credentialed}
                  />
                ) : null}
                <AccountBlock cloud={null} />
              </section>

              {m.linkKind === 'server' ? (
                <section
                  className="v2s-sub"
                  aria-label="Your server"
                  data-testid="settings-conn-hub"
                >
                  <h4 className="v2s-sub-t">Your server · {m.host}</h4>
                  <div className="v2s-sub-r">
                    <StatusLine sw={m.sw} testid="settings-conn-hub-status">
                      {m.statusWord}
                    </StatusLine>
                    <button
                      type="button"
                      className={btn}
                      disabled={cloud.busy === 'disconnect'}
                      onClick={cloud.disconnect}
                      data-testid="settings-hub-sign-out"
                    >
                      Sign out
                    </button>
                  </div>
                  <HubFields
                    url={linkedUrl}
                    hub={hub}
                    replace
                    credentialed={cloud.local.linkedHub?.credentialed}
                  />
                </section>
              ) : null}
              {!m.local ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm v2s-conn-more"
                  onClick={linkServer}
                  data-testid="settings-team-server-add"
                >
                  Link another server…
                </button>
              ) : null}
            </div>
          ),
        }}
      >
        <CardRow
          k="Lives in"
          action={m.canChange ? <ChangeMenu m={m} onShowInFinder={showInFinder} /> : null}
        >
          <PlaceChip place={m.place} />
        </CardRow>
        <CardRow
          k="Account"
          testid="settings-project-account"
          action={
            canSwitch ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  onCloseSheet?.();
                  runAction('account.switch');
                }}
                data-testid="settings-project-switch"
              >
                Switch…
              </button>
            ) : null
          }
        >
          <span className="v2s-inline">
            <Face account={m.account} />
            {m.account.label}
          </span>
        </CardRow>
        <CardRow k="Connection">
          <StatusLine sw={m.sw} testid="settings-project-connection">
            {m.statusWord}
          </StatusLine>
        </CardRow>
        {m.callout ? (
          <div className="v2s-callout" role="alert" data-testid="settings-project-callout">
            <span className="v2s-callout-ic" aria-hidden="true">
              <StIcon name="link" size={14} />
            </span>
            <span className="v2s-callout-t">
              <strong>{m.callout.title}</strong>
              <span>{m.callout.line}</span>
            </span>
            {fix}
          </div>
        ) : null}
        {m.local ? (
          <div className="v2s-acts" data-testid="settings-project-local-acts">
            {canMove ? (
              <button
                type="button"
                className={btn}
                onClick={() => {
                  onCloseSheet?.();
                  runAction('share.move-to-cloud');
                }}
                data-testid="settings-project-put-on-cloud"
              >
                <StIcon name="cloud" size={12} />
                Put on Maude Cloud…
              </button>
            ) : null}
            <button
              type="button"
              className={btn}
              onClick={linkServer}
              data-testid="settings-team-server-add"
            >
              <StIcon name="box" size={12} />
              Link your server…
            </button>
          </div>
        ) : null}
      </SettingsCard>

      {teamOpen ? (
        <TeamProjectsDialog
          serverOnly
          title="Link your server"
          onClose={() => setTeamOpen(false)}
        />
      ) : null}
      {signInAt !== null ? (
        <TeamProjectsDialog
          title="Sign in again"
          initialServer={signInAt}
          onClose={() => setSignInAt(null)}
        />
      ) : null}
      {cloud.device ? (
        <CloudDeviceDialog
          device={cloud.device}
          cloudUrl={cloud.cloudUrl}
          openFailed={cloud.openFailed}
          onOpenResult={(s) => cloud.setOpenFailed(s === 'ok' ? '' : s)}
          onCancel={cloud.cancelSignIn}
        />
      ) : null}
    </>
  );
}
