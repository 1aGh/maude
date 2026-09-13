## Parallelization rule

- **Web variants run sequentially** — they share a single agent-browser daemon / Chrome session. Don't try to run web-desktop and web-mobile in parallel; the second one will steal the daemon.
- **Native variants run in parallel** with web and with each other — each is a separate iOS sim or Android emulator. With `--udid`/`--serial` per-platform there's no contention.
- **Result**: target wallclock = `time(slowest web variant) + time(slowest native variant)`, which is roughly 1× time of native (ios-phone ≈ 60s) when web finishes first.

```bash
# Web sequential (in one bash chain):
( runners/web-desktop.sh && runners/mobile.sh web-mobile "iPhone 16" ) > /tmp/web.log 2>&1 &
WEB_PID=$!

# Natives in parallel:
runners/ios-phone.sh    > /tmp/ios-phone.log    2>&1 &
runners/ios-tablet.sh   > /tmp/ios-tablet.log   2>&1 &
runners/android-phone.sh > /tmp/android-phone.log 2>&1 &

wait $WEB_PID                                                # web chain done
wait                                                          # all natives done
```

---
