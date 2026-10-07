/**
 * @file        _specimen-controls.tsx
 * @purpose     Shared client controls for every maude-v2 preview/*.tsx specimen —
 *              <SpecimenHeader> (the floating island header: mark · crumbs · theme),
 *              <ThemeToggle> (light/dark on the document root), <ReducedMotionToggle>
 *              (motion specimen only) and <Mark> (the logo mark, inlined — lifted
 *              verbatim from system/maude/assets/logos/mark.svg, never redrawn).
 *
 * The toggle sets BOTH the `maude-v2` root class AND `data-theme` on <html> —
 * colors_and_type.css gates its theme blocks on `.maude-v2[data-theme="…"]`.
 * Light is the default (the app follows macOS appearance; light is the first-run look).
 */
import { useEffect, useState } from "react";

const THEME_KEY = "maude-v2:design:theme";
const RM_KEY = "maude-v2:design:reduced-motion";

type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const fromRoot = document.documentElement.dataset.theme as Theme | undefined;
  if (fromRoot === "light" || fromRoot === "dark") return fromRoot;
  try {
    const stored = window.localStorage?.getItem(THEME_KEY) as Theme | null;
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return "light";
}

/** The maude mark: the spark on the message-bubble tile (bottom-right corner squared). */
export function Mark({ size = 22, tile = "var(--accent)", star = "var(--accent-fg)", title = "maude" }: { size?: number; tile?: string; star?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label={title}>
      <path d="M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" fill={tile} />
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill={star} />
    </svg>
  );
}

/** The AI spark on its own (no tile) — the mark's star scaled exactly 26/22 (assets/logos/spark.svg). Used wherever the agent speaks or acts. */
export function Spark({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 3L19.309 12.691L29 16L19.309 19.309L16 29L12.691 19.309L3 16L12.691 12.691Z" fill={color} />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readInitialTheme());

  useEffect(() => {
    document.documentElement.classList.add("maude-v2");
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage?.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable — the toggle still works for this page */
    }
  }, [theme]);

  // role="group" + aria-pressed (not tabs — there are no tabpanels).
  return (
    <span className="theme-toggle" role="group" aria-label="Theme">
      <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
        Light
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
        Dark
      </button>
    </span>
  );
}

export function SpecimenHeader({ crumbs }: { crumbs: string[] }) {
  return (
    <header className="specimen-hd">
      <span className="brand">
        <Mark size={22} />
        maude-v2
      </span>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </nav>
      <ThemeToggle />
    </header>
  );
}

export function ReducedMotionToggle() {
  const [rm, setRm] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    const fromRoot = document.documentElement.dataset.reducedMotion;
    if (fromRoot === "true") return true;
    if (fromRoot === "false") return false;
    try {
      const stored = window.localStorage?.getItem(RM_KEY);
      if (stored === "true" || stored === "false") return stored === "true";
    } catch {
      /* storage unavailable */
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(rm);
    try {
      window.localStorage?.setItem(RM_KEY, String(rm));
    } catch {
      /* storage unavailable */
    }
  }, [rm]);

  return (
    <span className="seg" role="group" aria-label="Reduced motion">
      <button type="button" aria-pressed={!rm} onClick={() => setRm(false)}>Motion</button>
      <button type="button" aria-pressed={rm} onClick={() => setRm(true)}>Reduced</button>
    </span>
  );
}
