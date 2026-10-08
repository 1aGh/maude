// shell/icons.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

// lucide wrapper — hairline stroke to match the shell's icon weight (handoff).
export const Lu = ({ as: C, size = 14 }) => <C size={size} strokeWidth={1.75} style={{ display: 'block' }} />;

// ---------- Components ----------

export function Icon({ d, size = 14, color }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
    >
      <path d={d} />
    </svg>
  );
}

// ───── maude DS icon set (Plan B) ─────
// Thin-stroke (1.4) 16×16 geometric glyphs lifted from .design/ui/Studio.tsx —
// the icon vocabulary the ported `.st-*` chrome composes with. Distinct from the
// legacy 24×24 single-path `Icon` above (kept for not-yet-ported chrome). Grown
// per slice; this slice (menubar/statusbar) needs sparkle/check/sun/moon plus a
// few the sidebar + panels reuse later.
export const STICONS = {
  'chevron-down': <polyline points="3.5 6 8 10.5 12.5 6" />,
  'chevron-right': <polyline points="6 3.5 10.5 8 6 12.5" />,
  file: (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <polyline points="9 2 9 5 12 5" />
    </>
  ),
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  // feature-file-tree-drag-drop-folders (Task 9/12) — folder outline + a "+"
  // mark, single-stroke family matching `folder`/`file`/`panel-left`.
  'folder-plus': (
    <>
      <path d="M2 4.5h4l1.3 1.5H14V13H2z" />
      <path d="M8 7.5v3.5M6.25 9.25h3.5" />
    </>
  ),
  // feature-4 T7b — Layers padlock (closed / open).
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015-.7" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <line x1="10" y1="10" x2="13.5" y2="13.5" />
    </>
  ),
  plus: (
    <>
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </>
  ),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  x: (
    <>
      <line x1="4.3" y1="4.3" x2="11.7" y2="11.7" />
      <line x1="11.7" y1="4.3" x2="4.3" y2="11.7" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.4" y1="3.4" x2="4.4" y2="4.4" />
      <line x1="11.6" y1="11.6" x2="12.6" y2="12.6" />
      <line x1="12.6" y1="3.4" x2="11.6" y2="4.4" />
      <line x1="4.4" y1="11.6" x2="3.4" y2="12.6" />
    </>
  ),
  moon: <path d="M12.5 9.6A5 5 0 1 1 7 3a4 4 0 0 0 5.5 6.6z" />,
  sparkle: (
    <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />
  ),
  megaphone: (
    <>
      <path d="M2 6.7 11 4v8L2 9.3z" />
      <path d="M11 5.2a2.4 2.4 0 0 1 0 5.6" />
      <path d="M4.3 9.5v2.3a1.2 1.2 0 0 0 2.4 0v-1.7" />
    </>
  ),
  bug: (
    <>
      <circle cx="8" cy="9" r="3.6" />
      <circle cx="8" cy="4.4" r="1.3" />
      <path d="M6.2 3.4 5.2 2M9.8 3.4l1-1.4" />
      <path d="M4.6 7.6H2.2M4.6 9H2.2M4.6 10.6H2.5M11.4 7.6h2.4M11.4 9h2.4M11.4 10.6h2.3" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <line x1="6.4" y1="3" x2="6.4" y2="13" />
    </>
  ),
  resolve: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <polyline points="5.4 8 7.2 9.9 10.6 6" />
    </>
  ),
  reopen: (
    <>
      <path d="M3.2 8a5 5 0 1 1 1.4 3.5" />
      <polyline points="3.2 11.4 3.2 8 6.6 8" />
    </>
  ),
  layers: (
    <>
      <polygon points="8 2.2 13.8 5.5 8 8.8 2.2 5.5" />
      <polyline points="2.2 9 8 12.3 13.8 9" />
    </>
  ),
  // Layer-type glyphs (Phase 12.3 W3.1) — one mark per LayerNode `type`.
  box: <rect x="3" y="3" width="10" height="10" rx="1.2" />,
  type: (
    <>
      <polyline points="4 4 12 4" />
      <line x1="8" y1="4" x2="8" y2="12" />
    </>
  ),
  button: (
    <>
      <rect x="2.5" y="5" width="11" height="6" rx="3" />
      <line x1="6" y1="8" x2="10" y2="8" />
    </>
  ),
  input: (
    <>
      <rect x="2.5" y="5" width="11" height="6" rx="1.2" />
      <line x1="5" y1="8" x2="5" y2="8" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5l-1 1" />
      <path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5l1-1" />
    </>
  ),
  list: (
    <>
      <line x1="6" y1="4.5" x2="13" y2="4.5" />
      <line x1="6" y1="8" x2="13" y2="8" />
      <line x1="6" y1="11.5" x2="13" y2="11.5" />
      <circle cx="3.2" cy="4.5" r="0.8" fill="currentColor" />
      <circle cx="3.2" cy="8" r="0.8" fill="currentColor" />
      <circle cx="3.2" cy="11.5" r="0.8" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  eyedropper: (
    <>
      <path d="M11 2.6a1.7 1.7 0 0 1 2.4 2.4l-1.2 1.2-2.4-2.4z" />
      <path d="M9.5 4.6 4 10.1V12h1.9l5.5-5.5" />
    </>
  ),
  // Figma-style property prefix glyphs (#2) — small marks INSIDE numeric fields.
  'p-corner': <path d="M3.5 12.5V7a3.5 3.5 0 0 1 3.5-3.5h5.5" />,
  'p-opacity': (
    <>
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
      <path d="M3 8h10M8 3v10" strokeWidth="0.9" opacity="0.55" />
    </>
  ),
  'p-lineheight': (
    <>
      <line x1="6.5" y1="4" x2="13" y2="4" />
      <line x1="6.5" y1="8" x2="13" y2="8" />
      <line x1="6.5" y1="12" x2="13" y2="12" />
      <path d="M3.2 4.6 3.2 11.4M2 6 3.2 4.5 4.4 6M2 10 3.2 11.5 4.4 10" />
    </>
  ),
  'p-letterspacing': (
    <>
      <path d="M3 4v8M13 4v8" />
      <path d="M6 11.5 8 5l2 6.5M6.7 9.3h2.6" strokeWidth="1.1" />
    </>
  ),
  'p-gap': (
    <>
      <rect x="2" y="4.5" width="3.6" height="7" rx="0.6" />
      <rect x="10.4" y="4.5" width="3.6" height="7" rx="0.6" />
      <path d="M6.8 8h2.4M7.4 6.9 6.4 8l1 1.1M8.6 6.9 9.6 8l-1 1.1" strokeWidth="1" />
    </>
  ),
  'p-border': <rect x="3" y="3" width="10" height="10" rx="1" />,
  'p-size': (
    <>
      <path d="M3 13 6.6 3l3.6 10" />
      <path d="M4.3 9.6h4.6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M6.3 4A6.7 6.7 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2 2.4M4.4 5.3A12 12 0 0 0 1.5 8S4 12.5 8 12.5a6.5 6.5 0 0 0 2.1-.35" />
      <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
    </>
  ),
  sliders: (
    <>
      <line x1="3" y1="5" x2="13" y2="5" />
      <circle cx="6" cy="5" r="1.7" fill="currentColor" />
      <line x1="3" y1="11" x2="13" y2="11" />
      <circle cx="10" cy="11" r="1.7" fill="currentColor" />
    </>
  ),
  code: (
    <>
      <polyline points="6 5 3 8 6 11" />
      <polyline points="10 5 13 8 10 11" />
    </>
  ),
  download: (
    <>
      <line x1="8" y1="2.5" x2="8" y2="10" />
      <polyline points="4.5 7 8 10.5 11.5 7" />
      <polyline points="3 12.8 3 13.6 13 13.6 13 12.8" />
    </>
  ),
  // lucide `rotate-cw`, scaled from the 24px source into our 16px viewBox.
  reload: (
    <>
      <path d="M14 8a6 6 0 1 1-2-4.47L14 5.33" />
      <path d="M14 2v3.33h-3.33" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.2a1.8 1.8 0 1 1 2.3 1.9c-.5.2-.6.5-.6 1v.3" />
      <line x1="8" y1="11.4" x2="8" y2="11.5" />
    </>
  ),
  // Export-format glyphs (Plan C) — one distinct mark per format card.
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.3" r="1.1" />
      <path d="M3 12l3-2.8 2.2 1.8 2.4-3L13.5 12" />
    </>
  ),
  vector: (
    <>
      <path d="M3.6 11.2C6 5 10 5 12.4 11.2" />
      <rect x="1.7" y="9.8" width="2.6" height="2.6" rx="0.4" />
      <rect x="11.7" y="9.8" width="2.6" height="2.6" rx="0.4" />
      <rect x="6.7" y="2.6" width="2.6" height="2.6" rx="0.4" />
    </>
  ),
  presentation: (
    <>
      <rect x="2.5" y="3" width="11" height="7.4" rx="1" />
      <line x1="8" y1="10.4" x2="8" y2="13" />
      <line x1="5.6" y1="13.4" x2="10.4" y2="13.4" />
    </>
  ),
  archive: (
    <>
      <rect x="2.5" y="3" width="11" height="3" rx="0.8" />
      <path d="M3.6 6v6.2a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V6" />
      <line x1="6.6" y1="8.8" x2="9.4" y2="8.8" />
    </>
  ),
  external: (
    <>
      <path d="M11 8.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3.5" />
      <polyline points="9.5 3 13 3 13 6.5" />
      <line x1="13" y1="3" x2="7.6" y2="8.4" />
    </>
  ),
  share: (
    <>
      <circle cx="4" cy="8" r="1.9" />
      <circle cx="11.6" cy="3.6" r="1.9" />
      <circle cx="11.6" cy="12.4" r="1.9" />
      <line x1="5.7" y1="7" x2="9.9" y2="4.6" />
      <line x1="5.7" y1="9" x2="9.9" y2="11.4" />
    </>
  ),
  pen: (
    <>
      <path d="M3 13l.8-3L10.6 3.2a1.1 1.1 0 0 1 1.6 0l.6.6a1.1 1.1 0 0 1 0 1.6L6 12.2z" />
      <line x1="9.6" y1="4.2" x2="11.8" y2="6.4" />
    </>
  ),
  square: <rect x="3.5" y="3.5" width="9" height="9" rx="1" />,
};

export function StIcon({ name, size = 16, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {STICONS[name]}
    </svg>
  );
}

// P3 (Plan C) — menubar presence avatar (matches `.design/ui/Studio.tsx` Avatar).
// Up to two uppercase glyphs from a name; falls back to "?" for empties.
export function initialsOf(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  // Single-token names (e.g. a git username "1aGh") → first two chars, so the
  // avatar reads as initials rather than a lone count badge.
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase() || '?';
}

export function StAvatar({ initials, hue, title, pulse }) {
  // Hue rides a custom property so CSS can mix it into the surface (DS avatar
  // recipe: tinted bg + hue border + fg-0 text — solid fill + white text broke
  // the accent-fg contrast rule and washed out in light theme). `pulse` plays
  // the DS motion-presence role (scale+opacity ring) — the AI agent's "live"
  // tell while it's editing.
  return (
    <span
      className={'st-avatar' + (pulse ? ' is-pulsing' : '')}
      style={{ '--av-hue': hue }}
      data-tip={title}
      aria-label={title}
    >
      {initials}
    </span>
  );
}

export function Kbd({ children }) {
  return <span className="kbd">{children}</span>;
}
