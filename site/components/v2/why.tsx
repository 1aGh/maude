// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The one argument, in three cards: Figma's canvas + Claude's AI = Maude.
import { Icon } from './kit/glyphs';
import { Kbd } from './kit/people';
import { Tick } from './tick';

export function Why() {
  return (
    <section className="ps-wrap ps-section" aria-labelledby="h-why">
      <div className="ps-head ps-center">
        <span className="ps-eyebrow">Why Maude</span>
        <h2 id="h-why" className="ps-h2">
          A real canvas and a real AI. Finally on speaking terms.
        </h2>
      </div>
      <div className="ps-trio">
        <div className="ps-card ps-card--flat ps-r">
          <span className="ps-who">From design tools</span>
          <h3 className="ps-h3">A real canvas</h3>
          <ul className="ps-ticks">
            <Tick>Artboards for apps, web pages, social, print and video</Tick>
            <Tick>Shape, Pen, Text, Frame and Components</Tick>
            <Tick>Stickies, comments and Present</Tick>
          </ul>
        </div>
        <span className="ps-plus ps-r ps-r--fade" aria-hidden="true">
          +
        </span>
        <div className="ps-card ps-card--flat ps-r">
          <span className="ps-who">From Claude</span>
          <h3 className="ps-h3">An AI that does the work</h3>
          <ul className="ps-ticks">
            <Tick>
              Select anything, press <Kbd>⌘/</Kbd>, say what you want
            </Tick>
            <Tick>It draws on the artboard while you watch</Tick>
            <Tick>
              One <Kbd>⌘Z</Kbd> takes back a whole AI run
            </Tick>
          </ul>
        </div>
        <span className="ps-plus ps-r ps-r--fade" aria-hidden="true">
          =
        </span>
        <div className="ps-card ps-card--you ps-r">
          <span className="ps-who" style={{ color: 'var(--accent-text)' }}>
            Maude
          </span>
          <h3 className="ps-h3">Both, and the work stays yours</h3>
          <ul className="ps-ticks">
            <Tick>Every design is a real file, not a cloud blob</Tick>
            <Tick>Your design system checks new work</Tick>
            <Tick>Version history with Restore, on every canvas</Tick>
            <Tick>Free to self-host, the same software</Tick>
          </ul>
        </div>
      </div>
      <div className="ps-works">
        <span>Works with what you already use:</span>
        <span className="chip">Your own Claude account</span>
        <span className="chip">
          <Icon name="terminal" size={12} /> Claude Code
        </span>
        <span className="chip">Git and GitHub</span>
        <span className="chip">Codex</span>
      </div>
    </section>
  );
}
