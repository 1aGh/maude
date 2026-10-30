// quick-setup-tour.js — DDR-166 plan, Phase 2 (T7), rewritten for the v2 shell (V2-7.3). The
// "empty → design system → first canvas → first AI edit" journey, on the existing tour engine
// (overlay.jsx), never a fork — same convention as usage-tour.js / collab-tour.js.
//
// Native, no-terminal posture (DDR-126/128): this deck can't execute `/design:setup-ds` for the user
// (the canvas iframe is cross-origin — DDR-054 — and the shell has no terminal). It coach-marks the AI
// chat panel instead: point at it, tell the user what to say, let THEM send it. The terminal
// `/design:*` path stays the power-user route. Reached from Menu › Help › Set up Maude…, whose
// checklist dialog starts it.
//
// Spotlights are stable testids pinned by test/tour-targets.test.ts; a step whose target can be absent
// (the left panel while panels are hidden, the AI chat panel in the web studio) is `optional` and is
// skipped, not shown pointing at nothing. Copy follows the maude-v2 CONTRACT.

export const QUICK_SETUP_TOUR = [
  {
    // Centred, no target — the overview step.
    title: 'Let’s get you set up',
    body: 'Three short steps: a design system for your brand, a first canvas, then your first AI edit. Everything after this happens right here, with no terminal.',
  },
  {
    target: "[data-testid='panel-head-left']",
    optional: true,
    title: 'Your canvases will live here',
    body: 'Empty for now. Once a design system exists it pins at the top of Canvases, and every canvas you make is listed below it. Click one to open it.',
    placement: 'right',
  },
  {
    // the AI chat panel itself while it shows, else the spark icon that brings it back
    target: "[data-testid='ai-chat-island'], [data-testid='panel-icon-assistant']",
    optional: true,
    title: 'Ask AI to build your design system',
    body: 'Open the AI chat panel and describe the brand: colours, type, the feel you want. AI makes a design system on a canvas of its own. Already have one? Say so, or bring it in with Menu › File › Import a brand…',
    placement: 'left',
  },
  {
    target: "[data-tour='viewport']",
    title: 'Your first canvas appears here',
    body: 'Once the design system is ready, ask for a first screen and watch it land in this space, ready to edit.',
  },
  {
    // Centred — the close-out step.
    title: 'You’re ready',
    body: 'Select anything on a canvas, press ⌘/ to Ask AI with it attached, and watch it change. Restart this tour any time from Menu › Help › Set up Maude…',
  },
];
