## When investigation reveals "no root cause"

If systematic investigation reveals the issue is truly environmental, timing-dependent, or external (cold start, deploy lag, third-party API outage):

1. You've completed the process — document what you investigated.
2. Implement appropriate handling: retry, timeout, circuit breaker, error boundary.
3. Add monitoring (metric / event / alert) for future investigation.
4. Consider a DDR if the handling is non-trivial.

But: **95% of "no root cause" cases are incomplete investigation.**
