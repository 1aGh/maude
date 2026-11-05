// Ported once from .design/ui/v2/_kit.tsx on 2026-11-04; site/ is the source now.
// The floating chrome of the app window: project pill, Share cluster, undo/zoom, toolbar and
// the AI chat panel. Static pictures: spans, never buttons (the whole Window is one image).
import type { ReactNode } from 'react';
import { Icon, Mark, Spark } from './glyphs';
import { Avatar, person, type Who } from './people';

export function ProjectPill({ project, canvas }: { project: string; canvas?: string }) {
  return (
    <span className="island k-pill" title="Project menu">
      <span className="k-pill-mark">
        <Mark size={22} />
      </span>
      <span className="k-pill-txt">
        <span className="k-pill-name">{project}</span>
        {canvas ? (
          <>
            <span className="k-pill-sep">/</span>
            <span className="k-pill-canvas">{canvas}</span>
          </>
        ) : null}
        <span className="k-caret">
          <Icon name="chevron" size={14} />
        </span>
      </span>
    </span>
  );
}

/* The mode switch glyphs are the modes' own (24 grid, 2.25 stroke), never a tool's. */
const MODE_PATHS = {
  edit: (
    <>
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
      <path d="M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </>
  ),
  preview: (
    <>
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="4.5" />
      <path d="M6 12s2.2-3.75 6-3.75S18 12 18 12s-2.2 3.75-6 3.75S6 12 6 12z" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  present: (
    <>
      <path d="M2 3.5h20" />
      <path d="M20.5 3.5v10a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-10" />
      <path d="m7.5 21 4.5-5 4.5 5" />
    </>
  ),
};
type Mode = keyof typeof MODE_PATHS;
const MODE_WORD: Record<Mode, string> = { edit: 'Edit', preview: 'Preview', present: 'Present' };

function ModeSwitch({ mode }: { mode: Mode }) {
  return (
    <span className="k-modes" title="Mode">
      {(['edit', 'preview', 'present'] as const).map((id) => (
        <span
          key={id}
          className={`k-mode-b${id === 'present' ? ' k-mode-b--menu' : ''}`}
          data-pressed={mode === id ? 'true' : undefined}
          title={MODE_WORD[id]}
        >
          <svg
            className="k-ic k-mg"
            width={15}
            height={15}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {MODE_PATHS[id]}
          </svg>
          {id === 'present' ? (
            <span className="k-mode-ch">
              <Icon name="chevron" size={10} />
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

export function ShareCluster({
  people = ['tereza', 'jonas'],
  statusText = 'Saved',
  mode = 'edit',
}: {
  people?: Who[];
  statusText?: string;
  mode?: Mode;
}) {
  return (
    <div className="island k-tr">
      <span className="k-faces">
        {people.map((p) => (
          <Avatar key={person(p).name} who={p} />
        ))}
      </span>
      <span className="k-saved">
        <Icon name="cloud" size={16} />
        {statusText}
      </span>
      <ModeSwitch mode={mode} />
      <span className="icon-btn" title="Hide panels ⌘\">
        <Icon name="panel-right" />
      </span>
      <span className="btn btn--primary">
        <Icon name="share" size={14} />
        Share
      </span>
    </div>
  );
}

export function ZoomUndo({ zoom = 100 }: { zoom?: number }) {
  return (
    <div className="island k-uz">
      <span className="icon-btn" title="Undo ⌘Z">
        <Icon name="undo" />
      </span>
      <span className="icon-btn" title="Redo ⇧⌘Z">
        <Icon name="redo" />
      </span>
      <span className="k-uz-div" />
      <span className="btn btn--ghost btn--sm k-zoom">{`${zoom}%`}</span>
    </div>
  );
}

const TOOLS: [string, string, string][] = [
  ['select', 'Select', 'V'],
  ['hand', 'Hand', 'H'],
  ['frame', 'Frame', 'F'],
  ['shape', 'Shape', 'R'],
  ['pen', 'Pen', 'P'],
  ['text', 'Text', 'T'],
  ['image', 'Image', 'I'],
  ['component', 'Component', '⇧I'],
];

/** The Edit toolbar: the tools that make things inside artboards. */
export function Toolbar() {
  return (
    <div className="island dock k-dock">
      {TOOLS.map(([id, label, key]) => (
        <span
          key={id}
          className={`icon-btn${id === 'select' ? ' k-pressed' : ''}`}
          title={`${label} · ${key}`}
        >
          <Icon name={id} size={18} />
        </span>
      ))}
      <span className="divider-v" />
      <span className="icon-btn" title="More tools">
        <Icon name="more" size={18} />
      </span>
    </div>
  );
}

/** The AI chat panel (canonical header: the chat's title, then New chat and Hide). */
export function AIPanel({
  chat,
  scope = 'Whole canvas',
  placeholder = 'Ask AI…',
  messages = [],
  children,
}: {
  chat: string;
  scope?: string;
  placeholder?: string;
  messages?: { from: 'you' | 'ai'; text: ReactNode }[];
  children?: ReactNode;
}) {
  return (
    <div className="island island--pad k-ai k-ai--chat">
      <div className="k-ai-hd k-ai-hd--chat">
        <Spark size={14} />
        <span className="k-ai-title">
          <span className="k-ai-title-t">{chat}</span>
          <Icon name="chevron" size={12} />
        </span>
        <span className="icon-btn k-icon-sm" title="New chat">
          <Icon name="plus" size={14} />
        </span>
        <span className="icon-btn k-icon-sm" title="Hide the AI chat panel">
          <Icon name="chevron" size={14} />
        </span>
      </div>
      <div className="k-ai-msgs k-ai-msgs--end">
        {messages.map((m) => (
          <p key={m.from + String(m.text)} className={`k-ai-msg k-ai-msg--${m.from}`}>
            {m.text}
          </p>
        ))}
        {children}
      </div>
      <div className="ask k-ask">
        <span className="chip chip--accent k-selchip">◆ {scope}</span>
        <span className="k-ask-in k-ask-ph">{placeholder}</span>
        <span className="send">
          <Spark size={12} color="var(--spark-fg)" />
        </span>
      </div>
    </div>
  );
}
