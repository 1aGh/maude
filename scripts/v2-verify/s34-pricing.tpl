/**
 * @canvas   pricing · scratch pricing canvas for the verifier
 * @platform desktop
 */
import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Pricing() {
  return (
    <DesignCanvas>
      <DCSection id="pricing" title="Pricing" subtitle="Plans">
        <DCArtboard id="desktop" label="Desktop" kind="web" width={1200} height={800}>
          <div style={{ width: "100%", height: "100%", background: "#fff", color: "#111", fontFamily: "system-ui, sans-serif", padding: 48 }}>
            <h1 style={{ margin: 0, fontSize: 48 }}>Simple pricing</h1>
            <p>Pay monthly, or save 15 % with a year up front.</p>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
