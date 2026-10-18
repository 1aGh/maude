/**
 * @canvas Design system
 * @ds {{ds}}
 *
 * The {{label}} design system, as one canvas (V2-1.6 §5.2). Seven sections as artboards; each
 * renders the system's working files plus any change waiting in design-system.meta.json
 * (`dsPending`) through `@maude/ds/board`. Light | Dark in the bar is the system's own mode.
 * Edit a section in the app; nothing here holds a value — the tokens live in the system's files.
 */
import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
import { DSSection, DsBar } from "@maude/ds/board";

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
    </DesignCanvas>
  );
}
