// Which comments and replies are the viewer's — said by the trusted shell, worn by the canvas.
//
// A local comment is signed with `localAuthor` (the git user.name, else this Mac's account name). The shell
// (main origin) is told that name by `/_api/git-user`; the canvas origins are told only the git name or "You"
// (`canvasUserName`, V2-8.9 r2 L1 — canvas code never reads the account name). Comparing names on the canvas
// therefore failed on a Mac with no git name: your own pin read "by iagh" while the Comments panel said
// "You" (rc.1 F08). So the shell stamps `mine: true` on what it hands the canvas (`comments-set`), and the
// canvas wears "You" on a stamped record — the name never crosses. A stamp is display only: the server
// still decides who may edit or delete (`isOwnComment`).
//
// Pure and React-free: the shell (client JS) and the canvas overlay both import it.

interface Signed {
  id?: unknown;
  author?: unknown;
  authorKind?: unknown;
  mine?: unknown;
}
type WithThread<T> = T & { thread?: unknown };

const nameOf = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function sameAuthor(x: Signed, me: string): boolean {
  if (x.authorKind === 'ai') return false;
  const a = nameOf(x.author);
  return a !== '' && a === me;
}

/** #168 G2: what a record of yours is signed with on its way to the canvas — never your author string. */
export const MINE_AUTHOR = 'You';

function stamp<T extends Signed>(x: T, mine: boolean, project = false): T & { mine?: true } {
  const { mine: _old, ...rest } = x;
  if (!mine) return rest as T & { mine?: true };
  return (project ? { ...rest, author: MINE_AUTHOR, mine: true } : { ...rest, mine: true }) as T & {
    mine?: true;
  };
}

function eachWithReplies<T extends Signed>(
  list: readonly WithThread<T>[],
  isMine: (x: Signed) => boolean,
  project = false
): Array<WithThread<T> & { mine?: true; thread?: Array<Signed & { mine?: true }> }> {
  return (Array.isArray(list) ? list : []).map((c) => {
    const out = stamp(c, isMine(c), project) as WithThread<T> & { mine?: true };
    if (Array.isArray(c.thread)) {
      (out as { thread?: unknown }).thread = c.thread.map((r: Signed) =>
        r && typeof r === 'object' ? stamp(r, isMine(r), project) : r
      );
    }
    return out as WithThread<T> & { mine?: true; thread?: Array<Signed & { mine?: true }> };
  });
}

/** The shell side: a copy of `list` with `mine: true` on each comment / reply signed with `me` — and that
 *  record's author projected to "You" (#168 G2), so the stamp never tells the canvas which name is the viewer's. */
export function markMine<T extends Signed>(list: readonly WithThread<T>[], me: unknown) {
  const name = nameOf(me);
  return eachWithReplies(list, (x) => name !== '' && sameAuthor(x, name), true);
}

/** The ids a stamped list marks as mine (comments and replies), kept for a list that arrives unstamped. */
export function mineIdsOf(list: readonly WithThread<Signed>[]): Set<string> {
  const ids = new Set<string>();
  for (const c of Array.isArray(list) ? list : []) {
    if (c?.mine === true && typeof c.id === 'string') ids.add(c.id);
    if (Array.isArray(c?.thread))
      for (const r of c.thread as Signed[])
        if (r?.mine === true && typeof r.id === 'string') ids.add(r.id);
  }
  return ids;
}

/** The canvas side, for the live-collab array (records with no stamp): stamp the ids the shell named. */
export function restampMine<T extends Signed>(
  list: readonly WithThread<T>[],
  ids: ReadonlySet<string>
) {
  return eachWithReplies(list, (x) => typeof x.id === 'string' && ids.has(x.id));
}

/** Whom `authorFace` should compare a record with: its own author when the shell said it is yours. */
export function viewerFor(x: Signed | null | undefined, viewer: string | null | undefined) {
  return x?.mine === true && typeof x.author === 'string' ? x.author : viewer;
}
