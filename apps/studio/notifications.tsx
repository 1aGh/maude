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
import { Spark } from './client/v2/ai/icons.jsx';

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
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  /** kit `Toast at=`: where the pill sits. A state of the project (back online) sits at the top, the rest docks
   *  above the toolbar. Only a notice that also has an `icon` is drawn as the one-line pill. */
  placement?: 'top' | 'dock';
  /** kit `Toast icon=`: a glyph name (`sync`, `help`, `problem`, …) or `spark`. Having one makes the one-line
   *  island pill (03 ai-needs-hidden, 10 co-sync-back): glyph · text · one accent-text action, no close ×. */
  icon?: string;
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

export function NoticeCard({ entry }: { entry: Entry }) {
  if (entry.icon) {
    return (
      <div
        className="maude-notice maude-notice--pill island"
        data-kind={entry.kind ?? 'info'}
        data-testid={`notice-${entry.id}`}
        data-placement={entry.placement ?? 'dock'}
      >
        <span className={`maude-notice-ic maude-notice-ic--${entry.icon}`} aria-hidden="true">
          {entry.icon === 'spark' ? <Spark size={14} /> : <StIcon name={entry.icon} size={16} className="maude-notice-glyph" />}
        </span>
        <span className="maude-notice-title">{summarizeNoticeText(entry.title)}</span>
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
      </div>
    );
  }
  return (
    <div
      className="maude-notice"
      data-kind={entry.kind ?? 'info'}
      data-testid={`notice-${entry.id}`}
    >
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
      <div className="maude-notice-title">{summarizeNoticeText(entry.title)}</div>
      {entry.description && (
        <div className="maude-notice-summary">{summarizeNoticeText(entry.description)}</div>
      )}
      {entry.content}
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
        ...(entry.placement === 'top' ? { position: 'top-center' as const } : {}),
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
.maude-notifications [data-sonner-toaster] { --width: min(360px, calc(100vw - 32px)); z-index: 8000; }
.maude-notifications [data-sonner-toast] { width: var(--width); }
.maude-notifications [data-sonner-toast][data-expanded=false][data-front=false] {
  overflow: hidden; border-radius: var(--radius-md, 8px);
}
.maude-notifications[data-paused=true] { visibility: hidden; pointer-events: none; }
.maude-notice { box-sizing: border-box; position: relative; width: 100%; padding: 16px;
  border: 1px solid var(--border-default, #45454c); border-left: 3px solid var(--accent, #d63b1f);
  border-radius: var(--radius-md, 8px); background: var(--bg-2, #26262b); color: var(--fg-0, #fafafa);
  box-shadow: var(--shadow-md, 0 8px 28px #0004); font: 13px/1.5 var(--font-sans, system-ui, sans-serif);
  display: flex; flex-direction: column; gap: 8px; overflow-wrap: anywhere; }
.maude-notice[data-kind=error], .maude-notice[data-kind=warning] { border-left-color: var(--status-error, #d65b4d); }
.maude-notice-title { font-weight: 600; padding-right: 20px; }
.maude-notice--pill { flex-direction: row; align-items: center; gap: var(--space-2, 8px); width: auto;
  min-height: 40px; padding: var(--space-1, 4px) var(--space-2, 8px) var(--space-1, 4px) var(--space-4, 16px);
  border: 0; border-left: 0; border-radius: var(--radius-pill, 999px); background: var(--bg-2, #26262b);
  box-shadow: inset 0 0 0 0.5px var(--border-default, #45454c), var(--shadow-md, 0 8px 28px #0004);
  font-size: var(--type-sm, 12px); line-height: var(--lh-sm, 1.4); white-space: nowrap; margin-inline: auto; }
.maude-notice--pill .maude-notice-title { font-weight: var(--w-regular, 400); padding-right: var(--space-2, 8px);
  display: block; overflow: hidden; text-overflow: ellipsis; max-width: 56ch; }
.maude-notice-ic { display: grid; flex: none; color: var(--fg-1, #ddd); }
.maude-notice-ic--spark { color: var(--spark, #e8552d); }
.maude-notice-ic--help, .maude-notice-ic--sync { color: var(--fg-1, #ddd); }
.maude-notice--pill button[class~='maude-notice-action'] { align-self: center; padding: 0 var(--space-2, 8px); }
.maude-notice-summary, .maude-notice-title, .maude-notice .st-export-degraded {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
  overflow-wrap: anywhere; }
.maude-notice-summary { color: var(--fg-1, #ddd); }
.maude-notice-close { position: absolute; right: 8px; top: 8px; border: 0; border-radius: 4px;
  background: transparent; color: inherit; cursor: pointer; font-size: 18px; padding: 0 6px; }
.maude-notice-action { align-self: flex-start; border: 0; background: transparent;
  color: var(--accent-text, var(--accent, #d63b1f)); font: inherit; font-weight: 600; text-decoration: none;
  cursor: pointer; padding: 2px 0; }
.maude-notice-action:hover { text-decoration: underline; }
.maude-notice button:focus-visible { outline: 2px solid var(--accent, #d63b1f); outline-offset: 2px; }
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
        mobileOffset={{ left: 16, right: 16, bottom: 84 }}
        visibleToasts={3}
        expand={focused}
        style={{ '--width': 'min(360px, calc(100vw - 32px))' } as CSSProperties}
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
