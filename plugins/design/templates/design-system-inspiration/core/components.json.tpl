{
  "$schema": "https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/schema/ds-components-v1.schema.json",
  "schemaVersion": 1,
  "system": "{{ds_dirname}}",
  "components": {
    "Button": {
      "class": "btn",
      "export": "Button",
      "variants": {
        "primary": "btn--primary",
        "secondary": "btn--secondary",
        "ghost": "btn--ghost",
        "danger": "btn--danger"
      },
      "sizes": {
        "sm": "btn--sm",
        "lg": "btn--lg"
      }
    },
    "IconButton": {
      "class": "btn btn--icon",
      "export": "IconButton",
      "variants": {
        "primary": "btn--primary",
        "secondary": "btn--secondary",
        "ghost": "btn--ghost",
        "danger": "btn--danger"
      },
      "sizes": {
        "sm": "btn--sm",
        "lg": "btn--lg"
      }
    },
    "Input": {
      "class": "input",
      "export": "Input",
      "sizes": {
        "sm": "input--sm"
      }
    },
    "Field": {
      "class": "field",
      "export": "Field"
    },
    "Switch": {
      "class": "switch",
      "export": "Switch"
    },
    "Checkbox": {
      "class": "checkbox",
      "export": "Checkbox"
    },
    "Segmented": {
      "class": "seg",
      "export": "Segmented",
      "sizes": {
        "sm": "seg--sm"
      }
    },
    "Tabs": {
      "class": "tabs",
      "export": "Tabs"
    },
    "Chip": {
      "class": "chip",
      "export": "Chip",
      "variants": {
        "accent": "chip--accent",
        "soft": "chip--soft"
      }
    },
    "Badge": {
      "class": "badge",
      "export": "Badge",
      "variants": {
        "success": "badge--success",
        "warn": "badge--warn",
        "error": "badge--error",
        "info": "badge--info",
        "accent": "badge--accent"
      }
    },
    "Card": {
      "class": "card",
      "export": "Card",
      "variants": {
        "raised": "card--raised",
        "interactive": "card--interactive",
        "flat": "card--flat"
      }
    },
    "Callout": {
      "class": "callout",
      "export": "Callout",
      "variants": {
        "info": "callout--info",
        "success": "callout--success",
        "warn": "callout--warn",
        "error": "callout--error"
      }
    },
    "Dialog": {
      "class": "dialog",
      "export": "Dialog"
    },
    "Tooltip": {
      "class": "tooltip",
      "export": "Tooltip"
    }
  },
  "typeRoles": {
    "title": "t-title",
    "heading": "t-heading",
    "subheading": "t-subheading",
    "body": "t-body",
    "body-sm": "t-body-sm",
    "caption": "t-caption",
    "label": "t-label",
    "eyebrow": "t-eyebrow",
    "code": "t-code",
    "num": "t-num"
  },
  "icons": {
    "family": "{{ds_dirname}}",
    "map": {{icon_map_json}}
  }
}
