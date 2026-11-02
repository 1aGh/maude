import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Landing() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Landing page">
        <DCArtboard id="desktop" label="Desktop" width={900} height={560}>
          <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 16, background: "var(--bg-1)", color: "var(--fg-0)", height: "100%" }}>
            <h2 style={{ margin: 0 }}>Calm software, made in Brno.</h2>
            <p style={{ color: "var(--fg-1)" }}>A small studio for product and brand.</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button data-cd-id="cta" style={{ background: "var(--accent)", color: "#fff", border: 0, padding: "10px 18px", borderRadius: 8 }}>See the work</button>
              <button data-cd-id="nav" style={{ background: "var(--bg-3)", color: "var(--fg-1)", border: 0, padding: "10px 18px", borderRadius: 8 }}>Pricing</button>
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
