import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

// Funky white agency hero: engine-drawn organic-blob background (dot-grid +
// blobs on a dynamic-symmetry armature, harmonized palette) with the hero text
// seated in the calm left quadrant (blobs occupy the right → balanced).
const BG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 1200 800"><defs><pattern id="a" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#16161c" opacity=".1"/></pattern><filter id="b"><feTurbulence baseFrequency=".85" numOctaves="2" result="noise" stitchTiles="stitch" type="fractalNoise"/><feColorMatrix in="noise" type="saturate" values="0"/><feComponentTransfer><feFuncA slope=".14" type="linear"/></feComponentTransfer></filter></defs><path fill="#fcfaf6" d="M0 0h1200v800H0z"/><path fill="url(#a)" d="M0 0h1200v800H0z"/><path fill="#008fe6" d="M991.8 424.85c6.1 47.35 12.28 146.4-24.34 173.84s-159 19.71-195.39-9.26c-36.38-28.98-24.46-112.42-22.9-164.58s1.99-130 32.25-148.39 114.29 13.37 149.35 38.1 54.9 62.93 61.02 110.29"/><path fill="#ecbf00" d="M926.3 375.16c.58 24.21-13.44 53.94-31 74.38s-47.72 46.36-74.4 48.24c-26.66 1.88-63.54-16.53-85.64-36.97s-49.33-59.48-46.96-85.66c2.38-26.17 39.09-51.06 61.19-71.41s47.7-50.77 71.42-50.68 53.34 30.84 70.9 51.2c17.57 20.34 33.91 46.68 34.5 70.9"/><path fill="#e84e5f" d="M1058.75 375.16c-1.96 46.85-42.33 84.3-85.43 133.2s-131.98 171.07-173.2 160.19c-41.2-10.88-53.3-161.2-74.08-225.47-20.77-64.28-66.35-115.06-50.56-160.2 15.8-45.13 93.7-101.33 145.3-110.6 51.6-9.28 124.64 21.11 164.3 54.93 39.66 33.8 75.63 101.09 73.67 147.94"/><path fill="#0079ce" d="M1093.22 315.15c-3.54 40.02-18.4 81.95-47.46 101.63-29.05 19.68-95.1 33.4-126.84 16.46s-62.5-76.77-63.63-118.09c-1.13-41.31 21.55-106.75 56.84-129.83 35.3-23.07 124.72-30.26 154.9-8.62s29.74 98.44 26.2 138.45" style="mix-blend-mode:multiply"/><path fill="none" stroke="#16161c" stroke-width="2.5" d="M1040.75 391.16c-1.96 46.85-42.33 84.3-85.43 133.2s-131.98 171.07-173.2 160.19c-41.2-10.88-53.3-161.2-74.08-225.47-20.77-64.28-66.35-115.06-50.56-160.2 15.8-45.13 93.7-101.33 145.3-110.6 51.6-9.28 124.64 21.11 164.3 54.93 39.66 33.8 75.63 101.09 73.67 147.94Z"/><circle cx="856.91" cy="291.16" r="32" fill="none" stroke="#16161c" stroke-width="2.5"/><g fill="#16161c"><circle cx="797.09" cy="207.16" r="4"/><circle cx="812.09" cy="207.16" r="4"/><circle cx="827.09" cy="207.16" r="4"/><circle cx="842.09" cy="207.16" r="4"/></g><path fill="#16161c" d="M929.33 544.85c-1.28 11.6-7.31 22.51-15.96 28.19s-25.47 10.55-35.94 5.85-28.03-24.72-26.86-34.04 22.14-14.98 33.88-21.9c11.75-6.9 29.1-23.2 36.58-19.56s9.57 29.85 8.3 41.46"/><path fill="gray" d="M0 0h1200v800H0z" filter="url(#b)" opacity=".32" style="mix-blend-mode:overlay"/></svg>`;
const NAV = ['Work', 'Studio', 'Thinking', 'Contact'];

export default function AgencyHero() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Agency Hero" width={1200} height={800}>
        <div style={{ position: 'relative', width: 1200, height: 800, overflow: 'hidden', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#16161c' }}>
          <style>{'.ah-bg svg{position:absolute;inset:0;width:100%;height:100%;display:block}'}</style>
          <div className="ah-bg" style={{ position: 'absolute', inset: 0 , left: "0px" , top: "0px" }} dangerouslySetInnerHTML={{ __html: BG }} />

          {/* top bar */}
          <header style={{ position: 'absolute', top: 36, left: 56, right: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 800, letterSpacing: '-0.01em', fontSize: 19 }}>studio&nbsp;plenty<span style={{ color: '#ff4d4f' }}>.</span></span>
            <nav style={{ display: 'flex', alignItems: 'center', gap: 30, fontSize: 14.5, fontWeight: 500 }}>
              {NAV.map((n) => (<span key={n} style={{ cursor: 'pointer' }}>{n}</span>))}
              <span style={{ padding: '10px 20px', borderRadius: 999, background: '#16161c', color: '#fff', fontWeight: 600, fontSize: 14 }}>Start a project</span>
            </nav>
          </header>

          {/* hero copy — calm left quadrant */}
          <div style={{ position: 'absolute', left: 56, top: 250, maxWidth: 600 }}>
            <p style={{ margin: 0, fontSize: 13, letterSpacing: '0.26em', textTransform: 'uppercase', fontWeight: 700, color: '#6b6b73' }}>Independent brand studio</p>
            <h1 style={{ margin: '20px 0 0', fontSize: "88px", lineHeight: 0.96, fontWeight: 800, letterSpacing: '-0.035em' , paddingBottom: "0px" , paddingTop: "0px" }}>
              Brands with<br />a <span style={{ fontStyle: 'italic', color: '#ff4d4f' }}>pulse</span>.
            </h1>
            <p style={{ margin: '26px 0 0', fontSize: 18, lineHeight: 1.55, color: '#3a3a42', maxWidth: 440 }}>
              An independent studio shaping identity, packaging, and digital for people who refuse to blend in.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 34 }}>
              <span style={{ padding: '15px 28px', borderRadius: 12, background: '#16161c', color: '#fff', fontWeight: 700, fontSize: 15.5 }}>Start a project</span>
              <span style={{ padding: '15px 24px', borderRadius: 12, border: '1.5px solid #16161c', fontWeight: 700, fontSize: 15.5 }}>See the work&nbsp;→</span>
            </div>
          </div>

          {/* bottom tag */}
          <div style={{ position: 'absolute', left: 56, bottom: 34, fontSize: 13, color: '#6b6b73', letterSpacing: '0.02em' }}>
            Identity · Packaging · Web · Motion — <strong style={{ color: '#16161c' }}>since 2014</strong>
          </div>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
