/**
 * @canvas   site · scratch canvas for the S3.V2 / S4.V verifier (links, mixed kinds, video, print)
 * @platform desktop
 */
import { DCArtboard, DCSection, DesignCanvas, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, useCurrentFrame } from "remotion";

function Reel() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#132038", color: "#f2efe6", justifyContent: "center", alignItems: "center" }}>
      <div style={{ fontSize: 64 }}>{f}</div>
    </AbsoluteFill>
  );
}

export default function Site() {
  return (
    <DesignCanvas>
      <DCSection id="site" title="Studio site" subtitle="Homepage">
        <DCArtboard id="home" label="Homepage" kind="web" width={1200} height={900} fixed>
          <div style={{ width: "100%", minHeight: "100%", background: "#fff", color: "#111", fontFamily: "system-ui, sans-serif" }}>
            <header style={{ display: "flex", justifyContent: "space-between", padding: "16px 48px", background: "#f4f4f2" }}>
              <b>Studio</b>
              <nav style={{ display: "flex", gap: 24 }}><span>Work</span><span>Pricing</span><span>About</span></nav>
            </header>
            <section style={{ padding: "64px 48px" }}>
              <h1 style={{ margin: 0, fontSize: 56 }}>Jedeme v zeleném.</h1>
              <p style={{ margin: "16px 0 0", fontSize: 18 }}>Studio pro značky, které chtějí vypadat jako samy sebou.</p>
              <a data-cd-id="book-a-call" data-cd-link="ui/Pricing.tsx#desktop" style={{ display: "inline-block", marginTop: 24, padding: "12px 20px", background: "#111", color: "#fff", borderRadius: 10 }}>Book a call</a>
              <a data-cd-id="ext-link" data-cd-link="https://cal.com/studio" style={{ display: "inline-block", marginTop: 24, marginLeft: 12, padding: "12px 20px", background: "#eee", color: "#111", borderRadius: 10 }}>Schedule</a>
            </section>
            <section style={{ display: "flex", gap: 24, padding: "0 48px" }}>
              {[1, 2, 3].map((n) => (<div key={n} style={{ flex: 1, height: 260, background: n === 2 ? "#fbeab8" : "#d8dde2", borderRadius: 14 }} />))}
            </section>
            <section style={{ height: 1400, padding: 48 }}><h2>Below the fold</h2><p>The page keeps going.</p></section>
          </div>
        </DCArtboard>
        <DCArtboard id="pricing" label="Pricing" kind="web" width={1200} height={900}>
          <div style={{ width: "100%", height: "100%", background: "#fff", color: "#111", fontFamily: "system-ui, sans-serif", padding: 48 }}>
            <h1 style={{ margin: 0, fontSize: 48 }}>Pricing</h1>
            <p>Three plans. No surprises.</p>
          </div>
        </DCArtboard>
        <DCArtboard id="mobile" label="Mobile" kind="web" width={390} height={844}>
          <div style={{ width: "100%", height: "100%", background: "#fff", color: "#111", fontFamily: "system-ui, sans-serif", padding: 24 }}>
            <h2 style={{ margin: 0 }}>Jedeme v zeleném.</h2>
            <a data-cd-id="m-book" style={{ display: "inline-block", marginTop: 16, padding: "10px 16px", background: "#111", color: "#fff", borderRadius: 8 }}>Book a call</a>
          </div>
        </DCArtboard>
        <DCArtboard id="reel" label="Reel" kind="video" width={540} height={960}>
          <VideoComp component={Reel} durationInFrames={180} fps={12} width={540} height={960} />
        </DCArtboard>
        <DCArtboard id="poster" label="A4 poster" kind="print" width={595} height={842}>
          <div style={{ width: "100%", height: "100%", background: "#fffbe8", color: "#111", padding: 40, fontFamily: "Georgia, serif" }}>
            <h1 style={{ fontSize: 44 }}>Alligators</h1><p>Combine 2026</p>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
