---
"@1agh/maude": patch
---

An idle desktop now really lets its cloud project sleep. The first night after the previous release showed the desktop never parked: its canvas connections were reconnecting every half minute (each time re-reading the project), and a handful of files that could never be delivered made it look as if work was still in progress. The project now keeps every connection quiet but alive, and files that stopped moving no longer hold the connection open. When an idle desktop does stay connected, its log now says why.
