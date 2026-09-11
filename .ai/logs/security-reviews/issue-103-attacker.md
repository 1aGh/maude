# Issue 103 attacker review

Date: 2026-09-11
Verdict: PASS — no open findings. The reproduced MEDIUM availability finding below was resolved and independently rechecked.

Reviewed the current uncommitted notification adapter, canvas message boundary, shell integration, export and What’s New lifecycle, Undo/media notices, runtime import maps and Sonner dependency changes. Excluded unrelated `.claude/settings.json`. This review did not modify production files.

## Resolved MEDIUM: active canvas could starve trusted notifications with an unbounded burst

Initial implementation evidence: `canvas-notice-message.ts:15` gives every valid message a fresh anonymous notice; `notifications.tsx:43-48` retains all IDs without a limit. NotificationHost presents only the latest three and pauses every older notice’s expiry. The limit on individual text length does not bound queue size.

Reproduced with the actual adapter and NotificationHost using Bun, happy-dom and React act: publish a trusted export error, then pass 100 `canvas-notice` error messages through `acceptCanvasNotice` with the expected origin and active window. Result:

```json
{"cards":["Canvas burst 99","Canvas burst 98","Canvas burst 97"],"trustedVisible":false}
```

An active, potentially untrusted canvas can execute `for (let i=0;i<100;i++) parent.postMessage({dgn:'canvas-notice',kind:'error',message:'Canvas burst '+i}, '*')`. At three error notices per ten seconds, an earlier trusted notification waits roughly 330 seconds; sustained messages can suppress it indefinitely and retain an unbounded number of React entries. An ordinary burst of canvas Undo notices also grows this queue. This is notification availability impact, not arbitrary privileged execution. It requires the active canvas; inactive/cross-origin sources are correctly rejected.

Recommendation: bound or coalesce canvas ingress independently of trusted shell/export notices, and avoid allowing canvas traffic to consume all trusted-notification presentation capacity. Test a large burst, bounded retention, and continued visibility of trusted notices.

## Verified boundaries

- Origin equality and active Window identity are both required; null source/active window is rejected.
- The bridge reconstructs a text-only notice and drops ID, action, content, callback, duration and other sender-controlled fields. React renders the supplied string as text; no new HTML sink or callback transport was found.
- Export completion/Save callbacks are created by the shell from export jobs, and canvas notices cannot manufacture export action content or invoke native Save.
- Native Save/download implementation and IPC contracts are unchanged; the new action remains an explicit user click. Programmatic dismissal invalidates the Sonner presentation token before removal, preventing its dismissal callback from acknowledging hidden history entries.
- Sonner is pinned at 2.0.8 in the manifest and both lockfiles; the installed package matches. Lockfile integrity is present. Its runtime peer dependencies reuse React/React DOM; package scripts contain no install lifecycle hook. Inspection of installed distribution found no network fetch, eval, or Function constructor. This is local package inspection, not a provenance or ecosystem vulnerability audit.

## Limits

The burst reproduction exercises the real adapter and host in happy-dom rather than a browser iframe. Native IPC was reviewed statically, not executed. No external advisories were consulted and no general claim that the dependency is vulnerability-free is made.

## Remediation recheck

`notifyCanvasText` now owns two reusable, shell-selected canvas IDs and allows at most five publications per one-second window. Undo updates reuse an existing Undo slot. Validated shell ingress and standalone canvas notifications both call this helper; sender-selected IDs still cannot reach it. Canvas text stays bounded at 4,000 characters. At most two retained canvas notices means canvas traffic cannot occupy all three presentation slots, and the rate limit bounds React publications. Programmatic updates retain the slot rather than appending queue entries.

Independently reran `bun test test/notifications.test.tsx --test-name-pattern 'canvas bursts|rapid informational undo'`: 2 pass, 0 fail, 6 assertions. The regression exercises 100 immediate messages, sustained later input, continued visibility of the trusted export, drainage after expiry, and single-slot Undo updates. The earlier queue-starvation reproduction is resolved. Native Save and message source/origin boundaries remain unchanged.
