// quick-setup-tour.js — DDR-166 plan, Phase 2 (T7). The "empty → design system
// → first canvas → first AI edit" journey, on the existing tour engine
// (overlay.jsx), never a fork — same convention as usage-tour.js/collab-tour.js.
//
// Native, no-terminal posture (DDR-126/128): this deck can't execute
// `/design:setup-ds` for the user (the canvas iframe is cross-origin — DDR-054 —
// and the shell has no terminal). It coach-marks the Assistant panel instead:
// point at it, tell the user what to type, let THEM send it. The terminal
// `/design:*` path stays the power-user route.

export const QUICK_SETUP_TOUR = [
  {
    // Centered, no target — the overview step.
    title: "Let's get you set up",
    body: 'Three short steps: a design system for your brand, a first canvas, then your first AI edit. Everything after this happens right here — no terminal.',
  },
  {
    target: "[data-tour='sidebar']",
    title: 'Your canvases will live here',
    body: 'Empty for now. Once you have a design system, this fills up with real screens — click any one to open it.',
    placement: 'right',
  },
  {
    target: "[data-testid='assistant-toggle']",
    title: 'Ask the Assistant to build your design system',
    body: 'Open the Assistant and describe your brand — colors, type, the vibe you want. It sets up a real design system for you. Already have one? Say so and it can bring it in.',
    placement: 'left',
  },
  {
    target: "[data-tour='viewport']",
    title: 'Your first canvas appears here',
    body: 'Once the design system is ready, ask for a first screen and watch it land right in this space, ready to edit.',
  },
  {
    // Centered — the close-out step.
    title: "You're ready",
    body: 'Hold ⌘ and click anything on a canvas to point at it, describe the change in the Assistant, and watch it update live. Restart this tour any time from Help ▸ Quick setup.',
  },
];
