# Engineering decisions

| Decision | Reason | Alternative considered | Trade-off |
|---|---|---|---|
| React + TypeScript + Vite | Interactive investigation workspace and explicit API shapes | Server-rendered templates | Client state and loading/error handling are required |
| Express on Node | Operational APIs, I/O and the BullMQ worker share one language | Django-only backend | Two runtimes require a clear domain boundary |
| MongoDB + Mongoose | Payments and flexible event metadata belong together operationally | PostgreSQL for everything | Replica-set transactions and explicit application references |
| Django + DRF | Reconciliation rules, incidents and reporting form a separate domain | Another Node service | Additional deployment and shared service authentication |
| PostgreSQL | Relational incident history, constraints and aggregate queries | MongoDB reporting pipelines | Eventual projection from the operational database |
| Redis + BullMQ | Retryable delayed background processing and crash recovery | In-process tasks | Redis must remain available and persistent |
| REST | Predictable resource operations and simple debugging | GraphQL | Some view-specific composite endpoints |
| No Kafka | One worker queue and a small number of services | Event streaming platform | Not an immutable organization-wide event bus |
| Integer minor units | Exact financial comparisons | Binary floating-point money | Currency scale must be explicit; current product supports INR |
| Durable MongoDB job outbox | Financial writes survive Redis outages | Enqueue immediately after commit | Polling introduces a few seconds of latency |
| Single worker concurrency | Simple sequencing for a portfolio workload | Many parallel workers | Throughput is deliberately limited until stronger ordering exists |
| Two-pass CSV streaming | Validate all rows before publishing financial results | Parse the full upload in HTTP | Reads upload bytes twice; bounded batches avoid whole-file memory |
| GridFS uploads | Shared durable files usable by any worker | Container-local disk | More MongoDB storage and a future retention policy |
| Atomic refund reservation | Prevent concurrent requests exceeding the balance | Read-then-write balance check | Financial operations require MongoDB transactions |
| Unique idempotency key + fingerprint | Safe retry without accepting changed requests | Cache-only key storage | Keys and refund records are retained |
| Eight-hour revocable cookie sessions | HttpOnly tokens with immediate logout | localStorage JWT / refresh tokens | Reauthentication after expiry; no long-lived login |
| Human incident disposition | Preserve analyst decisions when conditions clear | Automatically resolve every cleared rule | Analysts must close investigations explicitly |
| Read-only public demo | Recruiters explore without damaging shared records | Shared writable admin login | Mutation flows require private local/admin access |
| Single-host Compose deployment | All required services with understandable operations | Several managed providers | Hosting owner must handle backups and availability |

## Structure deviations

The workspace itself is the repository root rather than adding another nested
`ledgerlens/` directory. The first implementation uses cohesive Express modules
(`app`, `auth`, `finance`, `models`, `workers`) and React page components rather than
empty controller/service folders. This keeps actual domain logic visible; `finance`
and reconciliation rules remain independently testable. The page module should be
split by feature as the team or product grows.

No real gateway, Kafka, caching layer, SSO, full double-entry accounting or multi-currency
FX was added. Each would require a real product need and its own correctness model.

## Measured behavior, not marketing claims

The seed includes 480 generated payment records, not real customers or transactions.
No throughput, latency improvement, accuracy or business impact metric is claimed.
CI records tests and build results; performance claims require a separate benchmark.
