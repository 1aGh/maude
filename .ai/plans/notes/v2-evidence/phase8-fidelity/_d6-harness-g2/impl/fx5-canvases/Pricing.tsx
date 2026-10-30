import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Pricing() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Pricing">
        <DCArtboard id="desktop" label="Desktop" width={900} height={560}>
          <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 16, background: "var(--bg-1)", color: "var(--fg-0)", height: "100%" }}>
            <h2 style={{ margin: 0 }}>Simple pricing</h2>
            <p style={{ color: "var(--fg-1)" }}>One price, no rush.</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button data-cd-id="buy" style={{ background: "var(--accent)", color: "#fff", border: 0, padding: "10px 18px", borderRadius: 8 }}>Buy</button>
              <button data-cd-id="talk" style={{ background: "var(--bg-3)", color: "var(--fg-1)", border: 0, padding: "10px 18px", borderRadius: 8 }}>Talk to us</button>
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
