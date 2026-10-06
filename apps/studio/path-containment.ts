/**
 * Path containment that holds on Windows as well as POSIX (#145).
 *
 * The studio used to answer "is this file under that root?" with a string
 * prefix — `${child}/`.startsWith(`${root}/`) — and to build the static route's
 * file path with `posix.join(repoRoot, urlPath)`. On Windows the root is native
 * (`C:\proj\.design`) while the joined path was mixed (`C:\proj/.design/a.tsx`),
 * so the prefix never matched: every canvas `.tsx` skipped the transpile branch,
 * went out as `text/plain`, and the iframe died on "Failed to fetch dynamically
 * imported module".
 *
 * Both helpers take the `node:path` flavour as a parameter so the win32 case is
 * testable from a Mac (`path.win32`); production callers use the default.
 */
import nodePath from 'node:path';

type PathImpl = Pick<typeof nodePath, 'isAbsolute' | 'relative' | 'resolve' | 'sep'>;

/**
 * True when `child` is `root` itself or lies inside it. `path.relative`, never a
 * string prefix: a prefix compare also matches `/repo-evil` against `/repo`, and
 * cannot see that `C:\proj\x` and `C:\proj/x` are the same file. Win32 compares
 * case-insensitively, like the filesystem does.
 */
export function isUnderOrEqual(child: string, root: string, p: PathImpl = nodePath): boolean {
  const fold = (s: string) => (p.sep === '\\' ? s.toLowerCase() : s);
  const rel = p.relative(fold(root), fold(child));
  if (rel === '') return true;
  if (p.isAbsolute(rel)) return false; // another drive on win32
  return rel !== '..' && !rel.startsWith(`..${p.sep}`);
}

/**
 * Map an already-DECODED URL pathname (`/.design/ui/a.tsx`) onto a native
 * absolute path under `root`, or null when it would leave `root`.
 *
 * On win32 a backslash or a colon in the URL is refused outright: the canvas-
 * origin gate (`isCanvasSafeRoute`) normalizes with POSIX rules, so a `\` it
 * reads as an ordinary character would become a separator here — `..%5c`
 * climbing out of the design root while still under the repo (the DDR-060 A1/A2
 * decode-mismatch class). A colon would name a drive or an NTFS stream. Neither
 * can appear in a legitimate Windows file name anyway.
 */
export function resolveUrlPathUnder(
  pathname: string,
  root: string,
  p: PathImpl = nodePath
): string | null {
  if (pathname.includes('\0')) return null;
  if (p.sep === '\\' && (pathname.includes('\\') || pathname.includes(':'))) return null;
  const abs = p.resolve(root, `.${pathname.startsWith('/') ? '' : '/'}${pathname}`);
  return isUnderOrEqual(abs, root, p) ? abs : null;
}
