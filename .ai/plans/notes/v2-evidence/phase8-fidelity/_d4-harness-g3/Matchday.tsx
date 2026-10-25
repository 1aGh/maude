/**
 * @canvas   Matchday · a mixed-kind canvas (web hug, social post + story, A6 print, 16:9 video) for the phase-8 fidelity shots of 08/09.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, Img } from "remotion";

const MM = 96 / 25.4;
const PRINT = { paper: "a6", orientation: "portrait", bleedMm: 3 };
const GREEN = "#1f6f3a";

const Post = ({ w, h, title }: { w: number; h: number; title: string }) => (
  <div style={{ position: "relative", width: w, height: h, background: "#14201a", color: "#f2efe6", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>
    <img src="assets/0fce52c7.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }} />
    <div style={{ position: "absolute", left: 28, right: 28, bottom: 40 }}>
      <div style={{ fontSize: 14, letterSpacing: 2, color: "#9be3b0" }}>BRNO ALLIGATORS</div>
      <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.05, marginTop: 6 }}>{title}</div>
      <div style={{ marginTop: 10, fontSize: 16 }}>Sobota 14:00 · Lužánky</div>
    </div>
  </div>
);

const Reel = () => (
  <AbsoluteFill style={{ background: "#0e1a14" }}>
    <Img src="assets/0fce52c7.jpg" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: 24, color: "#fff", fontFamily: "system-ui", fontSize: 40, fontWeight: 800 }}>STAŇ SE ALLIGATOREM</AbsoluteFill>
  </AbsoluteFill>
);

export default function Matchday() {
  return (
    <DesignCanvas>
      <DCSection id="digital" title="Matchday · social">
        <DCArtboard id="post" label="Zápas · post 4:5" width={432} height={540}>
          <Post w={432} h={540} title="DERBY DNES" />
        </DCArtboard>
        <DCArtboard id="story" label="Zápas · story 9:16" width={304} height={540}>
          <Post w={304} h={540} title="DERBY DNES" />
        </DCArtboard>
      </DCSection>
      <DCSection id="print" title="Matchday · print">
        <DCArtboard id="a-front" kind="print" print={PRINT} label="A · přední (FLAG)" width={420} height={582}>
          <div style={{ position: "relative", width: 420, height: 582, background: GREEN, color: "#fff", fontFamily: "system-ui" }}>
            <h1 style={{ margin: 0, position: "absolute", left: 3 * MM + 20, top: 3 * MM + 30, fontSize: 28 }}>VYZKOUŠEJ FLAG</h1>
            <div style={{ position: "absolute", width: 22 * MM, height: 22 * MM, right: (3 + 2) * MM, bottom: (3 + 40) * MM, background: "#fff" }} />
          </div>
        </DCArtboard>
        <DCArtboard id="b-back" kind="print" print={PRINT} label="B · zadní (FLAG)" width={420} height={582}>
          <div style={{ width: 420, height: 582, boxSizing: "border-box", background: "#f2efe6", color: "#132038", padding: 3 * MM + 24, fontFamily: "system-ui" }}>Hraj s námi flag</div>
        </DCArtboard>
      </DCSection>
      <DCSection id="video" title="Matchday · video">
        <DCArtboard id="hype" kind="video" label="Hype trailer · 16:9" width={480} height={270}>
          <VideoComp component={Reel} durationInFrames={90} fps={30} width={480} height={270} />
        </DCArtboard>
      </DCSection>
      <DCSection id="web" title="Matchday · web">
        <DCArtboard id="nabor" kind="web" label="Nábor · web" width={834} height={581} padding={0}>
          <div style={{ fontFamily: "system-ui, sans-serif", background: "#fff", color: "#14201a" }}>
            <div style={{ height: 300, background: GREEN, color: "#fff", padding: 40, position: "relative", overflow: "hidden" }}>
              <img src="assets/0fce52c7.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35 }} />
              <h1 style={{ position: "relative", fontSize: 56, margin: 0 }}>Hraj flag s námi</h1>
              <p style={{ position: "relative", fontSize: 20 }}>Nábor 2027 · Brno Alligators</p>
            </div>
            {["Tréninky", "Tým", "Kontakt", "Často kladené otázky"].map((t) => (
              <section key={t} style={{ padding: "28px 40px", borderTop: "1px solid #e3e6e4" }}>
                <h2 style={{ margin: 0 }}>{t}</h2>
                <p style={{ maxWidth: 560 }}>Krátký popis sekce, aby stránka rostla s obsahem a bylo vidět, že artboard roste svisle.</p>
              </section>
            ))}
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
