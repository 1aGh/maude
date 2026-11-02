// client/v2/onboarding/GithubSegment.jsx — the "From GitHub" segment of "Open a folder or a GitHub project"
// (02 ob-adv-sheets, S6.10). `useGithubSegment` returns the `github` prop FolderGithubSheet rests without:
// { content, canOpen, onOpen }. The list comes from Rust (`github_repos`, the profile's keychain token, REST in
// Rust); a signed-out profile gets the GitHub sign-in for Home (`home_github_sign_in`). Open clones into
// ~/Maude/<repo> (or a folder the person picks) and opens it as a tab; the page never holds a token.

import { useCallback, useEffect, useRef, useState } from 'react';

import { HIcon } from '../../home/home-icons.jsx';
import {
  GITHUB_WORDS as W,
  githubChoice,
  githubRepos,
  githubSignIn,
  runGithubChoice,
} from './github-home.js';

/**
 * @param {{ profile?: string, invoke?: Function, listen?: (event: string, fn: Function) => Promise<() => void>,
 *           openRoot: (root: string) => Promise<unknown>, onDone: () => void,
 *           setBusy: (b: boolean) => void, setError: (e: string|null) => void }} opts
 */
export function useGithubSegment({ profile, invoke, listen, openRoot, onDone, setBusy, setError }) {
  const [list, setList] = useState({ phase: 'loading', repos: [], signedIn: false, profile });
  const [picked, setPicked] = useState(null);
  const [link, setLink] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState('');
  const [chooseFolder, setChooseFolder] = useState(false);
  const [code, setCode] = useState(null);
  const alive = useRef(true);

  const load = useCallback(
    async (p) => {
      setList((l) => ({ ...l, phase: 'loading' }));
      try {
        const r = await githubRepos(p, invoke);
        if (!alive.current) return;
        if (!r || typeof r !== 'object')
          return setList({ phase: 'off', repos: [], signedIn: false, profile: p });
        const repos = Array.isArray(r.repos)
          ? r.repos.filter((x) => typeof x?.fullName === 'string')
          : [];
        setList({ phase: 'ready', repos, signedIn: r.signedIn === true, profile: r.profile ?? p });
        setPicked((cur) => cur ?? repos[0]?.fullName ?? null);
      } catch (e) {
        // the list could not be read (offline, GitHub busy, an older shell): said inside the segment,
        // so the folder half of the sheet stays as it was
        if (!alive.current) return;
        const said = typeof e === 'string' ? e : W.failed;
        setList({ phase: 'error', repos: [], signedIn: false, profile: p, said });
      }
    },
    [invoke]
  );

  useEffect(() => {
    alive.current = true;
    load(profile);
    let off = () => {};
    listen?.('github://device-code', (p) => alive.current && setCode(p?.user_code ?? null)).then(
      (u) => {
        off = u;
      }
    );
    return () => {
      alive.current = false;
      off();
    };
  }, [profile, load, listen]);

  const signIn = async () => {
    setError(null);
    setList((l) => ({ ...l, phase: 'signing-in' }));
    try {
      const r = await githubSignIn(profile, invoke);
      if (!alive.current) return;
      setCode(null);
      await load(r?.profile ?? profile);
    } catch (e) {
      if (!alive.current) return;
      setCode(null);
      setList((l) => ({ ...l, phase: 'ready' }));
      setError(typeof e === 'string' ? e : W.failed);
    }
  };

  const choice = githubChoice({ picked, link, isNew, name });
  const onOpen = async () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runGithubChoice(choice, { profile: list.profile, chooseFolder, invoke });
      if (!alive.current) return;
      if (!r?.root) return setBusy(false); // the folder picker was closed: nothing changed
      await openRoot(r.root);
      onDone();
    } catch (e) {
      if (!alive.current) return;
      setBusy(false);
      setError(typeof e === 'string' ? e : W.failed);
    }
  };

  let content;
  if (list.phase === 'loading') {
    content = (
      <p className="ob-fine" data-testid="onb-github-loading">
        {W.loading}
      </p>
    );
  } else if (list.phase === 'error') {
    content = (
      <p className="ob-fine" role="alert" data-testid="onb-github-error">
        {list.said}
      </p>
    );
  } else if (!list.signedIn) {
    content = (
      <span className="ob-gh-signin">
        <p className="ob-fine">
          {list.phase === 'signing-in' && code ? W.code(code) : W.signInLine}
        </p>
        <button
          type="button"
          className="btn btn--sm"
          data-testid="onb-github-signin"
          disabled={list.phase === 'signing-in'}
          onClick={signIn}
        >
          {list.phase === 'signing-in' ? W.waiting : W.signIn}
        </button>
      </span>
    );
  } else {
    content = (
      <>
        {list.repos.length ? (
          <span
            className="ob-list"
            role="radiogroup"
            aria-label="GitHub projects"
            data-testid="onb-github-list"
          >
            {list.repos.map((r) => {
              const on = !isNew && !link.trim() && picked === r.fullName;
              return (
                // biome-ignore lint/a11y/useSemanticElements: a repo row with a checked state, drawn as a list button
                <button
                  key={r.fullName}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="ob-list-row"
                  data-testid="onb-github-repo"
                  onClick={() => {
                    setPicked(r.fullName);
                    setIsNew(false);
                    setLink('');
                  }}
                >
                  <HIcon name={r.private ? 'lock' : 'folder'} size={12} />
                  <span className="k-mono ob-list-n">{r.fullName}</span>
                  <span className="ob-list-m">{r.private ? W.private : W.public}</span>
                </button>
              );
            })}
          </span>
        ) : (
          <p className="ob-fine" data-testid="onb-github-empty">
            {W.empty}
          </p>
        )}
        <input
          className="ob-input k-mono"
          aria-label={W.paste}
          placeholder={W.paste}
          data-testid="onb-github-link"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            if (e.target.value) setIsNew(false);
          }}
        />
        {isNew ? (
          <input
            className="ob-input"
            aria-label={W.newName}
            placeholder={W.newName}
            data-testid="onb-github-new-name"
            // biome-ignore lint/a11y/noAutofocus: the row the person just chose asks for the name
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <button
            type="button"
            className="ob-newgh"
            data-testid="onb-github-new"
            onClick={() => {
              setIsNew(true);
              setLink('');
            }}
          >
            <HIcon name="plus" size={12} />
            {W.newGithub}
          </button>
        )}
      </>
    );
  }

  const where = list.signedIn ? (
    <p className="ob-fine ob-gh-where">
      {chooseFolder ? W.pickNext : W.inMaude}{' '}
      {chooseFolder ? null : (
        <button
          type="button"
          className="ob-link"
          data-testid="onb-github-choose-folder"
          onClick={() => setChooseFolder(true)}
        >
          {W.chooseFolder}
        </button>
      )}
    </p>
  ) : null;

  return {
    content: (
      <>
        {content}
        {where}
      </>
    ),
    canOpen: list.signedIn && !!choice,
    onOpen,
  };
}
