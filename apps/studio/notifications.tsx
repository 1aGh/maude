/** Shared shell/canvas notifications. Sonner owns layout, gestures and announcements;
 * our clock also pauses for app overlays, hidden queue entries and Save dialogs. */
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Toaster, toast } from 'sonner';
import { StIcon } from './client/shell/icons.jsx';

export type NoticeKind = 'info' | 'success' | 'error' | 'warning' | 'undo';
export interface Notice {
  id?: string;
  title: string;
  description?: string;
  content?: ReactNode;
  kind?: NoticeKind;
  group?: string;
  duration?: number;
  /** Change only for a new lifecycle phase, never for a progress update. */
  timerKey?: string;
  paused?: boolean;
  /** Where the pill lands. Default bottom (above the toolbar); restart / relaunch / link events land at the top
   *  (06 ad-open-all, the kit `.k-toast--top`). */
  placement?: 'top' | 'bottom';
  /** A kit glyph name (STICONS) that overrides the kind's own. */
  icon?: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}
type Entry = Notice & { id: string };
let entries: Entry[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => entries;

/** sec-a M3 — a title is always text: a number / object from an untrusted caller must not reach
 *  `.trim()` in a render and unmount the shell. */
const asText = (v: unknown): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);

export function notify(input: Notice): string {
  const notice: Notice = {
    ...input,
    title: asText(input.title),
    ...(input.description !== undefined ? { description: asText(input.description) } : {}),
  };
  const id = notice.id ?? `notice-${++sequence}`;
  const existing = entries.findIndex((entry) => entry.id === id);
  if (existing < 0) entries = [...entries, { ...notice, id }];
  else entries = entries.map((entry) => (entry.id === id ? { ...notice, id } : entry));
  publish();
  return id;
}

let canvasSlot = 0;
let canvasWindowStart = -Infinity;
let canvasWindowCount = 0;
/** Untrusted canvas traffic gets two reusable slots, leaving room for shell notices.
 * Limit publications as well as retention; editing can emit dozens per second. */
export function notifyCanvasText(title: unknown, kind: NoticeKind = 'info'): string | null {
  const now = Date.now();
  if (now < canvasWindowStart || now - canvasWindowStart >= 1000) {
    canvasWindowStart = now;
    canvasWindowCount = 0;
  }
  if (canvasWindowCount >= 5) return null;
  canvasWindowCount++;
  const previousUndo =
    kind === 'undo'
      ? entries.find((entry) => entry.group === 'canvas' && entry.kind === 'undo')
      : undefined;
  const id = previousUndo?.id ?? `canvas-notice-${canvasSlot++ % 2}`;
  return notify({
    id,
    title: asText(title).slice(0, 4000),
    kind,
    group: 'canvas',
    timerKey: `${++sequence}`,
  });
}

/** The shell's own ⌘Z / ⇧⌘Z toast (never canvas traffic): the one undo slot, with its one inline action (Redo). */
export function notifyUndo(title: string, action?: { label: string; onClick: () => void }): string {
  const previous = entries.find((entry) => entry.group === 'canvas' && entry.kind === 'undo');
  return notify({
    id: previous?.id ?? `canvas-notice-${canvasSlot++ % 2}`,
    title,
    kind: 'undo',
    group: 'canvas',
    timerKey: `${++sequence}`,
    ...(action ? { action } : {}),
  });
}

/** Drop every canvas notice (programmatic: none is acknowledged) — the standalone host's teardown. */
export function dismissCanvasNotices(): void {
  if (!entries.some((entry) => entry.group === 'canvas')) return;
  entries = entries.filter((entry) => entry.group !== 'canvas');
  publish();
}

/** Programmatic removal (unmount/navigation) does not acknowledge the notice. */
export function dismissNotice(id: string): void {
  entries = entries.filter((entry) => entry.id !== id);
  publish();
}
function acknowledge(id: string) {
  const entry = entries.find((item) => item.id === id);
  dismissNotice(id);
  entry?.onDismiss?.();
}

export function noticeDuration(entry: Notice): number {
  return (
    entry.duration ??
    (entry.action || ['error', 'warning', 'undo'].includes(entry.kind ?? '') ? 10_000 : 5_000)
  );
}

/** Keep full diagnostics in their owning panel, including for screen readers. */
export function summarizeNoticeText(text: unknown): string {
  const compact = asText(text).trim().replace(/\s+/g, ' ');
  return compact.length > 280 ? `${compact.slice(0, 279)}…` : compact;
}

/** ONE rule (v2-p8-c4-toast-dock-or-top): the pill sits in the dock — bottom-centre above the canvas toolbar —
 *  unless the caller says it is a state of the app (`placement: 'top'`) or the video timeline occupies the dock
 *  (07: Split / Captions added), where a bottom pill would cover it. */
function noticePlacement(entry: Notice): 'top' | 'bottom' {
  if (entry.placement) return entry.placement;
  return typeof document !== 'undefined' && document.querySelector('.tl-track') ? 'top' : 'bottom';
}

/** The kit glyph a kind carries (06 `.k-toast-ic`): done, problem; plain info has none. */
const KIND_ICON: Partial<Record<NoticeKind, string>> = {
  success: 'done',
  error: 'problem',
  warning: 'problem',
  undo: 'reload',
};

/** The kit toast: ONE line — glyph, the sentence, one inline action in accent-text, a quiet ×. A notice that
 *  carries a description or extra content wraps, but keeps the same pill. */
export function NoticeCard({ entry }: { entry: Entry }) {
  const glyph = entry.icon ?? KIND_ICON[entry.kind ?? 'info'];
  return (
    <div
      className="maude-notice"
      data-kind={entry.kind ?? 'info'}
      data-testid={`notice-${entry.id}`}
    >
      {glyph ? (
        <span className={`maude-notice-ic maude-notice-ic--${glyph}`} aria-hidden="true">
          <StIcon name={glyph} size={16} className="maude-notice-glyph" />
        </span>
      ) : null}
      <div className="maude-notice-txt">
        <div className="maude-notice-title">{summarizeNoticeText(entry.title)}</div>
        {entry.description && (
          <div className="maude-notice-summary">{summarizeNoticeText(entry.description)}</div>
        )}
        {entry.content}
      </div>
      {entry.action && (
        <button
          type="button"
          className="maude-notice-action"
          onClick={(event) => {
            event.currentTarget.blur();
            entry.action?.onClick();
            acknowledge(entry.id);
          }}
        >
          {entry.action.label}
        </button>
      )}
      <button
        type="button"
        className="maude-notice-close"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.currentTarget.blur();
          acknowledge(entry.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

function MountedNotice({
  entry,
  visible,
  paused,
}: {
  entry: Entry;
  visible: boolean;
  paused: boolean;
}) {
  const duration = noticeDuration(entry);
  const presentationId = useRef<string | null>(null);
  const remaining = useRef(duration);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new lifecycle phase gets a fresh duration.
  useEffect(() => {
    remaining.current = duration;
  }, [duration, entry.timerKey]);
  // Keep the clock outside Sonner's card: hiding a group must preserve its time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart the clock when its lifecycle phase changes.
  useEffect(() => {
    if (!visible || paused || entry.paused || duration === Infinity) return;
    const started = Date.now();
    const timer = setTimeout(() => acknowledge(entry.id), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [visible, paused, entry.paused, duration, entry.timerKey, entry.id]);
  // Sonner invokes onDismiss even for programmatic removal. Invalidate the
  // presentation before hiding so opening history never acknowledges a job.
  useEffect(() => {
    if (visible) {
      const token = presentationId.current ?? `${entry.id}:view-${++sequence}`;
      presentationId.current = token;
      toast.custom(() => <NoticeCard entry={entry} />, {
        id: token,
        duration: Infinity,
        position: noticePlacement(entry) === 'top' ? 'top-center' : 'bottom-center',
        onDismiss: () => {
          if (presentationId.current === token) acknowledge(entry.id);
        },
      });
    } else if (presentationId.current) {
      const token = presentationId.current;
      presentationId.current = null;
      toast.dismiss(token);
    }
  }, [entry, visible]);
  useEffect(
    () => () => {
      const token = presentationId.current;
      presentationId.current = null;
      if (token) toast.dismiss(token);
    },
    []
  );
  return null;
}

const NOTICE_CSS = `
.maude-notifications [data-sonner-toaster] { --width: min(640px, calc(100vw - 32px)); z-index: 8000; }
/* the kit pill hugs its sentence (one line, up to the list's width); it does not stretch to a fixed card */
.maude-notifications [data-sonner-toast] { width: fit-content; max-width: var(--width); margin-inline: auto; }
.maude-notifications [data-sonner-toast][data-expanded=false][data-front=false] {
  overflow: hidden; border-radius: var(--radius-md, 8px);
}
.maude-notifications[data-paused=true] { visibility: hidden; pointer-events: none; }
.maude-notice { box-sizing: border-box; position: relative; width: 100%; min-height: 40px;
  padding: var(--space-1, 4px) var(--space-2, 8px) var(--space-1, 4px) var(--space-4, 16px);
  border: 0; border-radius: var(--radius-lg, 12px); background: var(--bg-2, #26262b); color: var(--fg-0, #fafafa);
  box-shadow: var(--shadow-md, 0 8px 28px #0004), inset 0 0 0 0.5px var(--island-edge, transparent);
  font: var(--type-sm, 13px)/1.4 var(--font-body, system-ui, sans-serif);
  display: flex; flex-direction: row; align-items: center; gap: var(--space-2, 8px); overflow-wrap: anywhere; }
.maude-notice-ic { display: grid; flex: none; color: var(--fg-1, #ddd); }
.maude-notice-ic--spark { color: var(--spark, #e8552d); }
.maude-notice[data-kind=success] .maude-notice-ic { color: var(--status-success-text, var(--status-success, #4caf7d)); }
.maude-notice[data-kind=error] .maude-notice-ic, .maude-notice[data-kind=warning] .maude-notice-ic {
  color: var(--status-error-text, var(--status-error, #d65b4d)); }
/* P8 C7: a toast that says WHAT happened (the trash, the tabs, a link) wears that glyph quietly, not the kind's green */
.maude-notice[data-kind] .maude-notice-ic--trash, .maude-notice[data-kind] .maude-notice-ic--tab, .maude-notice[data-kind] .maude-notice-ic--link { color: var(--fg-1, #ddd); }
.maude-notice-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  padding-right: var(--space-2, 8px); }
.maude-notice-title { font-weight: 500; }
.maude-notice-summary, .maude-notice-title, .maude-notice .st-export-degraded {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
  overflow-wrap: anywhere; }
.maude-notice-summary { color: var(--fg-1, #ddd); font-size: var(--type-xs, 12px); }
.maude-notice-close { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border: 0;
  border-radius: var(--radius-sm, 6px); background: transparent; color: var(--fg-2, #aaa); cursor: pointer;
  font-size: 16px; line-height: 1; padding: 0; }
.maude-notice-close:hover { background: var(--bg-3, #333); color: var(--fg-0, #fff); }
/* P8 c6: the boards' toasts (kit .k-toast) draw no ×. It stays one hover / keyboard focus away (the toast pauses on both). */
.maude-notice:not(:hover):not(:focus-within) .maude-notice-close { display: none; }
.maude-notice-action { flex: none; border: 0; border-radius: var(--radius-sm, 6px); background: transparent;
  color: var(--accent-text, var(--accent, #d63b1f)); font: inherit; font-weight: 600; text-decoration: none;
  cursor: pointer; padding: 4px var(--space-2, 8px); min-height: 26px; }
.maude-notice-action:hover { background: var(--bg-3, #333); }
.maude-notice button:focus-visible { outline: 2px solid var(--focus-ring, var(--accent, #d63b1f)); outline-offset: 2px; }
.maude-notice .st-toast-actions { flex-wrap: wrap; }
@media (prefers-reduced-motion: reduce) {
  .maude-notifications [data-sonner-toast], .maude-notifications [data-sonner-toaster] {
    animation: none !important; transition: none !important;
  }
}`;

const NO_GROUPS: string[] = [];
export function NotificationHost({
  paused = false,
  hiddenGroups = NO_GROUPS,
}: {
  paused?: boolean;
  hiddenGroups?: string[];
}) {
  const notices = useSyncExternalStore(subscribe, snapshot, snapshot);
  const hostRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (!notices.length) {
      setHovered(false);
      setFocused(false);
    }
    // Removing a focused DOM node does not reliably emit blur in browsers.
    if (focused && !hostRef.current?.contains(document.activeElement)) setFocused(false);
  }, [notices, focused]);
  const visible = notices.filter((entry) => !hiddenGroups.includes(entry.group ?? ''));
  // Publish only the latest three; older entries keep their clocks while waiting.
  // This also keeps visibility and clocks aligned when a hidden group returns.
  const timedIds = new Set(visible.slice(-3).map((entry) => entry.id));
  return (
    <div
      ref={hostRef}
      className="maude-notifications"
      data-paused={paused}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <style>{NOTICE_CSS}</style>
      {/* V2-4.9: bottom-centre, above the canvas toolbar island — the v2 bottom-left is the floating
          left panel (a toast there covered its Trash / Advanced rows). */}
      <Toaster
        position="bottom-center"
        offset={{ bottom: 84, top: 16 }}
        mobileOffset={{ left: 16, right: 16, bottom: 84, top: 16 }}
        visibleToasts={3}
        expand={focused}
        style={{ '--width': 'min(640px, calc(100vw - 32px))' } as CSSProperties}
        containerAriaLabel="Notifications"
      />
      {notices.map((entry) => (
        <MountedNotice
          key={entry.id}
          entry={entry}
          visible={timedIds.has(entry.id)}
          paused={paused || hovered || focused || hidden || !timedIds.has(entry.id)}
        />
      ))}
    </div>
  );
}
