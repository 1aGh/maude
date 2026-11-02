// Patterns: real screens built from the system (board 13). The screens are the showcases the system kept
// as their own artboards on this canvas (`<Specimen src>` — one unit with the board, so the frame's
// capability already covers them): each is drawn live here, scaled, with its name. No picture route —
// a picture of another canvas would be a thing the frame was never granted. A system with no showcase
// starts with none (V2-1.6 §5.2); the canvases that follow it are the patterns until a person pins one.

import { DSRoot } from '@maude/canvas-lib';
import { Component, type ComponentType, type ReactNode } from 'react';
import { ownLabel, sectionOf } from '../convert-map.ts';
import { Frame, type SectionProps } from './parts.tsx';
import { getSpecimen, getSpecimenSrcs } from './state.ts';
import { themeFor } from './types.ts';

const TILES_MAX = 5;

class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const stemOf = (src: string): string => (src.split('/').pop() ?? src).replace(/\.tsx$/, '');

/** `preview/ui_kits-desktop-showcase.tsx` → "Desktop showcase" */
const nameOf = (src: string): string => ownLabel(stemOf(src));

/**
 * The screens Patterns shows: the kept pages no other section claims (showcases, kits). Since every
 * specimen page is its own artboard (decision `v2-michal-ds-specimens-own-artboards`), the board also
 * registers `colors-accent`, `logo`… — those belong to their own sections, never here.
 */
export const patternSrcs = (srcs: readonly string[]): string[] =>
  srcs.filter((s) => sectionOf(stemOf(s)) === null).slice(0, TILES_MAX);

export function PatternsSection({ model, mode }: SectionProps) {
  const n = model.canvases;
  const srcs = patternSrcs(getSpecimenSrcs());
  const theme = themeFor(model, mode);
  return (
    <Frame kind="patterns" model={model} mode={mode}>
      <div className="ds-pad ds-pats">
        {srcs.length ? (
          <div className="ds-pats-row">
            {srcs.map((src) => {
              const mod = getSpecimen(src) as
                | { default?: ComponentType }
                | ComponentType
                | undefined;
              const Comp = (typeof mod === 'function' ? mod : mod?.default) as
                | ComponentType
                | undefined;
              return (
                <div
                  key={src}
                  className="ds-pat"
                  data-testid="ds-pattern-tile"
                  data-ds-specimen={src}
                >
                  <div className="ds-pat-screen" aria-hidden="true">
                    <DSRoot theme={theme} className="ds-board ds-specimen ds-pat-inner">
                      {Comp ? (
                        <Guard>
                          <Comp />
                        </Guard>
                      ) : null}
                    </DSRoot>
                  </div>
                  <b>{nameOf(src)}</b>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ds-empty">
            <b>No patterns yet</b>
            <span>
              Screens built from {model.label} show up here.
              {n ? ` ${n} ${n === 1 ? 'canvas follows' : 'canvases follow'} it.` : ''}
            </span>
          </p>
        )}
      </div>
    </Frame>
  );
}
