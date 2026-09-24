/**
 * @file       use-selection-set.tsx — Phase 4.1 multi-selection store
 * @scope      apps/studio/use-selection-set.tsx
 * @purpose    Multi-element selection state for canvas-shell. The canvas
 *             input router calls `replace()` / `add()` / `clear()`;
 *             the provider debounces and posts up to the dev-server shell
 *             through the existing `__design_selected` window.parent channel
 *             so `_active.json` reflects the current selection set.
 *
 * Schema migration. `_active.json#selected` historically holds
 *     selected: SelectedElement | null
 * Phase 4.1 widens to
 *     selected: SelectedElement | SelectedElement[] | null
 * Writer: emits a single object when N === 1 (back-compat with downstream
 * tools that still read the legacy shape — `/design:edit`, handoff). Emits an
 * array when N > 1. Reader (this hook on rehydrate) accepts all three.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types

/**
 * Minimal Selection shape that travels through the parent postMessage channel.
 * Mirrors `SelectedElement` from inspect.ts but the canvas router computes it
 * client-side and the inspector overlay's enrichment fields (html excerpt,
 * dom_path, classes...) are filled in by the router right before the message
 * is posted.
 */
export interface Selection {
  /** Canvas file path — designRel-prefixed (e.g. `.design/ui/Foo.tsx`). */
  file?: string;
  /** Stable `data-cd-id` anchor when present. v2-grade only. */
  id?: string;
  /** CSS-selector fallback path (always present). */
  selector: string;
  /** Artboard host (`data-dc-screen`) — for scoping multi-edits in future. */
  artboardId?: string | null;
  /**
   * Occurrence index of this element among `querySelectorAll(selector)`.
   * data-cd-id is stamped per SOURCE element, so a component rendered N times
   * (a list row, or a reusable used twice) yields N DOM nodes with the SAME
   * id+artboard selector. The index disambiguates which instance — resolvers
   * use `querySelectorAll(selector)[index]`. Absent/0 → first match.
   */
  index?: number;
  /** Snapshot fields filled by the router from `resolveHoverTarget`. */
  tag?: string;
  classes?: string;
  text?: string;
  dom_path?: string[];
  bounds?: { x: number; y: number; w: number; h: number } | null;
  /** Stage D4 tail — WORLD-unit size (`offsetWidth`/`offsetHeight`, unaffected by
   *  the `.dc-world` zoom transform, unlike `bounds` which is the SCREEN rect).
   *  The Inspector's artboard-resize fields need the true JSX-authored size to
   *  pre-fill correctly regardless of zoom. */
  worldW?: number;
  worldH?: number;
  html?: string;
  /** Phase 12.2 — authored inline-style values (knob pre-fill) + resolved computed (placeholder hint). */
  authored?: Record<string, string>;
  computed?: Record<string, string>;
  /** Phase 12.3 — authored inline-style props OUTSIDE the curated knob set, so the
   *  panel can surface a custom CSS property the user added (e.g. `letter-spacing`). */
  customStyles?: Record<string, string>;
  /** Phase 12.3 — custom HTML attributes on the element (data-, aria-, role, title…),
   *  so the panel reflects a custom attribute the user added via the escape hatch. */
  attrs?: Record<string, string>;
  /** Stage M — the PARENT element's resolved `display` + `flex-direction`, captured
   *  at selection time (the shell can't reach the cross-origin iframe to read them
   *  later). Drives the Fixed/Hug/Fill sizing control: "Fill" is `flex-grow:1` on a
   *  flex child's MAIN axis, `align-self:stretch` on its cross axis, else `100%`. Also
   *  gates the flex-child (align-self / flex-grow…) rows so they don't show on a
   *  block child. Absent for a detached node / no parent. */
  parentDisplay?: string;
  parentFlexDirection?: string;
  /** feature-photo-editor (Task 14) — set at selection resolution when the hit is
   *  a content-addressed photo. `artboard-img` = an `<img src="assets/<sha8>.<ext>">`
   *  authored in artboard TSX; `annotation-image` is threaded separately (the
   *  annotation model has no data-cd-id, so it never rides this DOM-selection
   *  path — see app.jsx's `edit-annotation-photo-request` handler). Absent for a
   *  non-photo element or an `<img>` whose src isn't content-addressed. */
  photoKind?: 'artboard-img' | 'annotation-image';
  /** The resolved `assets/<sha8>.<ext>` source, when `photoKind` is set — the key
   *  the Photo tab passes to `/_api/photo-edit`. */
  photoAsset?: string;
}

/** feature-photo-editor — pull the content-addressed `assets/<sha8>.<ext>` out of
 *  an image src (relative, absolute, or embedded in an outerHTML excerpt). Returns
 *  null for a non-content-addressed src (external URL, SVG icon, data: URI) — those
 *  aren't editable by the sidecar-keyed photo pipeline. Exported so both the
 *  selection resolver and the Inspector's fallback derivation share one regex. */
export function photoAssetFromString(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /assets\/[0-9a-f]{8}\.[a-z0-9]+/i.exec(s);
  return m ? m[0] : null;
}

interface SelectionSetValue {
  selected: Selection[];
  replace: (s: Selection | Selection[]) => void;
  add: (s: Selection | Selection[]) => void;
  remove: (s: Selection) => void;
  toggle: (s: Selection) => void;
  clear: () => void;
}

const SelectionSetContext = createContext<SelectionSetValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Identity. Prefer `id` (data-cd-id stable anchor); fall back to selector.

function selectionKey(s: Selection): string {
  return s.id ? `id:${s.id}` : `sel:${s.selector}`;
}

function dedupe(list: Selection[]): Selection[] {
  const out: Selection[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    const k = selectionKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider

const POST_DEBOUNCE_MS = 50; // mirrors canvas-lib's SETTLE/PUBLISH cadence

export function SelectionSetProvider({
  children,
  /** Override the postMessage destination (used in tests). */
  postTarget,
}: {
  children: ReactNode;
  postTarget?: { postMessage: (msg: unknown, targetOrigin: string) => void } | null;
}) {
  const [selected, setSelected] = useState<Selection[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPostRef = useRef<(() => void) | null>(null);

  const post = useCallback(
    (next: Selection[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingPostRef.current = () => {
        timerRef.current = null;
        pendingPostRef.current = null;
        const target = postTarget ?? (typeof window !== 'undefined' ? window.parent : null);
        if (!target) return;
        // Wire shape: single object for N=1 (back-compat), array for N>1, null for empty.
        const payload: Selection | Selection[] | null =
          next.length === 0 ? null : next.length === 1 ? (next[0] ?? null) : next;
        try {
          target.postMessage({ dgn: 'select-set', selection: payload }, '*');
        } catch {
          /* iframe likely cross-origin or detached */
        }
      };
      timerRef.current = setTimeout(() => pendingPostRef.current?.(), POST_DEBOUNCE_MS);
    },
    [postTarget]
  );

  // Soft HMR replaces this provider too. Deliver the last local selection
  // before the replacement's loaded handshake, so the shell can reselect it.
  // Cancelling silently loses a click made inside the 50 ms debounce window.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingPostRef.current?.();
    },
    []
  );

  const replace = useCallback(
    (s: Selection | Selection[]) => {
      const next = dedupe(Array.isArray(s) ? s : [s]);
      setSelected(next);
      post(next);
    },
    [post]
  );

  const add = useCallback(
    (s: Selection | Selection[]) => {
      const incoming = Array.isArray(s) ? s : [s];
      setSelected((prev) => {
        const next = dedupe([...prev, ...incoming]);
        post(next);
        return next;
      });
    },
    [post]
  );

  const remove = useCallback(
    (s: Selection) => {
      const k = selectionKey(s);
      setSelected((prev) => {
        const next = prev.filter((x) => selectionKey(x) !== k);
        post(next);
        return next;
      });
    },
    [post]
  );

  const toggle = useCallback(
    (s: Selection) => {
      const k = selectionKey(s);
      setSelected((prev) => {
        const next = prev.some((x) => selectionKey(x) === k)
          ? prev.filter((x) => selectionKey(x) !== k)
          : [...prev, s];
        post(next);
        return next;
      });
    },
    [post]
  );

  const clear = useCallback(() => {
    setSelected([]);
    post([]);
  }, [post]);

  const value = useMemo<SelectionSetValue>(
    () => ({ selected, replace, add, remove, toggle, clear }),
    [selected, replace, add, remove, toggle, clear]
  );

  return <SelectionSetContext.Provider value={value}>{children}</SelectionSetContext.Provider>;
}

/**
 * Mount a `SelectionSetProvider` only when none exists above us. The shell-
 * owned comment mount layer provides one so both the lite comment router and
 * `CanvasShell` share a single selection set. Hook called unconditionally;
 * only the returned tree branches (hook rules).
 */
export function MaybeSelectionSetProvider({ children }: { children: ReactNode }) {
  const outer = useContext(SelectionSetContext);
  if (outer) return <>{children}</>;
  return <SelectionSetProvider>{children}</SelectionSetProvider>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks

export function useSelectionSet(): SelectionSetValue {
  const ctx = useContext(SelectionSetContext);
  if (!ctx) {
    throw new Error('useSelectionSet must be used inside <SelectionSetProvider>');
  }
  return ctx;
}

export function useSelectionSetOptional(): SelectionSetValue | null {
  return useContext(SelectionSetContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire-shape helpers — exported for tests and inspect.ts back-compat reader.

/** Convert any inbound shape to an array. */
export function normalizeSelectedRead(
  raw: Selection | Selection[] | null | undefined
): Selection[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return dedupe(raw);
  return [raw];
}

/** Convert internal array back to the wire shape (writer). */
export function denormalizeSelectedWrite(list: Selection[]): Selection | Selection[] | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0] ?? null;
  return list;
}
