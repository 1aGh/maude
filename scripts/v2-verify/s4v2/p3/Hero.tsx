/**
 * @canvas   hero · scratch canvas for the S4.V3 AI-annotation rows
 * @platform desktop
 */
import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function Hero() {
  return (
    <DesignCanvas>
      <DCSection id="hero" title="Hero" subtitle="Desktop">
        <DCArtboard id="desktop" label="Desktop" kind="web" width={1440} height={900} fixed>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: '#fff',
              color: '#111',
              fontFamily: 'system-ui, sans-serif',
              position: 'relative',
            }}
          >
            <header style={{ padding: '20px 64px', background: '#f4f4f2' }}>
              <b>Studio</b>
            </header>
            <h1 style={{ margin: 0, padding: '64px 64px 0', fontSize: 64, maxWidth: 640 }}>
              Jedeme v zeleném.
            </h1>
            <svg
              data-cd-id="hero-picture"
              width={616}
              height={380}
              style={{
                position: 'absolute',
                left: 704,
                top: 120,
                background: '#cfe3d4',
                borderRadius: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 24, padding: '420px 64px 0' }}>
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  data-cd-id={`tile-${n}`}
                  style={{ flex: 1, height: 200, background: '#e6e9ec', borderRadius: 14 }}
                />
              ))}
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
