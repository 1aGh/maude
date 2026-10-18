import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';
import type { ReactNode } from 'react';

// A fixture canvas for `describeChanges` — every edge the V2-1.9 spec names: a shared component, a data
// array, a mapped artboard family, JSX in an attribute slot, a frame-rendered style block, sections,
// class names built from a prefix, and comments.

const TOOLS = [
  { id: 'sticky', label: 'Sticky' },
  { id: 'image', label: 'Picture' },
];
const MINI = ['sticky', 'image'];
const DISCS = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];
const GOLD = '#c9a227';

function WebStyles() {
  return <style>{'.fx-hero{display:flex}'}</style>;
}

function Icon({ name, note }: { name: string; note?: ReactNode }) {
  return (
    <span className="fx-icon" data-name={name}>
      {note}
    </span>
  );
}

function Note({ children }: { children?: ReactNode }) {
  return <p className="fx-note">{children}</p>;
}

function Jersey({ number, tone }: { number: number; tone: string }) {
  return (
    <div className="fx-jersey" style={{ background: tone, width: 120 }}>
      <span className="fx-jersey-no">{number}</span>
      <span>{MINI[0]}</span>
    </div>
  );
}

export default function Fixture() {
  return (
    <DesignCanvas>
      <WebStyles />
      <DCSection id="home-s" title="Home">
        <DCArtboard id="home" label="Homepage" width={390} height={800}>
          {/* the hero */}
          <div className="fx-hero" style={{ background: '#000000', padding: 24 }}>
            <h1 data-cd-id="hero-title" style={{ fontSize: 32, color: '#ffffff' }}>
              Welcome back
            </h1>
            <img src="hero.png" alt="Team on the pitch" width={120} />
            <button type="button" className="fx-btn fx-btn--primary">
              Buy now
            </button>
            <Note>Free shipping on orders from 10 pieces in one basket</Note>
            <Jersey number={9} tone={GOLD} />
          </div>
          <ul className="fx-list">
            <li>One</li>
            <li>Two</li>
            <li>Three</li>
          </ul>
          <Icon name="cloud" note={<Note>Syncs while you work</Note>} />
        </DCArtboard>
        <DCArtboard id="pricing" label="Pricing" width={390} height={800}>
          <div className="fx-pricing" style={{ gap: 16 }}>
            <Jersey number={7} tone="#112233" />
            {TOOLS.map((t) => (
              <i key={t.id}>{t.label}</i>
            ))}
            {MINI.map((m) => (
              <span key={m} className={`sb-role--${m}`}>
                {m}
              </span>
            ))}
          </div>
        </DCArtboard>
      </DCSection>
      <DCSection id="discs-s" title="Discs">
        {DISCS.map((d) => (
          <DCArtboard key={d.id} id={`disc-${d.id}`} label={d.name} width={200} height={200}>
            <div className="fx-disc">{d.name}</div>
          </DCArtboard>
        ))}
      </DCSection>
    </DesignCanvas>
  );
}
