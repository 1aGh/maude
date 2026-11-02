import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

// Hero scene drawn entirely by the draw engine (`maude design draw-build`):
// gradient sky + radial sun glow + bloom filter, PCHIP mountain ridgelines with
// OKLCH atmospheric depth, lake reflection, stars, a vignette mask and a
// feTurbulence film-grain overlay. ViewBox 1200×600 → maps 1:1 to the artboard.
const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><title>Dawn over the ridge</title><desc>Layered mountain landscape at dawn with a sun, lake reflection, and stars</desc><defs><radialGradient id="b" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffecc1" stop-opacity=".95"/><stop offset=".4" stop-color="#ffc97c" stop-opacity=".55"/><stop offset="1" stop-color="#ffb972" stop-opacity="0"/></radialGradient><radialGradient id="e" cx=".5" cy=".42" r=".75"><stop offset="0" stop-opacity="0"/><stop offset=".65" stop-opacity="0"/><stop offset="1" stop-color="#050318" stop-opacity=".5"/></radialGradient><linearGradient id="a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#090738"/><stop offset=".45" stop-color="#482971"/><stop offset=".72" stop-color="#c15c62"/><stop offset=".86" stop-color="#f2a359"/><stop offset="1" stop-color="#efd4a3"/></linearGradient><linearGradient id="d" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#bc704a"/><stop offset=".25" stop-color="#4e3d6c"/><stop offset="1" stop-color="#0e1231"/></linearGradient><filter id="c"><feGaussianBlur in="SourceGraphic" stdDeviation="7"/></filter><filter id="f"><feTurbulence baseFrequency=".85" numOctaves="2" result="noise" stitchTiles="stitch" type="fractalNoise"/><feColorMatrix in="noise" type="saturate" values="0"/><feComponentTransfer><feFuncA slope=".42" type="linear"/></feComponentTransfer></filter></defs><path fill="url(#a)" d="M0 0h1200v470H0z"/><path fill="url(#b)" d="M630 20h460v460H630z"/><circle cy="18" r=".7" fill="#fff" opacity=".35"/><circle cx="197.3" cy="101.7" r="1.2" fill="#fff" opacity=".47"/><circle cx="394.6" cy="185.4" r="1.7" fill="#fff" opacity=".59"/><circle cx="591.9" cy="69.1" r=".7" fill="#fff" opacity=".71"/><circle cx="986.5" cy="36.5" r="1.7" fill="#fff" opacity=".47"/><circle cx="1183.8" cy="120.2" r=".7" fill="#fff" opacity=".59"/><circle cx="181.1" cy="203.9" r="1.2" fill="#fff" opacity=".71"/><circle cx="378.4" cy="87.6" r="1.7" fill="#fff" opacity=".35"/><circle cx="575.7" cy="171.3" r=".7" fill="#fff" opacity=".47"/><circle cx="773" cy="55" r="1.2" fill="#fff" opacity=".59"/><circle cx="1167.6" cy="22.4" r=".7" fill="#fff" opacity=".35"/><circle cx="164.9" cy="106.1" r="1.2" fill="#fff" opacity=".47"/><circle cx="362.2" cy="189.8" r="1.7" fill="#fff" opacity=".59"/><circle cx="559.5" cy="73.5" r=".7" fill="#fff" opacity=".71"/><circle cx="954.1" cy="40.9" r="1.7" fill="#fff" opacity=".47"/><circle cx="1151.4" cy="124.6" r=".7" fill="#fff" opacity=".59"/><circle cx="148.7" cy="208.3" r="1.2" fill="#fff" opacity=".71"/><circle cx="346" cy="92" r="1.7" fill="#fff" opacity=".35"/><circle cx="543.3" cy="175.7" r=".7" fill="#fff" opacity=".47"/><circle cx="740.6" cy="59.4" r="1.2" fill="#fff" opacity=".59"/><circle cx="1135.2" cy="26.8" r=".7" fill="#fff" opacity=".35"/><circle cx="132.5" cy="110.5" r="1.2" fill="#fff" opacity=".47"/><circle cx="329.8" cy="194.2" r="1.7" fill="#fff" opacity=".59"/><circle cx="527.1" cy="77.9" r=".7" fill="#fff" opacity=".71"/><circle cx="921.7" cy="45.3" r="1.7" fill="#fff" opacity=".47"/><circle cx="1119" cy="129" r=".7" fill="#fff" opacity=".59"/><circle cx="116.3" cy="212.7" r="1.2" fill="#fff" opacity=".71"/><circle cx="313.6" cy="96.4" r="1.7" fill="#fff" opacity=".35"/><circle cx="510.9" cy="180.1" r=".7" fill="#fff" opacity=".47"/><circle cx="708.2" cy="63.8" r="1.2" fill="#fff" opacity=".59"/><circle cx="1102.8" cy="31.2" r=".7" fill="#fff" opacity=".35"/><circle cx="100.1" cy="114.9" r="1.2" fill="#fff" opacity=".47"/><circle cx="297.4" cy="198.6" r="1.7" fill="#fff" opacity=".59"/><circle cx="494.7" cy="82.3" r=".7" fill="#fff" opacity=".71"/><circle cx="692" cy="166" r="1.2" fill="#fff" opacity=".35"/><circle cx="889.3" cy="49.7" r="1.7" fill="#fff" opacity=".47"/><circle cx="1086.6" cy="133.4" r=".7" fill="#fff" opacity=".59"/><circle cx="83.9" cy="217.1" r="1.2" fill="#fff" opacity=".71"/><circle cx="281.2" cy="100.8" r="1.7" fill="#fff" opacity=".35"/><circle cx="478.5" cy="184.5" r=".7" fill="#fff" opacity=".47"/><circle cx="860" cy="250" r="58" fill="#ffeaba" filter="url(#c)"/><circle cx="860" cy="250" r="54" fill="#fff1cc"/><path fill="none" stroke="#1f1e38" stroke-linecap="round" stroke-width="1.6" d="m288 150 12-6 12 6m24 18 9-4.5 9 4.5m-94 10 8-4 8 4m89-36 7-3.5 7 3.5"/><path fill="#7d79ab" d="M0 332c43.33-39.33 86.67-64 130-64s86.67 44 130 44c40 0 80-62 120-62 46.67 0 93.33 50 140 50s93.33-44 140-44 93.33 48 140 48 93.33-42 140-42c43.33 0 86.67 38 130 38s86.67-3.67 130-20v320H0Z"/><path fill="#54507e" d="M0 408c56.67-33.28 113.33-50 170-50 53.33 0 106.67 44 160 44 56.67 0 113.33-52 170-52 60 0 120 46 180 46 53.33 0 106.67-40 160-40s106.67 44 160 44c66.67 0 133.33-6.19 200-34v234H0Z"/><path fill="#2e2954" d="M0 458c70-19.24 140-30 210-30 73.33 0 146.67 28 220 28s146.67-32 220-32 146.67 32 220 32 146.67-26 220-26c36.67 0 73.33 9.67 110 20v150H0Z"/><path fill="url(#d)" d="M0 470h1200v130H0z"/><ellipse cx="860" cy="480" fill="#ffd493" opacity=".5" rx="90" ry="2.4"/><ellipse cx="860" cy="496" fill="#ffd493" opacity=".45" rx="81" ry="2.4"/><ellipse cx="860" cy="512" fill="#ffd493" opacity=".4" rx="72" ry="2.4"/><ellipse cx="860" cy="528" fill="#ffd493" opacity=".35" rx="63" ry="2.4"/><ellipse cx="860" cy="544" fill="#ffd493" opacity=".3" rx="54" ry="2.4"/><ellipse cx="860" cy="560" fill="#ffd493" opacity=".25" rx="45" ry="2.4"/><path fill="url(#e)" d="M0 0h1200v600H0z"/><path fill="gray" d="M0 0h1200v600H0z" filter="url(#f)" opacity=".6" style="mix-blend-mode:overlay"/></svg>`;

const NAV = ['Trails', 'Stays', 'Guides', 'Journal'];

export default function HorizonLanding() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Hero — Horizon" width={1200} height={600}>
        <div
          className="horizon-hero"
          style={{
            position: 'relative',
            width: 1200,
            height: 600,
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
            color: '#fff',
          }}
        >
          <style>{'.horizon-hero .scene svg{position:absolute;inset:0;width:100%;height:100%;display:block}'}</style>

          {/* Engine-drawn scene */}
          <div className="scene" style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: SCENE }} />

          {/* Left scrim so the headline seats on the busy sky */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(100deg, rgba(9,7,40,0.66) 0%, rgba(9,7,40,0.28) 38%, rgba(9,7,40,0) 62%)',
            }}
          />

          {/* Top bar */}
          <header
            style={{
              position: 'absolute',
              top: 28,
              left: 48,
              right: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #fff1cc, #f2a359 70%)',
                  boxShadow: '0 0 14px rgba(255,201,124,0.8)',
                }}
              />
              <span style={{ fontWeight: 700, letterSpacing: '0.18em', fontSize: 15 }}>HORIZON</span>
            </div>
            <nav style={{ display: 'flex', alignItems: 'center', gap: 30, fontSize: 14, color: 'rgba(255,255,255,0.82)' }}>
              {NAV.map((n) => (
                <span key={n} style={{ cursor: 'pointer' }}>
                  {n}
                </span>
              ))}
              <span
                style={{
                  padding: '9px 18px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.45)',
                  fontWeight: 600,
                  color: '#fff',
                }}
              >
                Plan a trip
              </span>
            </nav>
          </header>

          {/* Hero copy */}
          <div style={{ position: 'absolute', left: 48, top: 196, maxWidth: 560 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
                color: '#ffce8a',
                fontWeight: 600,
              }}
            >
              Alpine routes · Dawn patrol
            </p>
            <h1
              style={{
                margin: '16px 0 0',
                fontSize: 64,
                lineHeight: 1.02,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                textShadow: '0 2px 24px rgba(5,3,24,0.5)',
              }}
            >
              Chase the
              <br />
              first light.
            </h1>
            <p
              style={{
                margin: '22px 0 0',
                fontSize: 17,
                lineHeight: 1.55,
                color: 'rgba(255,255,255,0.84)',
                maxWidth: 430,
              }}
            >
              Hand-picked alpine routes, backcountry stays, and dawn-patrol guides — mapped for the mornings worth waking up for.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 30 }}>
              <span
                style={{
                  padding: '14px 26px',
                  borderRadius: 12,
                  background: 'linear-gradient(180deg, #ffd493, #f2a359)',
                  color: '#3a1e10',
                  fontWeight: 700,
                  fontSize: 15,
                  boxShadow: '0 10px 30px rgba(242,163,89,0.35)',
                }}
              >
                Start planning
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 600 }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.5)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                  }}
                >
                  ▶
                </span>
                Watch the film
              </span>
            </div>
          </div>

          {/* Featured-route glass card — counter-weights the left-loaded
              headline and fills the lower-right quadrant (balance fix from the
              graphic-design-critic pass). */}
          <div
            style={{
              position: 'absolute',
              right: 52,
              top: 350,
              width: 290,
              padding: 20,
              borderRadius: 16,
              background: 'rgba(18,14,42,0.42)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.16)',
              boxShadow: '0 20px 50px rgba(5,3,24,0.4)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, letterSpacing: '0.22em', color: '#ffce8a', fontWeight: 700 }}>
                FEATURED ROUTE
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>Sunrise 05:42</span>
            </div>
            <h3 style={{ margin: '12px 0 0', fontSize: 21, fontWeight: 700 }}>Aurelia Ridge</h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>
              14&nbsp;km · +980&nbsp;m · moderate
            </p>
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid rgba(255,255,255,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {['#f2a359', '#7d79ab', '#54507e'].map((c, i) => (
                  <span
                    key={c}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: c,
                      border: '2px solid rgba(18,14,42,0.6)',
                      marginLeft: i ? -8 : 0,
                      display: 'inline-block',
                    }}
                  />
                ))}
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginLeft: 10 }}>
                  +212 going
                </span>
              </div>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.12)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 14,
                }}
              >
                →
              </span>
            </div>
          </div>

          {/* Bottom meta strip */}
          <div
            style={{
              position: 'absolute',
              left: 48,
              bottom: 26,
              display: 'flex',
              gap: 36,
              fontSize: 13,
              color: 'rgba(255,255,255,0.7)',
              letterSpacing: '0.04em',
            }}
          >
            <span>
              <strong style={{ color: '#fff', fontSize: 17 }}>12</strong>&nbsp; regions
            </span>
            <span>
              <strong style={{ color: '#fff', fontSize: 17 }}>480</strong>&nbsp; curated trails
            </span>
            <span>
              <strong style={{ color: '#fff', fontSize: 17 }}>60</strong>&nbsp; dawn guides
            </span>
          </div>

          {/* Scroll cue */}
          <div
            style={{
              position: 'absolute',
              right: 52,
              bottom: 26,
              fontSize: 12,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.6)',
              writingMode: 'vertical-rl',
            }}
          >
            Scroll
          </div>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
