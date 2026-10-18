// `@maude/ds/board` — the Design system canvas's vocabulary (S10.6, V2-1.6 §5.2):
//
//   <DSSection kind="brand|colour|type|space|motion|components|patterns" />   one section artboard
//   <Specimen src="preview/…tsx" />                                           a kept specimen page
//   <DsBar />                                                                  name · Light | Dark · waiting
//
// A canvas imports it as `@maude/ds/board`. The per-canvas generated module (ds/ds-resolver.ts)
// re-exports this file and registers the system's `BoardModel` (working files + `dsPending` +
// usage), so a section renders "the system as edited" with no route and no props. Tests pass
// `model` / `mode` directly.

import { BrandSection } from './section-brand.tsx';
import { ColourSection } from './section-colour.tsx';
import { ComponentsSection } from './section-components.tsx';
import { MotionSection } from './section-motion.tsx';
import { PatternsSection } from './section-patterns.tsx';
import { SpaceSection } from './section-space.tsx';
import { TypeSection } from './section-type.tsx';
import { listenForThemePreview, useBoardMode, useBoardModel } from './state.ts';
import type { BoardMode, BoardModel, SectionKind } from './types.ts';
import './board.css';

// the parent's `ds.set-theme-preview` message and `?dsMode=` — wired once, when the canvas loads
listenForThemePreview();

export { DsBar, DsBarView, waitingWords } from './ds-bar.tsx';
export { Specimen } from './specimen.tsx';
export { __registerBoardModel, setBoardMode } from './state.ts';
export { type BoardModel, SECTIONS, type SectionKind } from './types.ts';

const BODY = {
  brand: BrandSection,
  colour: ColourSection,
  type: TypeSection,
  space: SpaceSection,
  motion: MotionSection,
  components: ComponentsSection,
  patterns: PatternsSection,
} as const;

export function DSSection({
  kind,
  model,
  mode,
}: {
  kind: SectionKind;
  model?: BoardModel;
  mode?: BoardMode;
}) {
  const registered = useBoardModel();
  const stored = useBoardMode();
  const m = model ?? registered;
  const Body = BODY[kind];
  if (!m || !Body) {
    return (
      <div className="ds-board ds-empty-board" data-ds-section={kind}>
        <p className="ds-empty">
          <b>No design system here</b>
          <span>This canvas names no system the project knows.</span>
        </p>
      </div>
    );
  }
  return <Body model={m} mode={mode ?? stored} />;
}
