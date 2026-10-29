# agentic-notify rules

These rules bind every change to this package. They also bind agents
that drive it over MCP.

1. Ports first. Core code never imports a vendor API. Adapters do.
2. Fail closed. Bad input, a missing secret or an unknown principal denies the call.
3. No personal data in logs. Log ids and counts only.
4. Sign every webhook. Refuse to start with a missing or short secret.
5. Report failures as failures. No silent success after a failed call.
6. One issue, one PR, one concern.
