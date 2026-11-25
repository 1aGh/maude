// The design tokens the cloud pages wear — a SUBSET of the maude-v2 design
// system’s token file, with the same custom-property names and the values
// copied verbatim (aliases followed to their value).
//
// Light only, whatever the person's system says: canvas 16 draws these pages
// light, and the owner chose that over following the system (2026-11-25).
// The DS's dark counterpart is deliberately not copied here.
//
// Nothing here is typed by hand: brand.test.mjs compares every value, in both
// themes, with the source file, and fails on the first one that differs.

export const TOKENS = `
:root {
  color-scheme: light;
  --bg-0: oklch(0.978 0.005 240);
  --bg-1: oklch(0.995 0.002 240);
  --bg-2: oklch(1 0 0);
  --bg-3: oklch(0.958 0.006 240);
  --bg-4: oklch(0.928 0.008 240);
  --border-subtle: oklch(0.24 0.014 250 / 0.07);
  --border-default: oklch(0.24 0.014 250 / 0.12);
  --border-strong: oklch(0.24 0.014 250 / 0.24);
  --fg-0: oklch(0.24 0.014 250);
  --fg-1: oklch(0.42 0.012 250);
  --fg-2: oklch(0.505 0.010 250);
  --fg-3: oklch(0.70 0.008 250);
  --accent: oklch(0.53 0.175 238);
  --accent-hover: oklch(0.49 0.170 238);
  --accent-active: oklch(0.46 0.165 238);
  --accent-fg: oklch(1 0 0);
  --focus-ring: oklch(0.53 0.175 238);
  --accent-text: oklch(0.47 0.170 238);
  --accent-muted: oklch(0.53 0.175 238 / 0.12);
  --accent-tint: oklch(0.53 0.175 238 / 0.22);
  --status-success: oklch(0.60 0.140 152);
  --status-warn: oklch(0.72 0.150 78);
  --status-error: oklch(0.55 0.190 22);
  --status-info: oklch(0.60 0.140 250);
  --status-success-text: oklch(0.52 0.130 152);
  --status-warn-text: oklch(0.54 0.120 70);
  --status-error-text: oklch(0.52 0.190 22);
  --status-success-fg: oklch(1 0 0);
  --status-warn-soft: color-mix(in oklch, var(--status-warn) 12%, transparent);
  --status-error-soft: color-mix(in oklch, var(--status-error) 12%, transparent);
  --presence-offline: oklch(0.72 0.008 250);
  --object-yellow: oklch(0.91 0.120 95);
  --object-green: oklch(0.82 0.120 152);
  --object-lilac: oklch(0.83 0.075 300);
  --object-coral: oklch(0.83 0.095 32);
  --object-sky: oklch(0.85 0.070 230);
  --object-grey: oklch(0.90 0.006 250);
  --object-ink: oklch(0.24 0.014 250);
  --island-bg: oklch(0.995 0.002 240 / 0.88);
  --island-blur: 16px;
  --island-edge: oklch(0.24 0.014 250 / 0.10);
  --island-shadow: 0 2px 10px oklch(0.24 0.030 250 / 0.07), 0 0.5px 1.5px oklch(0.24 0.030 250 / 0.06);
  --shadow-sm: 0 1px 2px oklch(0.24 0.030 250 / 0.08);
  --shadow-md: 0 3px 10px oklch(0.24 0.030 250 / 0.08), 0 1px 2px oklch(0.24 0.030 250 / 0.05);
  --shadow-lg: 0 8px 24px oklch(0.24 0.030 250 / 0.11), 0 2px 4px oklch(0.24 0.030 250 / 0.06);
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-pill: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --font-display: system-ui, -apple-system, "Segoe UI Variable Display", "Segoe UI", Roboto, "Inter", sans-serif;
  --font-body: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Inter", sans-serif;
  --font-rounded: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --type-xs: 11px;
  --lh-xs: 1.36;
  --type-sm: 12px;
  --lh-sm: 1.42;
  --type-base: 14px;
  --lh-base: 1.45;
  --type-md: 17px;
  --lh-md: 1.40;
  --type-lg: 20px;
  --lh-lg: 1.30;
  --type-xl: 24px;
  --lh-xl: 1.22;
  --type-2xl: 29px;
  --lh-2xl: 1.14;
  --type-3xl: 35px;
  --lh-3xl: 1.08;
  --tracking-tight: -0.015em;
  --tracking-wide: 0.02em;
  --dur-flip: 120ms;
  --dur-soft: 160ms;
  --ease-out: cubic-bezier(0.25, 0.8, 0.25, 1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-flip: 1ms; --dur-soft: 1ms; }
}
`;
