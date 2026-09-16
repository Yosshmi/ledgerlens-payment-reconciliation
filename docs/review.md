# Engineering review

This is an implementation review, not a claim of independent security certification.

## Issues found and fixed during verification

- **Transactional event insertion:** integration tests exposed Mongoose's requirement
  for ordered multi-document creates inside sessions. All relevant calls now set it.
- **Concurrent financial writes:** five identical refund requests return one refund;
  competing distinct keys cannot reserve more than the remaining balance.
- **Webhook state safety:** signatures cover raw bytes; duplicate delivery cannot
  debit twice; a late failure cannot reverse an already successful refund.
- **Settlement retry:** replaying a processed file preserves one row per stable row
  identity. No second settlement is created on a worker retry.
- **Timeline rendering:** MongoDB may omit empty metadata objects. The React timeline
  now accepts absent metadata; the app also has a recoverable render-error screen.
- **Mobile geometry:** closed advanced-filter content and an absolutely positioned
  screen-reader table label caused overflow. The dropdown is hidden while closed,
  and the scrollable table now contains the label's positioning.
- **Container health probe:** the Nginx probe uses IPv4 loopback to match its listener.
- **Gateway realism:** the worker sends signed HTTP callbacks through the public
  webhook handler, rather than bypassing signature verification in ordinary processing.
- **Password handling:** reject inputs beyond bcrypt's 72-byte boundary.
- **API caching:** session and financial responses carry `Cache-Control: no-store`.
- **Worker terminal failure:** exhausted/stalled jobs persist a failed state so manual
  retry remains available; requeued seed jobs remove stale completed BullMQ entries.
- **Dependency audit:** upgraded CSV parsing and Vitest dependencies to remove the
  advisories returned by npm audit at implementation time.

## Explicit limits

- One worker is the supported topology; reports are eventually consistent snapshots.
- Session rate limits are in-memory per API process; do not horizontally scale the
  API without a shared limiter and proxy configuration review.
- Search uses escaped regex, not an indexed fuzzy-search system. Offset pagination
  is capped; production-scale history should use keyset pagination.
- CSV files are limited to one merchant and retained in GridFS. There is no automatic
  archival/deletion policy, nor a resumable upload protocol.
- The public account is read-only. Admin workflows are tested against synthetic data.
- The simulated ledger is not a full double-entry accounting implementation.
- No external penetration test, load test, disaster-recovery exercise, or public
  deployment verification has been claimed.

## Release gate

Local Node/Django tests, build/lint and desktop/mobile browser journeys must pass.
Linux CI must also pass PostgreSQL, the container stack and the signed worker flow.
Public completion additionally requires provisioned hosting, HTTPS, persistent storage,
production smoke tests and verified URLs. The learning package is intentionally gated
on that completion, as requested.
