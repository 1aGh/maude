/**
 * The canvas file a canvas page is showing, repo-relative (`.design/ui/x.tsx`) — the `file` every
 * canvas-side layer (comments, annotations, AI banner, selection) names in its requests.
 *
 * Under the mount harness the page is `/_canvas-shell.html?canvas=<rel>&designRel=<root>`; for a
 * legacy `.html` mock it is the served path itself. `canvas=` is designRoot-relative (`ui/x.tsx`),
 * but headless callers (`maude design screenshot`, `canvas-rects`) pass `_active.json`'s
 * repo-relative form (`.design/ui/x.tsx`), which the server reads the same way (`toDesignRel`
 * strips the prefix). Read it the same way here (gate-b-c4f): prefixing it again named
 * `.design/.design/ui/x.tsx` — a file outside the capture frame's scope, so every such request was
 * refused, and the refused-and-never-read bodies held a headless capture's `networkidle` forever.
 *
 * A leaf module (no imports) so the canvas-side layers share it without an import cycle.
 */
export function shellCanvasFile(pathname: string, search: string): string | null {
  if (pathname === '/_canvas-shell.html' || pathname === '/_canvas-shell') {
    const qs = new URLSearchParams(search);
    const designRel = (qs.get('designRel') ?? '.design').replace(/^\/+|\/+$/g, '');
    let canvas = (qs.get('canvas') ?? '').replace(/^\/+/, '');
    if (designRel && canvas.startsWith(`${designRel}/`))
      canvas = canvas.slice(designRel.length + 1);
    if (!canvas) return null;
    return designRel ? `${designRel}/${canvas}` : canvas;
  }
  return decodeURIComponent(pathname).replace(/^\//, '');
}

/** `shellCanvasFile` for the current page, or null (no window, a malformed path). */
export function currentCanvasFile(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return shellCanvasFile(window.location.pathname, window.location.search);
  } catch {
    return null;
  }
}
