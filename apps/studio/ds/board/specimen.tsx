// `<Specimen src="preview/x.tsx" />` — a specimen page kept as it is, drawn inside an artboard of
// the Design system canvas (S10.6; 29 `ds-edge-migrate`: showcases stay as their own artboards).
//
// The specimen's module is imported by the generated `@maude/ds/board` module — it scans the
// canvas source for `<Specimen src="…">` literals and imports each one, inside the design root
// like any tenant import — and registered here by its `src`. A specimen that is not registered
// (or throws) shows a quiet placeholder; it never takes the canvas down.
//
// r4 #6: a specimen carries the system's own `rootClass` and `ds-dark` exactly as a section does (parts.tsx
// `Section`). Without them the system's `.<root>[data-theme]` token blocks never matched this wrapper, so a
// specimen page stayed in Light while the seven sections switched.

import { DSRoot, useArtboardSeen } from '@maude/canvas-lib';
import { Component, type ComponentType, type ReactNode } from 'react';
import { getSpecimen, useBoardMode, useBoardModel } from './state.ts';
import { themeFor } from './types.ts';

class Guard extends Component<{ src: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <Missing src={this.props.src} why="could not be drawn" />
    ) : (
      this.props.children
    );
  }
}

function Missing({ src, why }: { src: string; why: string }) {
  return (
    <div className="ds-board ds-specimen-missing" data-ds-specimen={src}>
      <p className="ds-empty">
        <b>{src.split('/').pop()}</b>
        <span>This specimen {why}.</span>
      </p>
    </div>
  );
}

export function Specimen({ src, mode: modeProp }: { src: string; mode?: 'light' | 'dark' }) {
  const model = useBoardModel();
  const stored = useBoardMode();
  // 2.0.5 — a specimen page mounts once its artboard first comes near the viewport (a board of 58 built
  // every page at open). The artboard keeps its size meanwhile; captures and exports mount all of them.
  const seen = useArtboardSeen();
  const mode = modeProp ?? stored;
  // 2.0.7 — the pending page carries the system's root class and theme like the page itself: without them its
  // `var(--bg-1)` fell back to the `Canvas` system colour, which in a dark scheme is a black box.
  if (!seen)
    return (
      <DSRoot
        theme={model ? themeFor(model, mode) : undefined}
        className={`ds-board ds-specimen ds-specimen-pending${model?.rootClass ? ` ${model.rootClass}` : ''}${mode === 'dark' ? ' ds-dark' : ''}`}
        data-ds-specimen={src}
        aria-hidden="true"
      />
    );
  const mod = getSpecimen(src) as { default?: ComponentType } | ComponentType | undefined;
  const Comp = (typeof mod === 'function' ? mod : mod?.default) as ComponentType | undefined;
  if (!Comp) return <Missing src={src} why="is not loaded" />;
  return (
    <DSRoot
      theme={model ? themeFor(model, mode) : undefined}
      className={`ds-board ds-specimen${model?.rootClass ? ` ${model.rootClass}` : ''}${mode === 'dark' ? ' ds-dark' : ''}`}
      data-ds-specimen={src}
    >
      <Guard src={src}>
        <Comp />
      </Guard>
    </DSRoot>
  );
}
