import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

const card = (bg: string, dot: string, t: string, d: string) => (
  <div data-cd-id={`card-${t.split(" ")[0].toLowerCase()}`} style={{ flex: 1, background: bg, borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
    <span style={{ width: 12, height: 12, borderRadius: 6, background: dot }} />
    <strong style={{ fontSize: 17 }}>{t}</strong>
    <span style={{ fontSize: 13, color: "#555" }}>{d}</span>
  </div>
);

const Hero = ({ w }: { w: number }) => (
  <div style={{ width: w, background: "#fff", color: "#16181d", fontFamily: "system-ui, sans-serif", position: "relative" }}>
    <div data-cd-id="nav" style={{ display: "flex", alignItems: "center", gap: 28, padding: "20px 56px", fontSize: 14 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginRight: "auto" }}>
        <b style={{ width: 14, height: 14, borderRadius: 7, background: "#f7a38d", display: "inline-block" }} />Studio
      </span>
      <span>Work</span><span>Services</span><span>Pricing</span><span>About</span>
      <em data-cd-id="book" style={{ fontStyle: "normal", background: "#16181d", color: "#fff", padding: "8px 16px", borderRadius: 999 }}>Book a call</em>
    </div>
    <div style={{ display: "flex", gap: 40, padding: "48px 56px" }}>
      <div style={{ flex: 1 }}>
        <h1 data-cd-id="headline" style={{ fontSize: 56, lineHeight: 1.05, margin: 0, fontWeight: 650 }}>Calm software, made in Brno.</h1>
        <p data-cd-id="sub" style={{ fontSize: 17, color: "#555", maxWidth: 440 }}>A small studio for product and brand. Two designers, one developer, no rush.</p>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button data-cd-id="see-work" style={{ background: "#16181d", color: "#fff", border: 0, padding: "12px 22px", borderRadius: 999, fontSize: 15 }}>See the work</button>
          <button data-cd-id="see-pricing" style={{ background: "#fff", color: "#16181d", border: "1px solid #16181d", padding: "12px 22px", borderRadius: 999, fontSize: 15 }}>See pricing →</button>
        </div>
      </div>
      <div data-cd-id="hero-art" style={{ width: w * 0.42, height: 300, borderRadius: 16, background: "linear-gradient(#9fd3f2, #9fd3f2 55%, #84dba0 55%)", position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", right: 60, top: 40, width: 56, height: 56, borderRadius: 28, background: "#f6df74" }} />
      </div>
    </div>
    <div style={{ padding: "8px 56px 0" }}>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 12px" }}>What we do</p>
      <div data-cd-id="services" style={{ display: "flex", gap: 24 }}>
        {card("#fde3dc", "#f4947d", "Product design", "Apps and tools people enjoy using.")}
        {card("#dff3e4", "#5cc27d", "Brand systems", "Logos, type and colour that hold up.")}
        {card("#e9e4f7", "#9a86e0", "Small apps", "From sketch to the App Store in weeks.")}
      </div>
      <p style={{ fontSize: 13, color: "#555", margin: "40px 0 12px" }}>Selected work</p>
      <div style={{ display: "flex", gap: 24 }}>
        <i style={{ flex: 1, height: 150, background: "#dcdde1", borderRadius: 10 }} />
        <i style={{ flex: 1, height: 150, background: "#fbeaa8", borderRadius: 10 }} />
        <i style={{ flex: 1, height: 150, background: "#c9e4f7", borderRadius: 10 }} />
      </div>
    </div>
    <div data-cd-id="footer" style={{ marginTop: 56, background: "#16181d", color: "#fff", padding: "40px 56px", display: "flex", gap: 56, fontSize: 13 }}>
      <b style={{ marginRight: "auto" }}>Studio</b>
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}><strong>Studio</strong><span>Work</span><span>Services</span><span>Pricing</span></span>
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}><strong>Say hello</strong><span>hello@studio.cz</span><span>Kounicova 12, Brno</span></span>
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}><strong>A note when we ship something</strong><span style={{ background: "#2a2d35", padding: "8px 12px", borderRadius: 8 }}>your@email.cz</span></span>
    </div>
  </div>
);

export default function Homepage() {
  return (
    <DesignCanvas>
      <DCSection id="home" title="Homepage" subtitle="Desktop, tablet, mobile">
        <DCArtboard id="desktop" label="Desktop" width={1440} height={1000} kind="web">
          <Hero w={1440} />
        </DCArtboard>
        <DCArtboard id="tablet" label="Tablet" width={768} height={1000} kind="web">
          <div style={{ width: 768, background: "#fff", fontFamily: "system-ui, sans-serif", padding: 32, color: "#16181d" }}>
            <div style={{ height: 220, borderRadius: 16, background: "linear-gradient(#9fd3f2, #9fd3f2 55%, #84dba0 55%)" }} />
            <h1 style={{ fontSize: 40, margin: "24px 0 8px" }}>Calm software, made in Brno.</h1>
            <p style={{ color: "#555" }}>A small studio for product and brand.</p>
            <button style={{ background: "#16181d", color: "#fff", border: 0, padding: "12px 22px", borderRadius: 999 }}>See the work</button>
          </div>
        </DCArtboard>
        <DCArtboard id="mobile" label="Mobile" width={390} height={844} kind="web">
          <div style={{ width: 390, background: "#fff", fontFamily: "system-ui, sans-serif", padding: 20, color: "#16181d" }}>
            <div style={{ height: 150, borderRadius: 14, background: "linear-gradient(#9fd3f2, #9fd3f2 55%, #84dba0 55%)" }} />
            <h1 style={{ fontSize: 30, margin: "20px 0 8px" }}>Calm software, made in Brno.</h1>
            <button style={{ background: "#16181d", color: "#fff", border: 0, padding: "12px 22px", borderRadius: 999 }}>See the work</button>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
