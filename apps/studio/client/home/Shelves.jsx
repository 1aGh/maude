// client/home/Shelves.jsx — Home's shelves that were empty on the canvas (S6.4, 05 es-home-cloud /
// es-home-local / es-home-shared) and "Shared with you" with its rows (11 pn-home).
//
// An empty shelf keeps its shape in ghost cards and says what is missing in the empty kit's own words
// (client/v2/empty — never redrawn here). "Shared with you" before anyone shares has NO button: there is
// nothing for the person to do (`NO_DOOR`). Only the person's face is a circle; a project is a square.

import { copy, Empty } from '../v2/empty/index.js';
import { accountFace, rowSlug, sharedAside } from './home-model.js';
import { HIcon, ProjectSquare } from './home-icons.jsx';

/** Three ghost cards: the shelf's shape before there is anything on it. */
export function GhostCards({ n = 3 }) {
  return (
    <span className="home-ghosts" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: n fixed placeholders
        <i key={i} />
      ))}
    </span>
  );
}

/** One shelf: a header (+ where it lives) and its content. */
export function Shelf({ title, where, aside, testid, children }) {
  return (
    <section className="home-sec" aria-label={title} data-testid={testid}>
      <h2 className="home-h">
        {title}
        {aside ? <span className="home-h-aside">{aside}</span> : null}
        {where ? <span className="home-shelf-where">{where}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** "Your projects" with nothing on it: cloud (signed in) or this Mac (not). */
export function ProjectsEmpty({ signedIn, native, onOpenFolder }) {
  const id = signedIn ? 'es-home-cloud' : 'es-home-local';
  return (
    <Shelf
      title={copy(`${id}.shelf`).title}
      testid="home-projects-empty"
      where={
        <>
          <HIcon name={signedIn ? 'cloud' : 'laptop'} size={13} />
          {copy(`${id}.shelf`).foot}
        </>
      }
    >
      <div className="home-shelf-row">
        <GhostCards n={3} />
        <Empty
          align="left"
          copyId={`${id}.projects-none`}
          actions={
            signedIn ? null : (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="home-open-folder"
                onClick={onOpenFolder}
                disabled={!native}
              >
                <HIcon name="folder" size={14} />
                Open project…
                <kbd className="kbd">⌘O</kbd>
              </button>
            )
          }
        />
      </div>
    </Shelf>
  );
}

/** A person's face: a circle with their initial — never the project's square. */
export function Face({ name, size = 'sm' }) {
  const f = accountFace({ id: name, label: name });
  return (
    <span className={`home-face home-face--${size} home-face--${f.tone}`} aria-hidden="true">
      {f.initial}
    </span>
  );
}

/**
 * One pending invitation (gate-b-sec3b): who invited you to what, the role, and the two answers. The row is not a
 * button — Join and Leave are — and it names the project (and canvas), never an invite id.
 */
function InviteRow({ row, canJoin, busy, onJoin, onLeave }) {
  const slug = `${row.projectId}-${row.canvasPath ? rowSlug(row.canvasPath) : 'project'}`;
  return (
    <div className="row-item home-shrow" data-testid={`home-invite-row-${slug}`}>
      <ProjectSquare id={row.projectId} name={row.projectName} size="md" />
      <span className="home-shrow-t">
        <strong>{row.title}</strong>
        <span>
          {row.fromName ? <Face name={row.fromName} /> : null}
          {row.meta || row.projectName}
        </span>
      </span>
      <span className="chip">{row.roleWord}</span>
      <span className="home-shrow-act">
        <button
          type="button"
          className="btn btn--sm"
          data-testid={`home-invite-join-${slug}`}
          disabled={!canJoin || busy}
          onClick={() => onJoin(row)}
        >
          Join
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid={`home-invite-leave-${slug}`}
          disabled={busy}
          onClick={() => onLeave(row)}
        >
          Leave
        </button>
      </span>
    </div>
  );
}

/**
 * @param {{ rows: object[], invites?: object[], newCount: number, canOpen: boolean,
 *   busyKey?: string|null, onOpen: (row: object) => void, onJoin?: (row: object) => void,
 *   onLeave?: (row: object) => void }} props
 */
export function SharedWithYou({
  rows,
  invites = [],
  newCount,
  canOpen,
  busyKey = null,
  onOpen,
  onJoin,
  onLeave,
}) {
  return (
    <Shelf title="Shared with you" aside={sharedAside(newCount)} testid="home-shared">
      {rows.length || invites.length ? (
        <div className="island home-shared">
          {invites.map((r) => (
            <InviteRow
              key={`invite:${r.key}`}
              row={r}
              canJoin={canOpen}
              busy={busyKey === r.key}
              onJoin={onJoin}
              onLeave={onLeave}
            />
          ))}
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className="row-item home-shrow"
              data-testid={`home-shared-row-${r.projectId}-${r.canvasPath ? rowSlug(r.canvasPath) : 'project'}`}
              disabled={!canOpen}
              onClick={() => onOpen(r)}
            >
              <ProjectSquare id={r.projectId} name={r.projectName} size="md" />
              <span className="home-shrow-t">
                <strong>{r.title}</strong>
                <span>
                  {r.grantedBy ? <Face name={r.grantedBy} /> : null}
                  {r.meta}
                </span>
              </span>
              <span className="chip">{r.roleWord}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="home-shelf-row" data-testid="home-shared-empty">
          <GhostCards n={3} />
          <Empty
            align="left"
            copyId="es-home-shared.shared-none"
            next="When someone shares a project with you, it shows up here."
          />
        </div>
      )}
    </Shelf>
  );
}
