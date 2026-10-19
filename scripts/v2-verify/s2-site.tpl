/**
 * @canvas   site · scratch homepage for the S2.V verifier
 * @platform desktop
 */
import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

const CARDS = [
  { key: "one", title: "Brand systems", body: "Tokens, type and a kit that ship together." },
  { key: "two", title: "Product design", body: "From the first flow to the last detail." },
  { key: "three", title: "Motion", body: "Short, honest, never decorative." },
];

function Home() {
  return (
    <div style={{ width: "100%", background: "#ffffff", color: "#111", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 48px", background: "#f4f4f2" }}>
        <b>Studio</b>
        <nav style={{ display: "flex", gap: 24 }}>
          <span>Work</span>
          <span>Services</span>
          <span>About</span>
        </nav>
      </header>
      <section style={{ padding: "64px 48px" }}>
        <h1 style={{ margin: 0, fontSize: 56 }}>Jedeme v zeleném. Pro klub, ve vlaku a o víkendu.</h1>
        <p style={{ margin: "16px 0 0", fontSize: 18 }}>Studio pro značky, které chtějí vypadat jako samy sebou.</p>
        <a style={{ display: "inline-block", marginTop: 24, padding: "12px 20px", background: "#111", color: "#fff", borderRadius: 10 }}>Book a call</a>
      </section>
      <section style={{ display: "flex", gap: 24, padding: "0 48px 64px" }}>
        {CARDS.map((c) => (
          <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24, flex: 1, background: "#f4f4f2", borderRadius: 14 }}>
            <h3 style={{ margin: 0 }}>{c.title}</h3>
            <p style={{ margin: 0 }}>{c.body}</p>
          </div>
        ))}
      </section>
      <section style={{ display: "flex", gap: 24, padding: "0 48px 64px" }}>
        {[1, 2, 3].map((n) => (
          <div key={n} style={{ flex: 1, height: 420, background: n === 2 ? "#fbeab8" : "#d8dde2", borderRadius: 14 }} />
        ))}
      </section>
      <img alt="" src="/.design/assets/pic.png" style={{ display: "block", width: 320, height: 200, margin: "0 48px 64px", objectFit: "cover" }} />
      <footer style={{ padding: "32px 48px", background: "#111", color: "#fff" }}>Studio — Praha</footer>
    </div>
  );
}

export default function Site() {
  return (
    <DesignCanvas>
      <DCSection id="site" title="Studio site" subtitle="Homepage">
        <DCArtboard id="desktop" label="Desktop" kind="web" width={1440} height={1573}>
        <div style={{ width: "100%", background: "#ffffff", color: "#111", fontFamily: "system-ui, sans-serif" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 48px", background: "#f4f4f2" }}>
            <b>Studio</b>
            <nav style={{ display: "flex", gap: 24 }}>
              <span>Work</span>
              <span>Services</span>
              <span>About</span>
            </nav>
          </header>
          <section style={{ padding: "64px 48px" }}>
            <h1 style={{ margin: 0, fontSize: 56 }}>Jedeme v zeleném. Pro klub, ve vlaku a o víkendu.</h1>
            <p style={{ margin: "16px 0 0", fontSize: 18 }}>Studio pro značky, které chtějí vypadat jako samy sebou.</p>
            <a style={{ display: "inline-block", marginTop: 24, padding: "12px 20px", background: "#111", color: "#fff", borderRadius: 10 }}>Book a call</a>
          </section>
          <section style={{ display: "flex", gap: 24, padding: "0 48px 64px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24, flex: 1, background: "#f4f4f2", borderRadius: 14 }}>
              <h3 style={{ margin: 0 }}>Brand systems</h3>
              <p style={{ margin: 0 }}>Tokens, type and a kit that ship together.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24, flex: 1, background: "#f4f4f2", borderRadius: 14 }}>
              <h3 style={{ margin: 0 }}>Product design</h3>
              <p style={{ margin: 0 }}>From the first flow to the last detail.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 24, flex: 1, background: "#f4f4f2", borderRadius: 14 }}>
              <h3 style={{ margin: 0 }}>Motion</h3>
              <p style={{ margin: 0 }}>Short, honest, never decorative.</p>
            </div>
          </section>
          <section style={{ display: "flex", gap: 24, padding: "0 48px 64px" }}>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ flex: 1, height: 420, background: n === 2 ? "#fbeab8" : "#d8dde2", borderRadius: 14 }} />
            ))}
          </section>
          <img alt="" src="/.design/assets/pic.png" style={{ display: "block", width: 320, height: 200, margin: "0 48px 64px", objectFit: "cover" }} />
          <footer style={{ padding: "32px 48px", background: "#111", color: "#fff" }}>Studio — Praha</footer>
        </div>
        </DCArtboard>
        <DCArtboard id="laptop" label="Laptop" kind="web" width={1280} height={1573}>
          <Home />
        </DCArtboard>
        <DCArtboard id="tablet" label="Tablet" kind="web" width={834} height={1573}>
          <Home />
        </DCArtboard>
        <DCArtboard id="mobile" label="Mobile" kind="web" width={390} height={1573}>
          <Home />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
