// A canvas's lanes at a version — the ONE reader behind every historical render (V2-1.9 §5.6, S1.11/S1.12).
//
//   laneAtRef(readers, repoRel, ref, lane, source?)   the TSX's same-name CSS / meta at `ref`
//   cssOverridesFor(absTsx, css)                      `BuildCanvasOptions.overrides` for that CSS
//   versionMetaScript(metaText)                       the shell's `<script>` carrying the version's meta
//   injectVersionMeta(html, metaText)                 that script, before `</head>`
//
// Sources per ref (§5.6): `r<rev>` → the project's store (`acceptedVersion(repoRel, rev, lane)`);
// a sha → `git show`, then the linked cell's `/api/history/file`. CSS and meta come from the SAME source
// the TSX came from, so a version never renders with one lane from git and another from the cloud.
// A lane the version did not have answers null; the build then uses today's file ("Shared parts show as
// they are now") and its caller keys that on today's file.
//
// Past meta is peer-authored: it is parsed, re-serialised and escaped for a script tag, never spliced.

export type VersionSource = 'accepted' | 'git' | 'cloud';
export type SideLane = 'css' | 'meta';

export interface LaneReaders {
  /** The store's lane at a revision (repo-relative TSX path). null = no such lane / no store. */
  accepted?: (repoRel: string, revision: number, lane: 'html' | SideLane) => Promise<string | null>;
  /** `git show <sha>:<repoRel>` (any file). */
  git?: (sha: string, repoRel: string) => Promise<string | null>;
  /** The linked cell's blob reader (any file). */
  cloud?: (sha: string, repoRel: string) => Promise<string | null>;
}

const ACCEPTED_REF = /^r(\d{1,12})$/;

/** `ui/A.tsx` → `ui/A.css` / `ui/A.meta.json`. */
export function siblingOf(repoRel: string, lane: SideLane): string {
  return repoRel.replace(/\.(tsx|html)$/i, lane === 'css' ? '.css' : '.meta.json');
}

const quiet = async <T>(p: Promise<T> | undefined): Promise<T | null> => {
  try {
    return ((await p) ?? null) as T | null;
  } catch {
    return null;
  }
};

/**
 * The CSS or meta lane of `repoRel`'s version `ref`. With `source`, only that source is asked (the TSX's);
 * without, an accepted ref asks the store and a sha asks git, then the cloud.
 */
export async function laneAtRef(
  readers: LaneReaders,
  repoRel: string,
  ref: string,
  lane: SideLane,
  source?: VersionSource
): Promise<string | null> {
  const rev = ACCEPTED_REF.exec(ref);
  if (rev) {
    if (source && source !== 'accepted') return null;
    return readers.accepted ? quiet(readers.accepted(repoRel, Number(rev[1]), lane)) : null;
  }
  // the readers guard the ref themselves (`gitShowFile`'s positional guard, the cell's sha check)
  const sha = ref.startsWith('git:') ? ref.slice(4) : ref;
  if (!sha) return null;
  const rel = siblingOf(repoRel, lane);
  if (rel === repoRel) return null;
  if (source !== 'cloud' && readers.git) {
    const fromGit = await quiet(readers.git(sha, rel));
    if (fromGit != null || source === 'git') return fromGit;
  }
  if (source === 'git' || !readers.cloud) return null;
  return quiet(readers.cloud(sha, rel));
}

/** The build overrides for a version's CSS lane; undefined = no lane at that version (today's file). */
export function cssOverridesFor(
  absTsx: string,
  css: string | null
): Record<string, string> | undefined {
  if (css == null || !/\.tsx$/i.test(absTsx)) return undefined;
  return { [absTsx.replace(/\.tsx$/i, '.css')]: css };
}

/** JSON for a `<script>` body: no `</script>`, no `<!--`, no line separators that end a JS string. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The global the shell reads instead of fetching today's meta. */
export const VERSION_META_GLOBAL = '__canvas_meta_version__';

/** The shell's script for a version's meta lane, or null when the lane is absent or not a JSON object. */
export function versionMetaScript(metaText: string | null): string | null {
  if (metaText == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metaText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  // The camera is never versioned (DDR-115); a past lane that still carries one does not move it.
  const { viewport: _viewport, ...meta } = parsed as Record<string, unknown>;
  return `<script>window.${VERSION_META_GLOBAL} = ${scriptSafeJson(meta)};</script>`;
}

/** The shell with the version's meta script before `</head>` (unchanged when there is none). */
export function injectVersionMeta(html: string, metaText: string | null): string {
  const script = versionMetaScript(metaText);
  if (!script) return html;
  const at = html.indexOf('</head>');
  return at < 0 ? html : `${html.slice(0, at)}    ${script}\n  ${html.slice(at)}`;
}
