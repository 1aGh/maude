// client/v2/share/share-advanced.jsx — S9.20: Share › Advanced (10 co-share-advanced; the same
// fold as 06 Advanced ad-share, row for row).
//
//   This link          Who can open · Role · Expires        ← the owner, where the hub has links
//                      New people join as                   ← the Invite row's default (S9.20b)
//   Other ways in      App link · This Mac only (· Web link)
//                      Invite by GitHub username            ← the desktop (takes over project.share-github)
//   Where it syncs     Hub <address> · Last synced <when> · "Sync details live in Menu › Diagnostics › Sync."
//   The roles          side by side (cloud) — or the roles THIS hub holds (self-hosted)
//
// What is drawn comes from `advancedView` (share-model.js), i.e. from what the server reports.
// Every change is the server's to allow: a rule change is `PATCH /_api/share/links/:id`, which
// routes/share.ts refuses below owner before the hub hears it — and the hub refuses too.
//
// "New people join as" (decision v2-lead-new-people-join-as-client-default) is a convenience of
// THIS browser: it sets the role the Invite row pre-selects, remembered per project. The hub has no
// default-role field; every invite still sends its explicit role, which the server checks.
// "Last synced" is the sync runtime's own `lastSyncAt` (`/_sync-status`); absent, no line is drawn.

import { Fragment, useEffect, useRef, useState } from 'react';

import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useFold } from '../fold/use-fold.js';
import { whenWords } from '../sync-states/sync-states-model.js';
import { Glyph } from './glyphs.jsx';
import { copyShareLink } from './link-dialog.js';
import {
  errorWords,
  LINK_EXPIRES,
  LINK_ROLES,
  LINK_WHO,
  ROLE_MATRIX,
  ROLE_WORDS,
  roleWord,
} from './share-model.js';

const LINK_KINDS = [
  ['app', 'App link'],
  ['local', 'This Mac only'],
  ['web', 'Web link'],
];

function CopyRow({ id, label, value, testid, copyTestid, children }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  // 10 co-share-advanced `ARow mono copy`: the key left, the value inline in mono, a 22 px copy glyph.
  // The value stays a read-only field (select-all, the stable testid) drawn as plain text; the glyph
  // turns into a check for a moment once the address is on the clipboard.
  return (
    <div className="v2sh-arow v2sh-arow--row v2sh-arow--wrap">
      <label className="v2sh-arow-k" htmlFor={id}>
        {label}
      </label>
      <div className="v2sh-arow-v">
        <input
          id={id}
          className="v2sh-val"
          data-testid={testid}
          readOnly
          value={value}
          title={value}
          // 10 co-share-advanced: the whole address, right-aligned. An input is 20 characters wide until told otherwise,
          // which cut every real address with an ellipsis; the width follows the text (the field is mono, so ch is exact)
          style={{ width: `${value.length + 1}ch` }}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="v2sh-copy"
          title={copied ? 'Copied' : 'Copy'}
          aria-label={`Copy ${label}`}
          data-testid={copyTestid}
          data-done={copied ? 'true' : undefined}
          onClick={async () => {
            if (await copyShareLink(value)) {
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          <Glyph name={copied ? 'check' : 'duplicate'} size={12} />
        </button>
      </div>
      {children}
    </div>
  );
}

function Pick({ id, label, value, options, onChange, disabled }) {
  return (
    <div className="v2sh-arow v2sh-arow--row v2sh-arow--pick">
      <label className="v2sh-arow-k" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="select v2sh-pick"
        data-testid={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, words]) => (
          <option key={v} value={v}>
            {words}
          </option>
        ))}
      </select>
    </div>
  );
}

function GithubInvite({ api, focus }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true });
  }, [focus]);
  const send = async () => {
    setBusy(true);
    setErr(null);
    setDone(null);
    const r = await api.githubInvite(name.trim().replace(/^@/, ''));
    setBusy(false);
    if (r.ok && r.body?.ok) {
      setDone(r.body.username ?? name.trim());
      setName('');
    } else setErr(errorWords(r.body, 'Couldn’t send the invite. Try again.'));
  };
  return (
    <div className="v2sh-arow v2sh-arow--stack" data-testid="share-github">
      <label className="v2sh-arow-k" htmlFor="share-github-username">
        Invite by GitHub username
      </label>
      <div className="v2sh-arow-v">
        <input
          ref={ref}
          id="share-github-username"
          className="input v2sh-mono"
          data-testid="share-github-username"
          placeholder="@username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && !busy) void send();
          }}
        />
        <button
          type="button"
          className="btn btn--sm"
          data-testid="share-github-invite"
          disabled={busy || !name.trim()}
          onClick={send}
        >
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {done && (
        <p className="v2sh-hint" role="status" data-testid="share-github-done">
          {`Invited @${done}. They get a GitHub e-mail and can open this project once they accept.`}
        </p>
      )}
      {err && (
        <p className="v2sh-err" role="alert" data-testid="share-github-error">
          {err}
        </p>
      )}
    </div>
  );
}

function RoleMatrix({ roles }) {
  return (
    <div className="v2sh-mx-wrap" data-testid="share-role-matrix">
      <p className="v2sh-sub">What each role can do</p>
      <table className="v2sh-mx">
        <thead>
          <tr>
            <th scope="col">
              <span className="v2sh-sr">What</span>
            </th>
            {roles.map((r) => (
              <th key={r} scope="col">
                {roleWord(r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROLE_MATRIX.map(([what, may]) => (
            <tr key={what}>
              <th scope="row">{what}</th>
              {roles.map((r) => (
                <td key={r} className={may.includes(r) ? 'v2sh-mx-yes' : 'v2sh-mx-no'}>
                  {may.includes(r) ? <Glyph name="check" size={14} /> : '—'}
                  <span className="v2sh-sr">{may.includes(r) ? 'Yes' : 'No'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="v2sh-hint">
        AI runs on each person’s own Claude account. A link can give Can view or Can comment, never
        more. Can view is look only — downloads start at Can comment. The trash keeps things until
        an owner clears it out.
      </p>
    </div>
  );
}

export function ShareAdvanced({
  adv,
  links,
  shell,
  rules,
  onRule,
  made,
  onTurnOff,
  busy,
  api,
  focus,
  joinAs,
  lastSynced,
  now,
}) {
  const [open, setOpen] = useFold('share');
  useEffect(() => {
    if (focus && !open) setOpen(true);
  }, [focus, open, setOpen]);
  const kinds = LINK_KINDS.filter(([kind]) => links?.[kind]);
  return (
    <AdvancedFold
      panel="share"
      hint={adv.hint}
      testid="share-other-ways"
      buttonTestid="share-other-ways-toggle"
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {adv.rules && (
        <section className="v2sh-adv" data-testid="share-link-rules">
          <p className="v2sh-sub">This link</p>
          <Pick
            id="share-link-who"
            label="Who can open"
            value={rules.who}
            options={LINK_WHO}
            disabled={busy}
            onChange={(v) => onRule({ who: v })}
          />
          <Pick
            id="share-link-role"
            label="Role"
            value={rules.role}
            options={LINK_ROLES.map((r) => [r, roleWord(r)])}
            disabled={busy}
            onChange={(v) => onRule({ role: v })}
          />
          <Pick
            id="share-link-expires"
            label="Expires"
            value={rules.expires}
            options={LINK_EXPIRES.map(([id, words]) => [id, words])}
            disabled={busy}
            onChange={(v) => onRule({ expires: v })}
          />
          {joinAs && joinAs.roles.length > 0 && (
            <Pick
              id="share-join-as"
              label="New people join as"
              value={joinAs.role}
              options={joinAs.roles.map((r) => [r, ROLE_WORDS[r]?.word ?? roleWord(r)])}
              disabled={busy}
              onChange={(v) => joinAs.onChange(v)}
            />
          )}
          {made && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="share-link-off"
              disabled={busy}
              onClick={onTurnOff}
            >
              Turn off the link
            </button>
          )}
        </section>
      )}

      {(kinds.length > 0 || adv.github) && <p className="v2sh-sub">Other ways in</p>}
      {kinds.map(([kind, label]) => (
        <CopyRow
          key={kind}
          id={`share-${kind}-url`}
          label={label}
          value={links[kind]}
          testid={`share-${kind}-url`}
          copyTestid={`share-copy-${kind}`}
        >
          {kind === 'app' && shell !== 'native' && (
            <a className="v2sh-hint" href={links.app} data-testid="share-open-app">
              Open in the Mac app
            </a>
          )}
        </CopyRow>
      ))}
      {adv.github && <GithubInvite api={api} focus={focus === 'github'} />}

      {adv.syncs && (
        <section className="v2sh-adv" data-testid="share-syncs">
          <p className="v2sh-sub">Where it syncs</p>
          <CopyRow
            id="share-syncs-hub"
            label="Hub"
            value={adv.syncs}
            testid="share-syncs-hub"
            copyTestid="share-copy-hub"
          />
          {Number.isFinite(lastSynced) && lastSynced > 0 && (
            <div className="v2sh-arow v2sh-arow--row">
              <span className="v2sh-arow-k">Last synced</span>
              <span className="v2sh-arow-v v2sh-val-text" data-testid="share-syncs-last">
                {whenWords(lastSynced, now ?? Date.now())}
              </span>
            </div>
          )}
          <p className="v2sh-hint">Sync details live in Menu › Diagnostics › Sync.</p>
        </section>
      )}

      {adv.matrix && adv.matrix.length > 0 && <RoleMatrix roles={adv.matrix} />}
      {adv.hubRoles && (
        <section className="v2sh-adv" data-testid="share-hub-roles">
          <p className="v2sh-sub">Roles on this hub</p>
          {adv.hubRoles.available.length > 0 && (
            <p className="v2sh-rm">
              <span className="v2sh-rm-ic" aria-hidden="true">
                <Glyph name="check" size={14} />
              </span>
              <span className="v2sh-rm-t">
                {adv.hubRoles.available.join(' · ')}
                <span>Available</span>
              </span>
            </p>
          )}
          {adv.hubRoles.missing.length > 0 && (
            <p className="v2sh-rm v2sh-rm--off" data-testid="share-hub-roles-missing">
              <span className="v2sh-rm-ic" aria-hidden="true" />
              <span className="v2sh-rm-t">
                {adv.hubRoles.missing.map((w, i) => (
                  <Fragment key={w}>
                    {i > 0 ? ' · ' : ''}
                    {w}
                  </Fragment>
                ))}
                <span>Not on this hub — it has no view-only accounts, so no link either</span>
              </span>
            </p>
          )}
          <p className="v2sh-hint">
            People you invite get an account on this hub — the e-mail tells them where to sign in.
          </p>
        </section>
      )}
    </AdvancedFold>
  );
}
