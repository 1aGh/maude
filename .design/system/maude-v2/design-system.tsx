/**
 * @canvas Design system
 * @ds maude-v2
 *
 * The maude-v2 design system, as one canvas (V2-1.6 §5.2). Seven sections as artboards; each
 * renders the system's working files plus any change waiting in design-system.meta.json
 * (`dsPending`) through `@maude/ds/board`. Light | Dark in the bar is the system's own mode.
 * Edit a section in the app; nothing here holds a value — the tokens live in the system's files.
 */
import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
import { DSSection, DsBar, Specimen } from "@maude/ds/board";

export default function DesignSystem() {
  return (
    <DesignCanvas>
      <DsBar />
      <DCArtboard id="ds-brand" label="Brand" width={560} height={620}>
        <DSSection kind="brand" />
      </DCArtboard>
      <DCArtboard id="ds-colour" label="Colour" width={1000} height={620}>
        <DSSection kind="colour" />
      </DCArtboard>
      <DCArtboard id="ds-type" label="Type" width={600} height={620}>
        <DSSection kind="type" />
      </DCArtboard>
      <DCArtboard id="ds-space" label="Space & shape" width={680} height={560}>
        <DSSection kind="space" />
      </DCArtboard>
      <DCArtboard id="ds-motion" label="Motion" width={440} height={560}>
        <DSSection kind="motion" />
      </DCArtboard>
      <DCArtboard id="ds-components" label="Components" width={1040} height={560}>
        <DSSection kind="components" />
      </DCArtboard>
      <DCArtboard id="ds-patterns" label="Patterns" width={2256} height={440}>
        <DSSection kind="patterns" />
      </DCArtboard>
      <DCArtboard id="ds-own-iconography" label="Iconography" width={1440} height={900}>
        <Specimen src="preview/iconography.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-logo" label="Logo" width={1440} height={900}>
        <Specimen src="preview/logo.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-textures" label="Textures" width={1440} height={900}>
        <Specimen src="preview/textures.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-colors-accent" label="Colors accent" width={1440} height={900}>
        <Specimen src="preview/colors-accent.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-colors-presence" label="Colors presence" width={1440} height={900}>
        <Specimen src="preview/colors-presence.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-colors-status" label="Colors status" width={1440} height={900}>
        <Specimen src="preview/colors-status.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-colors-surfaces" label="Colors surfaces" width={1440} height={900}>
        <Specimen src="preview/colors-surfaces.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-colors-text" label="Colors text" width={1440} height={900}>
        <Specimen src="preview/colors-text.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-colors-themes-side-by-side" label="Colors themes side by side" width={1440} height={900}>
        <Specimen src="preview/colors-themes-side-by-side.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-focus" label="Focus" width={1440} height={900}>
        <Specimen src="preview/focus.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-opacity" label="Opacity" width={1440} height={900}>
        <Specimen src="preview/opacity.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-selection" label="Selection" width={1440} height={900}>
        <Specimen src="preview/selection.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-type-scale" label="Type scale" width={1440} height={900}>
        <Specimen src="preview/type-scale.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-borders" label="Borders" width={1440} height={900}>
        <Specimen src="preview/borders.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-elevation" label="Elevation" width={1440} height={900}>
        <Specimen src="preview/elevation.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-grid" label="Grid" width={1440} height={900}>
        <Specimen src="preview/grid.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-radii" label="Radii" width={1440} height={900}>
        <Specimen src="preview/radii.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-spacing-scale" label="Spacing scale" width={1440} height={900}>
        <Specimen src="preview/spacing-scale.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-motion" label="Motion" width={1440} height={900}>
        <Specimen src="preview/motion.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-buttons" label="Components buttons" width={1440} height={900}>
        <Specimen src="preview/components-buttons.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-callout" label="Components callout" width={1440} height={900}>
        <Specimen src="preview/components-callout.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-cards" label="Components cards" width={1440} height={900}>
        <Specimen src="preview/components-cards.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-command-palette" label="Components command palette" width={1440} height={900}>
        <Specimen src="preview/components-command-palette.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-dialogs" label="Components dialogs" width={1440} height={900}>
        <Specimen src="preview/components-dialogs.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-inputs" label="Components inputs" width={1440} height={900}>
        <Specimen src="preview/components-inputs.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-keyboard" label="Components keyboard" width={1440} height={900}>
        <Specimen src="preview/components-keyboard.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-list" label="Components list" width={1440} height={900}>
        <Specimen src="preview/components-list.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-resize-panels" label="Components resize panels" width={1440} height={900}>
        <Specimen src="preview/components-resize-panels.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-shortcuts-overlay" label="Components shortcuts overlay" width={1440} height={900}>
        <Specimen src="preview/components-shortcuts-overlay.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-status" label="Components status" width={1440} height={900}>
        <Specimen src="preview/components-status.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-tables" label="Components tables" width={1440} height={900}>
        <Specimen src="preview/components-tables.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-toast-menu" label="Components toast menu" width={1440} height={900}>
        <Specimen src="preview/components-toast-menu.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-toggles" label="Components toggles" width={1440} height={900}>
        <Specimen src="preview/components-toggles.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-components-tooltips" label="Components tooltips" width={1440} height={900}>
        <Specimen src="preview/components-tooltips.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-empty-state" label="Empty state" width={1440} height={900}>
        <Specimen src="preview/empty-state.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-skeletons" label="Skeletons" width={1440} height={900}>
        <Specimen src="preview/skeletons.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-ui-kits-desktop-index" label="Desktop index" width={1440} height={900}>
        <Specimen src="preview/ui_kits-desktop-index.tsx" />
      </DCArtboard>
      <DCArtboard id="ds-own-ui-kits-desktop-showcase" label="Desktop showcase" width={1440} height={900}>
        <Specimen src="preview/ui_kits-desktop-showcase.tsx" />
      </DCArtboard>
    </DesignCanvas>
  );
}
