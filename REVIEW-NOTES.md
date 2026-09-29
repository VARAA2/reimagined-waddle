# Local review and integration notes

- Local-only package prepared 2026-09-24. Nothing published, installed into n8n, or connected to a real Telegram account.
- npm registry reported `teleproto@1.229.0`; the desired unscoped package name returned E404. A name lookup is not a reservation or publishing guarantee.
- Runtime files are plain, readable CommonJS. `npm pack` includes only package metadata, license, README, credentials class, node class, sender implementation, and `npm-shrinkwrap.json`.
- `npm test`: 12 tests passed. All fake clients; synthetic Telethon IPv4 auth key only.
- `npm audit --omit=dev`: zero currently reported vulnerabilities across 12 installed dependencies. This is not a full upstream security guarantee.
- No real names, group IDs, account IDs, passwords, API hashes, Telegram sessions, or source conversations are embedded in the public artifact.
- `Get Identity` defaults read-only. `Send Approved Reply` requires same-execution approval claim. Retry On Fail is refused by the wrapper. Keep this node in the workflow execution that acquired the draft claim; a separate subworkflow execution requires a deliberate token-binding design change.
- Credential identity/group/topic restrictions must be filled in the private n8n credential UI after installation. Use a stopped/disconnected local login helper; do not concurrently reuse the same authorization session from another host.
- Provider package installation and outbound Telegram connectivity remain to be tested; artifact preparation alone does not prove managed cloud support.
- Upstream approval workflow and human review remain mandatory. This node has no independent database claim or durable idempotency ledger; ambiguous delivery must not auto-retry.
- Independent exact-library audit is available in `../sender-audit/teleproto-audit/AUDIT.md`.
- Independent sender/wrapper review found no material blocker under the documented trusted upstream approval/CAS contract. A final narrow edit additionally rejects boolean/array coercion as numeric IDs; prepack tests still pass.
- Final local tarball SHA256: `0BCBA7BDA6CBF9456112D542D32841B6648053184309BA46187B491794BFE431`.
- Approval owner and personal sender are intentionally the same fixed credential user ID. Supporting a different human approver requires a separate credential restriction and new tests.
