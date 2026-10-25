import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

const PHOTO = "assets/9a1f3c5e.jpg";
const Photo = ({ w, h, style }: { w: number; h: number; style?: React.CSSProperties }) => (
  <img data-cd-id="photo" alt="Hráč" src={PHOTO} width={w} height={h} style={{ position: "absolute", objectFit: "cover", ...style }} />
);

const FONT = "'Avenir Next Condensed', 'Arial Narrow', system-ui, sans-serif";
type P = { t1: string; t2: string; sub: string; btn: string };
const Post = ({ t1, t2, sub, btn }: P) => (
  <div style={{ position: "relative", width: 1080, height: 1080, background: "#123524", color: "#fff", fontFamily: FONT, overflow: "hidden" }}>
    <svg data-cd-id="mark" width="72" height="72" viewBox="0 0 72 72" style={{ position: "absolute", left: 64, top: 64 }}><path d="M8 60 L36 8 L64 60 Z" fill="#f6c915" /></svg>
    <div data-cd-id="date-bg" style={{ position: "absolute", left: 52, top: 704, width: 600, height: 64, background: "#1f4d36", borderRadius: "4px 20px 4px 4px" }} />
    <h1 data-cd-id="title" data-dc-element="Titulek" lang="cs" className="t-title" style={{ position: "absolute", left: 64, top: 330, margin: 0, fontSize: 132, lineHeight: 0.95, fontWeight: 800, letterSpacing: 1, whiteSpace: "pre-line" }}>{t1 + "\n" + t2}</h1>
    <p data-cd-id="date" style={{ position: "absolute", left: 64, top: 712, margin: 0, fontSize: 30, width: 560 }}>{sub}</p>
    <button data-cd-id="cta" style={{ position: "absolute", left: 64, top: 880, background: "#f6c915", color: "#123524", border: 0, padding: "22px 44px", fontSize: 34, fontWeight: 800, borderRadius: 6 }}>{btn}</button>
    <Photo w={460} h={720} style={{ right: 0, bottom: 0 }} />
    <div data-cd-id="podklad" data-dc-element="Podklad" data-shape="rectangle" style={{ position: "absolute", right: 48, top: 48, width: 248, height: 248, background: "#f6c915", borderRadius: "40px 40px 8px 40px" }} />
    <div data-cd-id="datum" data-dc-element="Datum" style={{ position: "absolute", right: 64, top: 64, width: 216, height: 216, textAlign: "center", color: "#123524", fontWeight: 800, fontSize: 56, lineHeight: "216px" }}>
      <span data-cd-id="datum-text">SO 14/3</span>
    </div>
  </div>
);

const Story = ({ t1, t2, sub, btn }: P) => (
  <div style={{ position: "relative", width: 1080, height: 1920, background: "#123524", color: "#fff", fontFamily: FONT, overflow: "hidden" }}>
    <Photo w={1080} h={1000} style={{ left: 0, top: 0 }} />
    <h1 style={{ position: "absolute", left: 64, top: 1060, margin: 0, fontSize: 150, lineHeight: 0.95, fontWeight: 800, whiteSpace: "pre-line" }}>{t1 + "\n" + t2}</h1>
    <p style={{ position: "absolute", left: 64, top: 1420, margin: 0, fontSize: 36, width: 800 }}>{sub}</p>
    <button style={{ position: "absolute", left: 64, top: 1600, background: "#f6c915", color: "#123524", border: 0, padding: "26px 56px", fontSize: 40, fontWeight: 800, borderRadius: 6 }}>{btn}</button>
    <span style={{ position: "absolute", right: 64, top: 64, background: "#f6c915", color: "#123524", padding: "10px 18px", fontWeight: 800, fontSize: 32 }}>SO 14/3</span>
  </div>
);

export default function CombineKampan() {
  return (
    <DesignCanvas>
      <DCSection id="posts" title="Posts" subtitle="Post 1:1">
        <DCArtboard id="p1" label="Post 1:1 · Combine 2026" width={1080} height={1080}>
          <Post t1="COMBINE" t2="2026" sub="So 14. 3. · Brno, Kraví hora" btn="ZAPIŠ SE" />
        </DCArtboard>
        <DCArtboard id="p2" label="Post 1:1 · Zapiš se" width={1080} height={1080}>
          <div style={{ position: "relative", width: 1080, height: 1080, background: "#123524", color: "#fff", fontFamily: FONT, overflow: "hidden" }}>
    <svg data-cd-id="mark" width="72" height="72" viewBox="0 0 72 72" style={{ position: "absolute", left: 64, top: 64 }}><path d="M8 60 L36 8 L64 60 Z" fill="#f6c915" /></svg>
    <div data-cd-id="date-bg" style={{ position: "absolute", left: 52, top: 704, width: 600, height: 64, background: "#1f4d36", borderRadius: "4px 20px 4px 4px" }} />
    <h1 data-cd-id="title" data-dc-element="Titulek" lang="cs" className="t-title" style={{ position: "absolute", left: 64, top: 330, margin: 0, fontSize: 132, lineHeight: 0.95, fontWeight: 800, letterSpacing: 1, width: 640 }}>STAŇ SE GATOREM</h1>
    <p data-cd-id="date" lang="cs" style={{ position: "absolute", left: 64, top: 712, margin: 0, fontSize: 30, width: 560 }}>Přijď na Combine v sobotu 14. 3. — s kamarády i bez zkušeností.</p>
    <button data-cd-id="cta" style={{ position: "absolute", left: 64, top: 880, background: "#f6c915", color: "#123524", border: 0, padding: "22px 44px", fontSize: 34, fontWeight: 800, borderRadius: 6 }}>ZAPIŠ SE</button>
    <img data-cd-id="foto" data-dc-element="Hráč · foto" alt="Hráč" src="assets/9a1f3c5e.jpg" width={460} height={720} style={{ position: "absolute", right: 0, bottom: 0, objectFit: "cover" }} />
    <div data-cd-id="podklad" data-dc-element="Podklad" data-shape="rectangle" style={{ position: "absolute", right: 64, top: 64, width: 216, height: 216, background: "#f6c915", borderRadius: "40px 40px 8px 40px" }} />
    <div data-cd-id="datum" data-dc-element="Datum" style={{ position: "absolute", right: 64, top: 64, width: 216, height: 216, display: "flex", alignItems: "center", justifyContent: "center", color: "#123524", fontWeight: 800, fontSize: 56, lineHeight: 1 }}>
      <span data-cd-id="datum-text">SO 14/3</span>
    </div>
  </div>
        </DCArtboard>
        <DCArtboard id="p3" label="Post 1:1 · Combine v číslech" width={1080} height={1080}>
          <Post t1="COMBINE" t2="V ČÍSLECH" sub="86 hráčů · 11 trenérů · 4,62 s na 40 yardů" btn="VÝSLEDKY" />
        </DCArtboard>
        <DCArtboard id="p4" label="Post 1:1 · Trenéři" width={1080} height={1080}>
          <Post t1="TRENÉŘI" t2="2026" sub="Jedenáct trenérů, čtyři pozice, jeden tým." btn="POZNEJ JE" />
        </DCArtboard>
      </DCSection>
      <DCSection id="stories" title="Stories" subtitle="Story 9:16">
        <DCArtboard id="s1" label="Story 9:16 · Zapiš se" width={1080} height={1920}>
          <Story t1="STAŇ SE" t2="GATOREM" sub="Přijď na Combine v sobotu 14. 3." btn="ZAPIŠ SE" />
        </DCArtboard>
        <DCArtboard id="s2" label="Story 9:16 · Odpočet 7 dní" width={1080} height={1920}>
          <Story t1="UŽ ZA" t2="7 DNÍ" sub="Combine 2026 · So 14. 3. · Kraví hora" btn="ZAPIŠ SE" />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
