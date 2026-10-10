/*
 * {{project_label}} — design tokens
 *
 * Authoritative token file. Every canvas in <designRoot>/ui/ links to this.
 * Production code should consume the same values (compiled to TS/JS or kept as CSS vars).
 *
 * This file is the single source of truth for the project's visual language.
 * Every concrete value below is supplied by the discovery payload — there are
 * NO universal defaults baked into this template. Spacing, type, easing,
 * shadows, max-width, accent strategy, and color space are all project-flavored.
 *
 * Two invariants this template does enforce:
 *   1. `prefers-reduced-motion: reduce` collapses every duration to 1ms (a11y).
 *   2. Every theme block also lists `.ds[data-theme="…"]` — the schema scope class
 *      `<DSRoot>` renders, so a canvas can switch systems without renaming its wrapper.
 *   3. Tokens used by canvases live under one of the documented family prefixes
 *      (--bg-*, --fg-*, --accent*, --border-*, --status-*, --space-*, --type-*,
 *      --lh-*, --radius-*, --shadow-*, --dur-*, --ease-*, --layout-*, --font-*).
 *
 * Everything else — palette structure, type ladder, motion personality — is
 * a project decision recorded during /design:setup-ds.
 */

:root,
.{{root_class}}[data-theme="{{theme_default}}"],
.ds[data-theme="{{theme_default}}"] {
  /* ─── Surfaces (deepest → highest) ─────────────────────────────────── */
  --bg-0: {{bg_0}};   /* page bg                    */
  --bg-1: {{bg_1}};   /* card / panel bg            */
  --bg-2: {{bg_2}};   /* nested panel / popover     */
  --bg-3: {{bg_3}};   /* input bg / subtle row hover */
  --bg-4: {{bg_4}};   /* hover / pressed state      */

  /* ─── Borders ──────────────────────────────────────────────────────── */
  --border-subtle:  {{border_subtle}};
  --border-default: {{border_default}};
  --border-strong:  {{border_strong}};

  /* ─── Text ─────────────────────────────────────────────────────────── */
  --fg-0: {{fg_0}};   /* primary text                */
  --fg-1: {{fg_1}};   /* secondary text              */
  --fg-2: {{fg_2}};   /* tertiary / muted            */
  --fg-3: {{fg_3}};   /* disabled                    */

  /* ─── Accent ({{accent_strategy_summary}}) ─────────────────────────── */
{{accent_block}}

  /* ─── Status (only if "status" ∈ activeFamilies) ───────────────────── */
  --status-success: {{status_success}};
  --status-warn:    {{status_warn}};
  --status-error:   {{status_error}};
  --status-info:    {{status_info}};

  /* ─── Presence (only if "presence" ∈ activeFamilies) ───────────────── */
  --presence-online:  {{presence_online}};
  --presence-away:    {{presence_away}};
  --presence-offline: {{presence_offline}};

  /* ─── Shadows / elevation ──────────────────────────────────────────── */
  --shadow-sm: {{shadow_sm}};
  --shadow-md: {{shadow_md}};
  --shadow-lg: {{shadow_lg}};

  /* ─── Radii ────────────────────────────────────────────────────────── */
  --radius-xs: {{radius_xs}};
  --radius-sm: {{radius_sm}};
  --radius-md: {{radius_md}};
  --radius-lg: {{radius_lg}};
  --radius-xl: {{radius_xl}};
  --radius-pill: {{radius_pill}};

  /* ─── Spacing ──────────────────────────────────────────────────────── */
  --space-0: {{space_0}};
  --space-1: {{space_1}};
  --space-2: {{space_2}};
  --space-3: {{space_3}};
  --space-4: {{space_4}};
  --space-5: {{space_5}};
  --space-6: {{space_6}};
  --space-7: {{space_7}};
  --space-8: {{space_8}};

  /* ─── Typography ───────────────────────────────────────────────────── */
  --font-display: {{font_display}};
  --font-body:    {{font_body}};
  --font-mono:    {{font_mono}};

  /* Type scale */
  --type-xs:   {{type_xs}};    --lh-xs:   {{lh_xs}};
  --type-sm:   {{type_sm}};    --lh-sm:   {{lh_sm}};
  --type-base: {{type_base}};  --lh-base: {{lh_base}};
  --type-md:   {{type_md}};    --lh-md:   {{lh_md}};
  --type-lg:   {{type_lg}};    --lh-lg:   {{lh_lg}};
  --type-xl:   {{type_xl}};    --lh-xl:   {{lh_xl}};
  --type-2xl:  {{type_2xl}};   --lh-2xl:  {{lh_2xl}};
  --type-3xl:  {{type_3xl}};   --lh-3xl:  {{lh_3xl}};

  /* ─── Motion ───────────────────────────────────────────────────────── */
  --dur-flip:  {{dur_flip}};
  --dur-panel: {{dur_panel}};
  --dur-route: {{dur_route}};
  --dur-soft:  {{dur_soft}};
  --ease-out:    {{ease_out_curve}};
  --ease-in-out: {{ease_in_out_curve}};

  /* ─── Layout ───────────────────────────────────────────────────────── */
  --layout-max-w:  {{layout_max_w}};
  --layout-gutter: {{layout_gutter}};

  /* ─── Schema v1 functional roles (V2-1.13 §5.3.3) ─────────────────────
   * Values come from discovery like every other token. A system that leaves one
   * out still renders: the canvas shell derives it from the tokens above (the
   * registry fallback), and `maude design ds-check` reports it as Missing roles. */
  --accent-soft: {{accent_soft}};
  --accent-on-soft: {{accent_on_soft}};
  --accent-text: {{accent_text}};
  --focus-ring: {{focus_ring}};
  --focus-ring-width: {{focus_ring_width}};
  --focus-ring-offset: {{focus_ring_offset}};
  --selection: {{selection}};
  --scrim: {{scrim}};
  --status-success-fg: {{status_success_fg}};
  --status-warn-fg: {{status_warn_fg}};
  --status-error-fg: {{status_error_fg}};
  --status-info-fg: {{status_info_fg}};
  --status-success-soft: {{status_success_soft}};
  --status-warn-soft: {{status_warn_soft}};
  --status-error-soft: {{status_error_soft}};
  --status-info-soft: {{status_info_soft}};
  --status-success-text: {{status_success_text}};
  --status-warn-text: {{status_warn_text}};
  --status-error-text: {{status_error_text}};
  --status-info-text: {{status_info_text}};
  --weight-regular: {{weight_regular}};
  --weight-medium: {{weight_medium}};
  --weight-semibold: {{weight_semibold}};
  --weight-bold: {{weight_bold}};
  --tracking-tight: {{tracking_tight}};
  --tracking-normal: {{tracking_normal}};
  --tracking-wide: {{tracking_wide}};
}

@media (prefers-reduced-motion: reduce) {
  :root, .{{root_class}}[data-theme="{{theme_default}}"], .ds[data-theme="{{theme_default}}"] {
    --dur-flip:  1ms;
    --dur-panel: 1ms;
    --dur-route: 1ms;
    --dur-soft:  1ms;
  }
}
