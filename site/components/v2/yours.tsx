// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import { Icon } from './kit/glyphs';

const FILES: { icon: string; pad?: number; on?: boolean; name: string; meta?: string }[] = [
  { icon: 'folder', name: 'studio-site' },
  { icon: 'folder', pad: 24, name: '.design' },
  { icon: 'folder', pad: 40, name: 'system', meta: 'your design system' },
  { icon: 'folder', pad: 40, name: 'ui' },
  { icon: 'file', pad: 56, on: true, name: 'Landing page.tsx', meta: 'edited by AI · 2 min ago' },
  { icon: 'file', pad: 56, name: 'Pricing.tsx', meta: 'Tereza · today' },
  { icon: 'file', pad: 56, name: 'Launch post.tsx', meta: 'you · yesterday' },
  { icon: 'folder', pad: 24, name: 'src', meta: 'the real app' },
];

export function Yours() {
  return (
    <section className="ps-wrap ps-section" aria-labelledby="h-yours">
      <div className="ps-yours">
        <div className="ps-head" style={{ marginBottom: 0 }}>
          <span className="ps-eyebrow">It's yours</span>
          <h2 id="h-yours" className="ps-h2">
            Like Figma. Except it's yours.
          </h2>
          <p className="ps-lede">
            Canvases are plain files in a folder you own. Keep them on your Mac, in Git, or in Maude
            Cloud, and take them with you whenever you want.
          </p>
          <div className="ps-facts" style={{ marginTop: 'var(--space-4)' }}>
            <div className="ps-fact">
              <span className="ps-ico">
                <Icon name="file" size={16} />
              </span>
              <div>
                <b>Real files</b>
                <p className="ps-small">Each canvas is a .tsx file a developer can ship.</p>
              </div>
            </div>
            <div className="ps-fact">
              <span className="ps-ico">
                <Icon name="history" size={16} />
              </span>
              <div>
                <b>Version history</b>
                <p className="ps-small">Every change is kept, with Restore.</p>
              </div>
            </div>
            <div className="ps-fact">
              <span className="ps-ico">
                <Icon name="server" size={16} />
              </span>
              <div>
                <b>Self-host for free</b>
                <p className="ps-small">The same software, on your own box.</p>
              </div>
            </div>
            <div className="ps-fact">
              <span className="ps-ico">
                <Icon name="lock" size={16} />
              </span>
              <div>
                <b>Open-source</b>
                <p className="ps-small">MIT license, no telemetry, no signup.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="ps-files" role="img" aria-label="A Maude project's files">
          {FILES.map((f) => (
            <span
              key={f.name}
              className="ps-file"
              data-on={f.on ? 'true' : undefined}
              style={f.pad ? { paddingLeft: f.pad } : undefined}
              aria-hidden="true"
            >
              <Icon name={f.icon} size={14} /> {f.name}
              {f.meta ? <span className="ps-meta">{f.meta}</span> : null}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
