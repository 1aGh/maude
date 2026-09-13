## File layout

Run output lives under `.ai/device/scenario-runs/` (already gitignored as part of the `.ai/device/` artifact tree — see `.gitignore`). Runners themselves can live under `.ai/scenarios/<name>/runners/` if you want to commit them, or stay ephemeral in `/tmp/scenario-runners/` for one-off pilots:

```
.ai/scenarios/<scenario-name>/             # OPTIONAL: committed runners
├── runners/
│   ├── web-desktop.sh
│   ├── mobile.sh                          # web-mobile (device emulation only)
│   ├── ios-phone.sh
│   ├── ios-tablet.sh
│   └── android-phone.sh
├── covers.json                            # OPTIONAL: { web/native/shared git pathspecs } — enables C15 skip + C18 web-only (DDR-061)
└── README.md                              # scenario goal, fixtures, expected end state

.ai/device/scenario-runs/<scenario-name>/  # ALWAYS: gitignored run outputs
└── <YYYY-MM-DD-HHMM>/
    ├── report.md                          # final deliverable for the human
    ├── web-desktop/
    │   ├── step-1-home.png
    │   ├── ...
    │   └── result.txt                     # pass | fail | skipped + reason
    ├── web-mobile/
    ├── ios-phone/
    ├── ios-tablet/
    └── android-phone/
```

The committed `runners/` + `README.md` are optional; for one-shot scenarios just inline the bash via heredoc. **Do NOT** write run outputs to `.ai/scenarios/<name>/runs/`.

---
