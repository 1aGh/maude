// Ported once from .design/ui/v2/_kit.tsx on 2026-11-04; site/ is the source now.
// The app window and what sits on its canvas: Window, Canvas, Artboard, Sticky, Cursor.
import type { CSSProperties, ReactNode } from 'react';
import { Icon, Spark } from './glyphs';
import { Avatar, person, type Tone } from './people';

export type Tab = {
  name: string;
  initial?: string;
  color?: Tone;
  account?: string;
  home?: boolean;
};

export const TABS = {
  studio: { name: 'Studio site', initial: 'S', color: 'yellow', account: 'You' } as Tab,
  alligators: {
    name: 'Alligators brand',
    initial: 'A',
    color: 'lilac',
    account: 'Alligators',
  } as Tab,
};

/** One role="img" picture of the app: everything inside is presentational. */
export function Window({
  tabs = [TABS.studio, TABS.alligators],
  activeTab = 0,
  height = 900,
  label,
  children,
}: {
  tabs?: Tab[];
  activeTab?: number;
  height?: number;
  label?: string;
  children?: ReactNode;
}) {
  const act = tabs[activeTab];
  return (
    <div
      className="k-window"
      role="img"
      aria-label={label ?? `Maude, ${act?.name ?? 'Home'}`}
      style={{ height }}
    >
      <div className="k-titlebar">
        <span className="k-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="k-tabs">
          {tabs.map((t, i) => {
            const on = i === activeTab;
            return (
              <span
                key={t.name}
                className="k-tab"
                data-on={on ? 'true' : undefined}
                title={t.account ? `${t.name}, works as ${t.account}` : t.name}
              >
                {on ? (
                  <span className="k-tab-x">
                    <Icon name="close" size={10} />
                  </span>
                ) : null}
                {t.home ? (
                  <span className="k-tab-home">
                    <Icon name="home" size={13} />
                  </span>
                ) : (
                  <Avatar ini={t.initial ?? t.name.slice(0, 1)} tone={t.color ?? 'sky'} size="sm" />
                )}
                <span className="k-tab-name">{t.name}</span>
              </span>
            );
          })}
        </span>
        <span className="k-tab-add">
          <Icon name="plus" size={13} />
        </span>
      </div>
      <div className="k-body">{children}</div>
    </div>
  );
}

export function Canvas({ children }: { children?: ReactNode }) {
  return <div className="k-canvas k-canvas--dots">{children}</div>;
}

export type Kind = 'web' | 'digital';

/** A mock artboard: label above (+ kind glyph) and a quiet "Made by AI" mark once the AI is done. */
export function Artboard({
  label,
  w,
  h,
  x,
  y,
  aiMade,
  kind,
  children,
}: {
  label: string;
  w: number;
  h: number;
  x: number;
  y: number;
  aiMade?: boolean | string;
  kind?: Kind;
  children?: ReactNode;
}) {
  return (
    <div className="k-ab" style={{ left: x, top: y, width: w, height: h }}>
      <span className="k-ab-name" title={label}>
        {kind ? <Icon name={kind} size={11} /> : null}
        <span className="k-ab-label">{label}</span>
      </span>
      {/* The page is the user's design: pinned to its own light palette. */}
      <div className="k-ab-page mdcc-pin-light k-fixed">{children}</div>
      {aiMade ? (
        <span className="k-ab-made" title={typeof aiMade === 'string' ? aiMade : 'Made by AI'}>
          <Spark size={9} />
          {w >= 150 ? (typeof aiMade === 'string' ? aiMade : 'Made by AI') : null}
        </span>
      ) : null}
    </div>
  );
}

export function Sticky({
  color = 'yellow',
  children,
  x,
  y,
  rotate = 0,
  w,
  style,
}: {
  color?: Exclude<Tone, 'grey'>;
  children: ReactNode;
  x: number;
  y: number;
  rotate?: number;
  w?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`sticky sticky--${color} k-sticky`}
      style={{ left: x, top: y, rotate: `${rotate}deg`, width: w, ...style }}
    >
      {children}
    </div>
  );
}

function CursorArrow({ agent = false, tone = 'sky' }: { agent?: boolean; tone?: Tone }) {
  const fill = agent ? 'var(--presence-agent)' : `var(--object-${tone})`;
  const edge = agent ? 'var(--bg-2)' : 'var(--object-ink)';
  return (
    <svg className="k-ic" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2l9 4.4-4 1.1-1.1 4z"
        fill={fill}
        stroke={edge}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A collaborator's pointer; `agent` is the spark-coloured AI cursor. */
export function Cursor({
  name,
  color,
  x,
  y,
  agent = false,
  label,
  style,
}: {
  name?: string;
  color?: Tone;
  x: number;
  y: number;
  agent?: boolean;
  label?: string;
  style?: CSSProperties;
}) {
  const p = name ? person(name) : undefined;
  const tone = color ?? p?.tone ?? 'sky';
  return (
    <span className="k-cur" style={{ left: x, top: y, ...style }}>
      <CursorArrow agent={agent} tone={tone} />
      <span className={`k-cur-tag ${agent ? 'k-cur-tag--ai motion-soft' : `k-cur-tag--${tone}`}`}>
        {agent ? <Spark size={10} color="var(--spark-fg)" /> : null}
        {label ?? (agent ? 'AI' : p?.name)}
      </span>
    </span>
  );
}
