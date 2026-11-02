# Agent eval — A (one writer + skills) vs B (A + helpers)

6 trials · 0 infra-failures (excluded, re-run) · agent+judge cost ≈ $3.69 (list) · agent wall 8.9 min (sum)

| task | group | helper | A inv | B inv | A qual | B qual | A judge | B judge | A tok | B tok | A wall s | B wall s | B agents | failed (A / B) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| e4 | edit | — | 3/3 | – | 3/3 | – | 3/3 | – | 534k | – | 63 | – | – |  /  |
| e5 | edit | — | 3/3 | – | 3/3 | – | 2/3 (1?) | – | 815k | – | 116 | – | – |  /  |

## Decision rule per helper (keep only if quality or latency wins at ≤ 1.5× tokens, no invariant drop)

| helper | tasks | A pass^k | B pass^k | A qual | B qual | A judge | B judge | tokens B/A | A wall s | B wall s | quality win | latency win | keep split |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| board-reader | 0 | 0 | 0 | 0 % | 0 % | 0 % | 0 % | – | – | – | no | no | no |
| artboard-drafter | 0 | 0 | 0 | 0 % | 0 % | 0 % | 0 % | – | – | – | no | no | no |
| ds-switcher | 0 | 0 | 0 | 0 % | 0 % | 0 % | 0 % | – | – | – | no | no | no |
| controls | 0 | 0 | 0 | 0 % | 0 % | 0 % | 0 % | – | – | – | no | no | — |
| overall | 0 | 0 | 0 | 0 % | 0 % | 0 % | 0 % | – | – | – | no | no | — |
