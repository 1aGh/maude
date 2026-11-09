// client/home/HomeConnection.jsx — 2.1.1 B4 (artboard 14): the pieces Home's accounts row and its project
// rows share — an account's face with the connection badge on it, the "Where" chip, and the state word.
// Models: home-where-model.js (words, tones) · home-accounts-model.js (cards). Nothing here decides a
// state; it draws what the model says.

import { HIcon } from './home-icons.jsx';

/** The broken-link glyph on a sign-in that stopped working (the project window's badge). */
export function BrokenLink({ size = 10 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6.6 9.4 5.1 10.9a2.1 2.1 0 0 1-3-3l1.5-1.5" />
      <path d="M9.4 6.6 10.9 5.1a2.1 2.1 0 0 1 3 3l-1.5 1.5" />
      <path d="M5.2 1.8v1.6M1.8 5.2h1.6M10.8 14.2v-1.6M14.2 10.8h-1.6" />
    </svg>
  );
}

/** "Kept by Maude" — the mark, single colour. */
function KeptGlyph({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" />
      <path d="M8 4.2v7.6M4.2 8h7.6" stroke="var(--bg-1)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * An account's face — a circle with a letter for a Maude Cloud account, a tile with the server glyph for
 * your server, a laptop tile for this Mac — with the connection state as ONE badge on it (a thin ring
 * turning while it syncs, a grey face offline, a broken link when a sign-in needs the person, a warning
 * when the server does not answer).
 * @param {{ face: { kind: string, initial?: string, tone?: string }, state?: string|null,
 *           size?: 'sm'|'md'|'lg' }} props
 */
export function AcctFace({ face, state = null, size = 'md' }) {
  const glyph = size === 'lg' ? 16 : size === 'md' ? 13 : 10;
  return (
    <span
      className={`home-acf home-acf--${size}`}
      data-conn={state ?? undefined}
      aria-hidden="true"
    >
      {face.kind === 'cloud' ? (
        <span className={`home-face home-face--${size} home-face--${face.tone}`}>
          {face.initial}
        </span>
      ) : (
        <span className={`home-acf-tile home-acf-tile--${face.kind} home-acf-tile--${size}`}>
          <HIcon name={face.kind === 'server' ? 'server' : 'laptop'} size={glyph} />
        </span>
      )}
      {state === 'syncing' ? <span className="home-acf-ring" /> : null}
      {state === 'missing' || state === 'rejected' ? (
        <span className="home-acf-badge home-acf-badge--bad">
          <BrokenLink size={size === 'lg' ? 12 : size === 'md' ? 10 : 8} />
        </span>
      ) : null}
      {state === 'unreachable' ? (
        <span className="home-acf-badge home-acf-badge--warn">!</span>
      ) : null}
    </span>
  );
}

/** The state as a word with its dot (green · red · amber · grey). */
export function StateWord({ tone, children, testid }) {
  return (
    <span className="home-sw" data-tone={tone} data-testid={testid}>
      <i aria-hidden="true" />
      {/* 2.1.2: the word clips (…) on a narrow line instead of running under a button */}
      <span className="home-sw-w">{children}</span>
    </span>
  );
}

const WHERE_ICON = { cloud: 'cloud', server: 'server', folder: 'folder' };

/**
 * The "Where" chip: the account for a synced project (Maude Cloud by e-mail, your server by host), or the
 * place for a project only on this Mac (Your folder · Kept by Maude), with the folder's path beside it.
 * @param {{ where: { kind: string, label: string, path: string|null }, testid?: string }} props
 */
export function WhereChip({ where, testid }) {
  return (
    <span className="home-where" data-kind={where.kind} data-testid={testid}>
      <span className="home-place">
        {where.kind === 'kept' ? (
          <KeptGlyph size={12} />
        ) : (
          <HIcon name={WHERE_ICON[where.kind] ?? 'folder'} size={12} />
        )}
        <span>{where.label}</span>
      </span>
      {where.path ? (
        <span className="home-where-path" title={where.path}>
          {where.path}
        </span>
      ) : null}
    </span>
  );
}
