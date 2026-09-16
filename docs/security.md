# Security model and review

## Identity and permissions

Passwords use bcrypt with cost 12; inputs are limited to 72 UTF-8 bytes to avoid
silent bcrypt truncation. Signed HS256 JWTs contain a session ID, fixed issuer and
audience, and an eight-hour expiry. Tokens live in HttpOnly, SameSite=Strict cookies
(Secure in production), not localStorage. MongoDB sessions allow immediate logout
revocation; role and tenant are reread from the user record on every request.

There is no refresh-token rotation because this is an eight-hour internal workspace
session. Expired sessions require login again. This avoids inventing a second token
lifecycle; SSO, MFA, password resets and invitation emails remain future work.

All mutations enforce an exact Origin and session-bound CSRF header. Gateway webhooks
use HMAC and timestamp verification instead. Express applies Helmet, strict CORS,
request size limits, request IDs, general rate limiting and a tighter login limit.
API responses are marked no-store. Nginx serves the SPA with a content security policy.

| Role | Write permissions |
|---|---|
| ADMIN | Users, roles, merchants, simulation, refunds, settlements, incidents, jobs |
| ENGINEER | Simulation, reconciliation and failed-job retry |
| FINANCE | Refunds, settlements, reconciliation, incident management including ignore |
| OPERATIONS | Incident assignment, notes and resolution; cannot ignore |
| VIEWER | Read-only |

The demo flag independently denies all writes. Self role changes are blocked to avoid
accidental administrator lockout. Public organization registration is disabled.

## Financial integrity

- Money uses safe positive integer minor units with bounded input amounts.
- Refund reservations, records, events, audit and jobs commit together.
- Unique tenant/idempotency keys plus a payload fingerprint handle retry races.
- The balance predicate prevents over-refunding across different concurrent keys.
- Webhook signature comparison is timing-safe and covers exact bytes.
- Unique webhook IDs prevent duplicate updates. Terminal states ignore late reversals.
- A refund failure releases reserved balance; repeated outcomes are harmless.

## Tenant isolation

Browser-provided organization and actor fields are not accepted. Resource lookups,
lists, references, jobs and member assignments use authenticated tenant context.
Cross-tenant identifiers return not-found or ineligible responses. Django requires
service authentication before trusting tenant headers and re-filters every queryset.
The shared service secret is a trust boundary: never expose it to the browser.

## Upload safety

Uploads require finance/admin access and stream to temporary disk before GridFS.
The original filename is not used as a storage path. The worker enforces exact CSV
headers, size/row limits, bounded records, integer fields, ISO dates and ownership.
It validates the complete file before creating final financial rows. Partial worker
writes remain PROCESSING and are excluded from reconciliation until finalized.
Retry upserts use a stable settlement/row identity. CSV files are not executed or
served as HTML; imported strings are rendered as React text.

## Secrets, logs and deployment

`.env` and local runtimes are ignored. `scripts/init-env.mjs` creates random local
application secrets. Do not reuse local credentials in production. Use HTTPS,
private database/service networks, provider secret storage, backups and access controls.
Logs omit request bodies, cookies, signatures and passwords. Request errors expose
safe messages rather than stack traces. The user-visible job error stores only a
bounded message; it never stores raw credentials or upload data.

The Compose development databases bind host ports to loopback only. Do not expose
those ports on a public host. The deployment overlay removes them. A single-tenant
host network is not a substitute for managed database authentication and backups.

## Verified and remaining limits

Integration tests exercise login, revocation, CSRF, roles, tenant access, concurrent
refund keys, duplicate callbacks and retry-safe settlements. Django tests exercise
service authentication, tenant isolation, stale projections and incident decisions.
Browser tests exercise the actual API rather than fixtures.

Not an audited banking system: no real card data, provider credentials or real money
are accepted. No compliance certification is claimed. Before broad public write
access, add distributed rate-limit storage, identity recovery, upload retention,
operational alerts and a threat review of the chosen production provider.
