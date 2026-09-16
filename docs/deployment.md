# Deployment and operations

## Current status

The application has a real GitHub repository and automated Linux container validation.
**A public deployment has not been provisioned or verified.** No live URL is claimed.
Local preview is not a production deployment.

Repository: https://github.com/Yosshmi/ledgerlens-payment-reconciliation

The implementation supports one straightforward deployment: a Linux host running
the Compose stack, with Caddy providing automatic HTTPS. This preserves the exact
requested databases and worker rather than replacing them with static fixtures.

## Required external access

To provision a public deployment, an authorized hosting account or Linux host is
required, together with a public domain/DNS record. No Render/Railway credential is
configured in this environment. Creating paid infrastructure or accepting billing
requires the user's authorization; no hosting purchases have been made.

The concrete deployment files are `docker-compose.yml`,
`deploy/compose.production.yml`, and `deploy/Caddyfile`.

## Production runbook

1. Provision a Linux host with Docker Engine and Compose 2.24.4 or later. Size it for
   seven services; measure memory before settling on a small instance. A single host
   is appropriate for a portfolio demo, not high availability.
2. Point a domain's DNS A/AAAA records at the host. Allow inbound 80/443 and restricted
   administrative SSH. Do not expose database or Redis ports.
3. Clone the repository and run `node scripts/init-env.mjs`, or supply `.env` from
   the provider's secret store. Keep `.env` readable only by the deployment user.
4. Set `PUBLIC_HOST=your-real-domain.example` in `.env`. The setup script generates a
   random PostgreSQL password **before first initialization**. Supply unique
   JWT, webhook, internal-service, Django and admin password values; never reuse CI values.
5. Launch:

   ```sh
   docker compose -f docker-compose.yml -f deploy/compose.production.yml up --build -d --wait
   docker compose exec -T server node server/dist/seed.js
   ```

6. Caddy obtains HTTPS certificates and proxies to Nginx, which serves the React app
   and forwards `/api` to Express. The production overlay enables Secure cookies and
   uses the actual HTTPS origin. Django, Redis and databases stay on the internal network.
7. Open the domain and select **Open demo workspace**. Private admin login is
   `admin@ledgerlens.dev` with the generated `DEMO_PASSWORD`; do not publish it.
8. Run `BASE_URL=https://your-domain npx playwright test` for the read-only browser
   checks. Run mutating full-stack acceptance only in a dedicated disposable environment.

## Verification checklist

- HTTPS certificate is valid; HTTP redirects to HTTPS.
- Frontend refresh on `/transactions/TXN_DEMO_00031` works.
- `/health` and `/health/ready` return success without secrets.
- Django `/health/` succeeds from the private service network.
- The seed reconciliation job reaches COMPLETED; dashboard reports 480 seeded payments.
- Demo login, search, payment details/timeline, incidents and analytics work.
- Demo writes return 403; non-tenant IDs do not disclose data.
- Private admin payment simulation produces signed callbacks and financial events.
- Refund reservation and callback finish; CSV jobs finish through Redis/BullMQ.
- Worker logs contain no credentials, and services recover after restart.
- Browser console contains no application errors; assets and API use the same origin.
- Data persists after restarting containers; backup restore has been tested.

## Updates, rollback and data

Pin deployment to a tested Git commit. Build images before replacing running services.
Run Django migrations before serving the new version; review compatibility when
changing schemas. Roll back the image/commit only when migrations remain compatible.

Named volumes hold MongoDB, PostgreSQL, Redis and certificates. Never run
`docker compose down -v` on a persistent deployment. It is used only in disposable CI.
Back up MongoDB with `mongodump`, PostgreSQL with `pg_dump`, and restore to an isolated
environment regularly. A production retention/backup schedule must be configured by
the hosting owner. GridFS uploads currently remain available for manual job retries.

## Managed provider alternative

Render supports web/private services, background workers, PostgreSQL and Redis-compatible
Key Value. MongoDB can be provided by Atlas. A persistent full stack needs a paid
worker and durable database plans; a free web page alone does not satisfy this project.
Provider plans change, so check current terms before provisioning:

- https://render.com/docs/service-types
- https://render.com/docs/free
- https://render.com/docs/compute-plans
- https://docs.railway.com/pricing

These official pages were reviewed on 2026-09-16. No free-tier longevity or price is
promised in this repository.

## Local Docker blocker and fallback

This Windows Docker Desktop installation failed before launching its engine because
the `dockerInference` IPC socket could not be accessed. A targeted rename was attempted
without success; Docker data was not reset or deleted. Linux CI runs the real stack.

For local visual verification only, `scripts/local-mongo.mjs` runs an isolated MongoDB
replica set and `scripts/local-service.mjs` starts Express/Django with a SQLite preview
database. This fallback does not exercise Redis and is not offered as a deployment.

After `npm ci`, creating `.venv`, installing Python requirements and initializing
`.env`, run these in separate Windows terminals from the repository root:

```powershell
node scripts/local-mongo.mjs
node scripts/local-service.mjs django migrate
node scripts/local-service.mjs django runserver 127.0.0.1:8000 --noreload
node scripts/local-service.mjs seed
node scripts/local-service.mjs reconcile
node scripts/local-service.mjs api
npm run dev -w client
```

Run migration before starting Django; run seed before reconciliation. The long-running
MongoDB, Django, API and Vite commands each need their own terminal. Open localhost:5173.
