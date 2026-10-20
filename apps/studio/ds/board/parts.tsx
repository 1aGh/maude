// Shared pieces of the Design system canvas sections (S10.6): the themed frame, the swatch, the
// lock. Everything is drawn with the SYSTEM's own tokens — a section is the user's design content,
// so the app's chrome tokens never reach it.

import { DSRoot } from '@maude/canvas-lib';
import type { ReactNode } from 'react';
import {
  type BoardMode,
  type BoardModel,
  type BoardToken,
  boardThemeCss,
  SECTIONS,
  type SectionKind,
  themeFor,
  usedWords,
} from './types.ts';

export const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ');

export interface SectionProps {
  model: BoardModel;
  mode: BoardMode;
}

/** How many tokens a section draws before it says "+ N more" (the artboard has a fixed size). */
export const CAP = { colour: 60, type: 14, space: 20, motion: 10, brand: 12 } as const;

/**
 * One section's frame: the system's `.ds[data-theme]` scope for the previewed mode, the
 * `.ds-dark` section class, and the board-scoped `<style>` that shows pending values "as edited".
 */
export function Frame({
  kind,
  model,
  mode,
  children,
}: {
  kind: SectionKind;
  model: BoardModel;
  mode: BoardMode;
  children: ReactNode;
}) {
  const theme = themeFor(model, mode);
  const overlay = boardThemeCss(model);
  // a section is drawn once at its real size (13's SECS); the artboard's content box has no
  // height of its own, so the section carries it
  const size = SECTIONS.find((s) => s.kind === kind);
  return (
    <DSRoot
      theme={theme}
      className={cx('ds-board', model.rootClass, mode === 'dark' && 'ds-dark')}
      data-ds-board={model.system}
      data-ds-section={kind}
      data-ds-mode={theme}
      data-testid={`ds-section-${kind}`}
      style={{ width: size?.w, height: size?.h }}
    >
      {overlay ? (
        <style data-ds-theme="" data-ds-pending={model.pendingCount ? '' : undefined}>
          {overlay}
        </style>
      ) : null}
      {children}
    </DSRoot>
  );
}

export function Lock() {
  return (
    <span
      className="ds-lock"
      role="img"
      aria-label="Brand colour — locked"
      title="Brand colour — locked"
    >
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <rect x="2" y="5.2" width="8" height="5.6" rx="1.2" fill="currentColor" />
        <path
          d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    </span>
  );
}

/** A swatch: Light | Dark halves, its name in words, where it is used. */
export function Swatch({ token, model }: { token: BoardToken; model: BoardModel }) {
  const { light, dark } = model.themes;
  const used = usedWords(token.used);
  const name = token.valueNames[light] ?? token.valueNames[model.themes.default] ?? null;
  const half = (theme: string, cls: string) => (
    <DSRoot
      as="span"
      theme={theme}
      className={cls}
      data-ds-mode={theme}
      style={{ background: `var(${token.css})` }}
    />
  );
  return (
    <span
      className="ds-sw"
      data-ds-token={token.css}
      data-ds-label={token.label}
      data-ds-kind={token.kind}
      data-locked={token.locked ? 'true' : undefined}
      data-pending={token.pending ? (token.pending.trashTo ? 'trash' : 'true') : undefined}
    >
      <i className="ds-chip">
        {half(light, 'ds-chip-l')}
        {dark ? half(dark, 'ds-chip-d') : null}
      </i>
      <b title={token.css}>
        {token.label}
        {token.locked ? <Lock /> : null}
      </b>
      {name ? <em>{name}</em> : null}
      {used ? <em>{used}</em> : null}
      {token.pending ? (
        <span className={cx('ds-flag', token.pending.trashTo && 'ds-flag--warn')}>
          {token.pending.trashTo ? 'Leaving' : token.pending.added ? 'New' : 'as edited'}
        </span>
      ) : null}
    </span>
  );
}

export function More({ n }: { n: number }) {
  return n > 0 ? <p className="ds-cap ds-more">+ {n} more in the files</p> : null;
}

export const GROUP_TITLES: Record<string, string> = {
  surfaces: 'Surfaces',
  text: 'Text',
  borders: 'Lines',
  accent: 'Accent',
  status: 'Status',
  presence: 'Presence',
  focus: 'Focus',
  selection: 'Selection',
  overlay: 'Overlays',
  palette: 'Palette',
  chart: 'Charts',
  brand: 'Brand',
  'accent-n': 'More accents',
  x: 'Extras',
  own: 'Own colours',
};
