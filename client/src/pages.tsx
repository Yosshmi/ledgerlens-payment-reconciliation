import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Clock,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { api } from "./api";
import {
  Badge,
  date,
  label,
  Metric,
  money,
  Pagination,
  State,
  useApi,
} from "./components";
import { useAuth } from "./main";
import type {
  Analytics,
  Audit,
  Event,
  Incident,
  Job,
  Merchant,
  Page,
  Payment,
  Refund,
  Settlement,
  User,
} from "./types";

function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Section({
  title,
  detail,
  action,
  children,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {detail && <p>{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function useAction() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, error, setMessage, run };
}
function Feedback({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          <Check size={16} />
          {message}
        </p>
      )}
    </>
  );
}
function PaymentTable({
  items,
  compact = false,
}: {
  items: Payment[];
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Merchant</th>
            <th>Amount</th>
            <th>Status</th>
            {!compact && <th>Method</th>}
            <th>Created</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.transactionId}>
              <td>
                <Link
                  className="mono row-link"
                  to={"/transactions/" + p.transactionId}
                >
                  {p.transactionId}
                </Link>
                {!compact && <small>{p.customerReference}</small>}
              </td>
              <td>{p.merchantId.replace("MER_", "")}</td>
              <td className="number">{money(p.amountMinor)}</td>
              <td>
                <Badge value={p.status} />
              </td>
              {!compact && <td>{label(p.paymentMethod)}</td>}
              <td className="muted nowrap">{date(p.createdAt)}</td>
              <td>
                <Link
                  className="icon-button"
                  aria-label={"Investigate " + p.transactionId}
                  to={"/transactions/" + p.transactionId}
                >
                  <ArrowUpRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function VolumeChart({ data }: { data: Analytics }) {
  const max = Math.max(1, ...data.daily.map((d) => d.volumeMinor));
  return (
    <div className="chart">
      <div className="chart-caption">
        <span>Processed volume · INR</span>
        <strong>{data.daily.length} days</strong>
      </div>
      <div className="bars">
        {data.daily.map((d) => (
          <div
            className="bar-column"
            key={d.date}
            title={`${d.date}: ${money(d.volumeMinor)} · ${d.count} payments`}
          >
            <div
              className="bar"
              style={{ height: `${Math.max(2, (d.volumeMinor / max) * 100)}%` }}
            />
            <span>{new Date(d.date).getDate()}</span>
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <i />
        Transaction volume<span>Hover for daily totals</span>
      </div>
    </div>
  );
}
export function Dashboard() {
  const { data, error, loading } = useApi<Analytics>("/analytics/overview");
  const payments = useApi<Page<Payment>>("/transactions?limit=6");
  const incidents = useApi<Page<Incident>>("/incidents?status=OPEN&limit=4");
  return (
    <>
      <Heading
        eyebrow="OPERATIONS OVERVIEW"
        title="The full picture of your payments"
        description="Monitor payment health, investigate exceptions, and close the loop."
      >
        <Link className="secondary" to="/settlements">
          <Upload size={16} />
          Upload settlement
        </Link>
        <Link className="primary" to="/transactions">
          Explore transactions
          <ArrowRight size={16} />
        </Link>
      </Heading>
      <State loading={loading} error={error} />
      {data && !error && (
        <>
          <div className="metrics">
            <Metric
              title="TOTAL PAYMENT VOLUME"
              value={money(data.volumeMinor)}
              detail={`${data.transactions.toLocaleString()} transactions · INR`}
            />
            <Metric
              title="PAYMENT SUCCESS RATE"
              value={`${data.successRate}%`}
              detail={`${data.success.toLocaleString()} successful payments`}
            />
            <Metric
              title="OPEN INCIDENTS"
              value={data.openIncidents}
              detail={`${data.criticalIncidents} require critical attention`}
            />
            <Metric
              title="RECONCILIATION MISMATCH"
              value={`${data.mismatchRate}%`}
              detail="Transactions with an active discrepancy"
            />
          </div>
          <div className="dashboard-grid">
            <Section
              title="Payment activity"
              detail="Volume across your latest 30 active days"
              action={<span className="soft-label">All merchants</span>}
            >
              <VolumeChart data={data} />
            </Section>
            <Section
              title="Needs attention"
              detail="Open reconciliation exceptions"
              action={
                <Link to="/incidents" className="text-link">
                  View all
                  <ArrowUpRight size={15} />
                </Link>
              }
            >
              <State
                loading={incidents.loading}
                error={incidents.error}
                empty={!incidents.data?.items.length}
              />
              <div className="alert-list">
                {incidents.data?.items.map((i) => (
                  <Link to={"/incidents/" + i.incident_id} key={i.incident_id}>
                    <span className={`alert-icon ${i.severity.toLowerCase()}`}>
                      <ShieldAlert size={19} />
                    </span>
                    <div>
                      <strong>{label(i.type)}</strong>
                      <small className="mono">{i.transaction_id}</small>
                    </div>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
              <div className="panel-note">
                <Clock size={14} />
                Updated{" "}
                {data.lastReconciledAt
                  ? date(data.lastReconciledAt)
                  : "after the first reconciliation"}
              </div>
            </Section>
          </div>
          <div className="health-strip">
            <div>
              <span className="health-icon">
                <Check size={19} />
              </span>
              <div>
                <strong>Settlement health</strong>
                <small>{data.settled} payments settled</small>
              </div>
              <b>{data.settlementRate}%</b>
            </div>
            <div>
              <span className="health-icon">
                <ArrowDownToLine size={19} />
              </span>
              <div>
                <strong>Refund activity</strong>
                <small>{data.refundCount} refund requests</small>
              </div>
              <b>{money(data.refundedMinor)}</b>
            </div>
            <div>
              <span className="health-icon">
                <ShieldAlert size={19} />
              </span>
              <div>
                <strong>Failed payments</strong>
                <small>Available for investigation</small>
              </div>
              <b>{data.failed}</b>
            </div>
          </div>
        </>
      )}
      <Section
        title="Recent transactions"
        detail="Latest activity across your organization"
        action={
          <Link className="text-link" to="/transactions">
            All transactions
            <ArrowRight size={15} />
          </Link>
        }
      >
        <State
          loading={payments.loading}
          error={payments.error}
          empty={!payments.data?.items.length}
        />
        {payments.data && <PaymentTable items={payments.data.items} compact />}
      </Section>
    </>
  );
}

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0),
    [simulate, setSimulate] = useState(false);
  const result = useApi<Page<Payment>>(
    "/transactions?" + params.toString(),
    version,
  );
  const merchants = useApi<Page<Merchant>>("/merchants?limit=100");
  const { user } = useAuth();
  const action = useAction();
  const canSimulate = !user.demo && ["ADMIN", "ENGINEER"].includes(user.role);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget),
      query = new URLSearchParams();
    for (const [key, value] of values)
      if (String(value)) {
        query.set(
          key,
          ["from", "to"].includes(key)
            ? new Date(
                String(value) +
                  (key === "to" ? "T23:59:59.999Z" : "T00:00:00.000Z"),
              ).toISOString()
            : String(value),
        );
      }
    query.set("page", "1");
    setParams(query);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    await action.run(async () => {
      const payment = await api<Payment>("/transactions", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          amountMinor: Number(values.amountMinor),
        }),
      });
      action.setMessage(
        `Created ${payment.transactionId}. Gateway processing is queued.`,
      );
      setVersion((v) => v + 1);
      form.reset();
    });
  }
  return (
    <>
      <Heading
        eyebrow="PAYMENT OPERATIONS"
        title="Transaction explorer"
        description="Search every payment. Follow every event. Find the exception."
      >
        {canSimulate && (
          <button className="primary" onClick={() => setSimulate(!simulate)}>
            <Plus size={16} />
            Simulate payment
          </button>
        )}
      </Heading>
      {simulate && (
        <Section
          title="Create a simulated payment"
          detail="This gateway never moves real money."
        >
          <form className="inline-form" onSubmit={create}>
            <label>
              Merchant
              <select name="merchantId" required>
                {merchants.data?.items.map((m) => (
                  <option value={m.merchantId} key={m.merchantId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Customer reference
              <input name="customerReference" required minLength={2} />
            </label>
            <label>
              Amount (paise)
              <input
                name="amountMinor"
                type="number"
                min="1"
                max="1000000000000"
                step="1"
                required
              />
            </label>
            <label>
              Payment method
              <select name="paymentMethod">
                <option>UPI</option>
                <option>CARD</option>
                <option>NET_BANKING</option>
                <option>WALLET</option>
              </select>
            </label>
            <label>
              Outcome
              <select name="outcome">
                <option>SUCCESS</option>
                <option>FAILED</option>
                <option>TIMEOUT</option>
              </select>
            </label>
            <button className="primary" disabled={action.busy}>
              Create payment
            </button>
          </form>
          <Feedback {...action} />
        </Section>
      )}
      <section className="panel">
        <form className="filters" onSubmit={filter}>
          <label className="search-input">
            <Search size={17} />
            <input
              name="search"
              aria-label="Search transactions"
              placeholder="Transaction, customer, merchant or gateway reference"
              defaultValue={params.get("search") ?? ""}
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={params.get("status") ?? ""}>
              <option value="">All statuses</option>
              {[
                "PENDING",
                "AUTHORIZED",
                "SUCCESS",
                "FAILED",
                "REFUNDED",
                "PARTIALLY_REFUNDED",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Merchant
            <select
              name="merchantId"
              defaultValue={params.get("merchantId") ?? ""}
            >
              <option value="">All merchants</option>
              {merchants.data?.items.map((m) => (
                <option value={m.merchantId} key={m.merchantId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Method
            <select
              name="paymentMethod"
              defaultValue={params.get("paymentMethod") ?? ""}
            >
              <option value="">All methods</option>
              {["UPI", "CARD", "NET_BANKING", "WALLET"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <details className="advanced">
            <summary>More filters</summary>
            <div>
              <label>
                From
                <input
                  name="from"
                  type="date"
                  defaultValue={params.get("from")?.slice(0, 10)}
                />
              </label>
              <label>
                To
                <input
                  name="to"
                  type="date"
                  defaultValue={params.get("to")?.slice(0, 10)}
                />
              </label>
              <label>
                Minimum (paise)
                <input
                  name="minAmount"
                  type="number"
                  min="0"
                  defaultValue={params.get("minAmount") ?? ""}
                />
              </label>
              <label>
                Maximum (paise)
                <input
                  name="maxAmount"
                  type="number"
                  min="0"
                  defaultValue={params.get("maxAmount") ?? ""}
                />
              </label>
              <label>
                Sort
                <select
                  name="sort"
                  defaultValue={params.get("sort") ?? "-createdAt"}
                >
                  <option value="-createdAt">Newest first</option>
                  <option value="createdAt">Oldest first</option>
                  <option value="-amountMinor">Largest amount</option>
                  <option value="amountMinor">Smallest amount</option>
                </select>
              </label>
            </div>
          </details>
          <button className="primary" type="submit">
            Apply filters
          </button>
        </form>
        <State
          loading={result.loading}
          error={result.error}
          empty={!result.data?.items.length}
        />
        {result.data && !result.loading && !result.error && (
          <>
            <PaymentTable items={result.data.items} />
            <Pagination
              {...result.data}
              onPage={(page) => {
                const next = new URLSearchParams(params);
                next.set("page", String(page));
                setParams(next);
              }}
            />
          </>
        )}
      </section>
    </>
  );
}

export function Investigation() {
  const { transactionId } = useParams();
  const [version, setVersion] = useState(0);
  const { user } = useAuth();
  const action = useAction();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const result = useApi<
    Payment & {
      merchant: Merchant;
      events: Event[];
      refunds: Refund[];
      settlements: {
        settlementId: string;
        amountMinor: number;
        settlementAmountMinor: number;
        status: string;
        settledAt: string;
      }[];
      audit: Audit[];
    }
  >("/transactions/" + transactionId, version);
  const issues = useApi<Page<Incident>>(
    "/incidents?transactionId=" + transactionId,
    version,
  );
  async function refund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    await action.run(async () => {
      await api("/refunds", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          transactionId,
          amountMinor: Number(values.amountMinor),
          reason: values.reason,
        }),
      });
      action.setMessage("Refund queued. Refresh to follow its progress.");
      setKey(crypto.randomUUID());
      setVersion((v) => v + 1);
      form.reset();
    });
  }
  const p = result.data;
  return (
    <>
      <Link className="back-link" to="/transactions">
        <ChevronLeft size={16} />
        Transaction explorer
      </Link>
      <Heading
        eyebrow="TRANSACTION INVESTIGATION"
        title={transactionId ?? "Transaction"}
        description="A complete record of the payment lifecycle."
      >
        <button className="secondary" onClick={() => setVersion((v) => v + 1)}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </Heading>
      <State loading={result.loading} error={result.error} />
      {p && !result.error && (
        <>
          <div className="investigation-summary">
            <div>
              <span className="muted">Payment amount</span>
              <h2>{money(p.amountMinor)}</h2>
              <Badge value={p.status} />
            </div>
            <dl>
              <div>
                <dt>Merchant</dt>
                <dd>{p.merchant?.name ?? p.merchantId}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{p.customerReference}</dd>
              </div>
              <div>
                <dt>Payment method</dt>
                <dd>{label(p.paymentMethod)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{date(p.createdAt)}</dd>
              </div>
            </dl>
          </div>
          <div className="investigation-grid">
            <div>
              <Section
                title="Event timeline"
                detail={`${p.events.length} authoritative events`}
              >
                <ol className="timeline">
                  {p.events.map((e, index) => (
                    <li key={e.eventId}>
                      <span
                        className={
                          e.eventType.includes("FAILED")
                            ? "event-marker failed"
                            : "event-marker"
                        }
                      >
                        {e.eventType.includes("FAILED") ? (
                          <ShieldAlert size={14} />
                        ) : (
                          <Check size={14} />
                        )}
                      </span>
                      <div>
                        <strong>{label(e.eventType)}</strong>
                        <small>
                          {e.source} · <span className="mono">{e.eventId}</span>
                        </small>
                        {Object.keys(e.metadata).length > 0 && (
                          <code>{JSON.stringify(e.metadata)}</code>
                        )}
                      </div>
                      <time>{date(e.timestamp)}</time>
                      <span className="sr-only">Event {index + 1}</span>
                    </li>
                  ))}
                </ol>
              </Section>
              <Section
                title="Reconciliation findings"
                detail="Discrepancies associated with this transaction"
              >
                <State
                  loading={issues.loading}
                  error={issues.error}
                  empty={!issues.data?.items.length}
                />
                {issues.data?.items.map((i) => (
                  <Link
                    className="finding"
                    key={i.incident_id}
                    to={"/incidents/" + i.incident_id}
                  >
                    <div>
                      <strong>{label(i.type)}</strong>
                      <small>
                        Expected {i.expected_value} · Actual {i.actual_value} ·{" "}
                        {i.condition_present
                          ? "Condition present"
                          : "Condition cleared"}
                      </small>
                    </div>
                    <Badge value={i.severity} />
                    <ArrowUpRight size={16} />
                  </Link>
                ))}
              </Section>
              <Section
                title="Refund history"
                detail={`Refunded ${money(p.refundedMinor)} · Reserved ${money(p.reservedRefundMinor)}`}
              >
                <RefundTable items={p.refunds} />
              </Section>
              <Section title="Settlement records">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Settlement</th>
                        <th>Gross</th>
                        <th>Net</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.settlements.map((s, i) => (
                        <tr key={s.settlementId + i}>
                          <td className="mono">{s.settlementId}</td>
                          <td>{money(s.amountMinor)}</td>
                          <td>{money(s.settlementAmountMinor)}</td>
                          <td>
                            <Badge value={s.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!p.settlements.length && (
                  <p className="empty-inline">No settlement received yet.</p>
                )}
              </Section>
            </div>
            <div>
              <Section title="Financial trace">
                <dl className="detail-list">
                  <div>
                    <dt>Ledger debit</dt>
                    <dd>{money(p.ledgerDebitMinor)}</dd>
                  </div>
                  <div>
                    <dt>Merchant credit</dt>
                    <dd>{money(p.merchantCreditMinor)}</dd>
                  </div>
                  <div>
                    <dt>Refund ledger</dt>
                    <dd>{money(p.refundLedgerMinor)}</dd>
                  </div>
                  <div>
                    <dt>Refundable balance</dt>
                    <dd>
                      {money(
                        p.amountMinor - p.refundedMinor - p.reservedRefundMinor,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Settlement due</dt>
                    <dd>{date(p.settlementDueAt)}</dd>
                  </div>
                </dl>
              </Section>
              <Section title="Gateway details">
                <dl className="detail-list">
                  <div>
                    <dt>Gateway</dt>
                    <dd>{p.gateway}</dd>
                  </div>
                  <div>
                    <dt>Reference</dt>
                    <dd className="mono break">{p.gatewayReference}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{date(p.updatedAt)}</dd>
                  </div>
                </dl>
              </Section>
              {!user.demo &&
                ["ADMIN", "FINANCE"].includes(user.role) &&
                ["SUCCESS", "PARTIALLY_REFUNDED"].includes(p.status) && (
                  <Section
                    title="Request refund"
                    detail="Pending refunds reserve the available balance."
                  >
                    <form className="stack-form" onSubmit={refund}>
                      <label>
                        Amount (paise)
                        <input
                          name="amountMinor"
                          type="number"
                          min="1"
                          max={
                            p.amountMinor -
                            p.refundedMinor -
                            p.reservedRefundMinor
                          }
                          step="1"
                          required
                        />
                      </label>
                      <label>
                        Reason
                        <textarea
                          name="reason"
                          minLength={5}
                          maxLength={500}
                          required
                        />
                      </label>
                      <button className="primary" disabled={action.busy}>
                        Queue refund
                      </button>
                      <Feedback {...action} />
                    </form>
                  </Section>
                )}
              <Section title="Audit history">
                <div className="activity">
                  {p.audit.map((a) => (
                    <div key={a.auditId}>
                      <strong>{label(a.action)}</strong>
                      <small>
                        {a.actor} · {date(a.createdAt)}
                      </small>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function Incidents() {
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const result = useApi<Page<Incident>>("/incidents?" + params, version);
  const { user } = useAuth();
  const action = useAction();
  return (
    <>
      <Heading
        eyebrow="RECONCILIATION"
        title="Incident inbox"
        description="Turn payment discrepancies into resolved investigations."
      >
        {!user.demo && ["ADMIN", "FINANCE", "ENGINEER"].includes(user.role) && (
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const job = await api<Job>("/reconciliation/run", {
                  method: "POST",
                });
                action.setMessage(`Reconciliation queued: ${job.jobId}`);
              })
            }
          >
            <Play size={16} />
            Run reconciliation
          </button>
        )}
        <button className="secondary" onClick={() => setVersion((v) => v + 1)}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </Heading>
      <Feedback {...action} />
      <section className="panel">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new URLSearchParams();
            for (const [k, v] of new FormData(e.currentTarget))
              if (v) q.set(k, String(v));
            setParams(q);
          }}
        >
          <label className="search-input">
            <Search size={17} />
            <input
              name="search"
              aria-label="Search incidents"
              defaultValue={params.get("search") ?? ""}
              placeholder="Search transaction or discrepancy"
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={params.get("status") ?? ""}>
              <option value="">All statuses</option>
              {["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select name="severity" defaultValue={params.get("severity") ?? ""}>
              <option value="">All severities</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button className="primary">Apply filters</button>
        </form>
        <State
          loading={result.loading}
          error={result.error}
          empty={!result.data?.items.length}
        />
        {result.data && !result.loading && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Discrepancy</th>
                    <th>Transaction</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((i) => (
                    <tr key={i.incident_id}>
                      <td>
                        <Link
                          className="row-link"
                          to={"/incidents/" + i.incident_id}
                        >
                          {label(i.type)}
                        </Link>
                        <small>
                          {i.condition_present
                            ? "Condition present"
                            : "Condition cleared"}
                        </small>
                      </td>
                      <td>
                        <Link
                          className="mono"
                          to={"/transactions/" + i.transaction_id}
                        >
                          {i.transaction_id}
                        </Link>
                      </td>
                      <td>
                        <Badge value={i.severity} />
                      </td>
                      <td>
                        <Badge value={i.status} />
                      </td>
                      <td className="nowrap muted">{date(i.detected_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              {...result.data}
              onPage={(page) => {
                const next = new URLSearchParams(params);
                next.set("page", String(page));
                setParams(next);
              }}
            />
          </>
        )}
      </section>
    </>
  );
}

export function IncidentDetail() {
  const { incidentId } = useParams(),
    { user } = useAuth();
  const [version, setVersion] = useState(0);
  const result = useApi<Incident>("/incidents/" + incidentId, version),
    users = useApi<{ items: User[] }>("/users");
  const action = useAction();
  const i = result.data;
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!values.note) delete values.note;
    await action.run(async () => {
      await api("/incidents/" + incidentId, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      action.setMessage("Investigation updated.");
      setVersion((v) => v + 1);
    });
  }
  return (
    <>
      <Link className="back-link" to="/incidents">
        <ChevronLeft size={16} />
        Incident inbox
      </Link>
      <Heading
        eyebrow="INCIDENT INVESTIGATION"
        title={i ? label(i.type) : "Investigation"}
        description="Compare the evidence and document your decision."
      />
      <State loading={result.loading} error={result.error} />
      {i && (
        <>
          <div className="incident-header">
            <Badge value={i.severity} />
            <Badge value={i.status} />
            <Link
              className="mono text-link"
              to={"/transactions/" + i.transaction_id}
            >
              {i.transaction_id}
              <ArrowUpRight size={16} />
            </Link>
            <span>
              {i.condition_present
                ? "Condition is still present"
                : "Condition has cleared"}
            </span>
          </div>
          <div className="metrics three">
            <Metric
              title="EXPECTED VALUE"
              value={i.expected_value.toLocaleString()}
              detail="Minor units for monetary rules; count for status rules"
            />
            <Metric
              title="ACTUAL VALUE"
              value={i.actual_value.toLocaleString()}
              detail="Observed during the latest reconciliation"
            />
            <Metric
              title="DIFFERENCE"
              value={i.difference.toLocaleString()}
              detail="Actual value minus expected value"
            />
          </div>
          <div className="investigation-grid">
            <Section
              title="Investigation activity"
              detail={`Detected ${date(i.detected_at)}`}
            >
              <div className="activity">
                {i.activity?.map((a, index) => (
                  <div key={index}>
                    <strong>{label(a.action)}</strong>
                    <small>
                      {a.actor} · {date(a.created_at)}
                    </small>
                    {a.note && <p>{a.note}</p>}
                    {Object.keys(a.metadata).length > 0 && (
                      <code>{JSON.stringify(a.metadata)}</code>
                    )}
                  </div>
                ))}
              </div>
            </Section>
            <Section
              title="Manage incident"
              detail="Keep a clear record of the resolution."
            >
              {!user.demo &&
              ["ADMIN", "FINANCE", "OPERATIONS"].includes(user.role) ? (
                <form className="stack-form" onSubmit={update}>
                  <label>
                    Status
                    <select
                      name="status"
                      defaultValue={i.status}
                      key={i.status}
                    >
                      {[
                        "OPEN",
                        "INVESTIGATING",
                        "RESOLVED",
                        ...(["ADMIN", "FINANCE"].includes(user.role)
                          ? ["IGNORED"]
                          : []),
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Assignee
                    <select
                      name="assignedToReference"
                      defaultValue={i.assigned_to_reference}
                    >
                      <option value="">Unassigned</option>
                      {users.data?.items.map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Investigation note
                    <textarea
                      name="note"
                      maxLength={2000}
                      placeholder="Evidence reviewed, action taken, and resolution…"
                    />
                  </label>
                  <p className="muted">
                    A note is required when resolving or ignoring an incident.
                  </p>
                  <button className="primary" disabled={action.busy}>
                    Save investigation
                  </button>
                  <Feedback {...action} />
                </form>
              ) : (
                <p className="empty-inline">
                  Your access allows viewing investigation history.
                </p>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}

export function Settlements() {
  const [page, setPage] = useState(1),
    [version, setVersion] = useState(0);
  const result = useApi<Page<Settlement> & { jobs: Job[] }>(
      `/settlements?page=${page}`,
      version,
    ),
    { user } = useAuth();
  const action = useAction();
  const active = result.data?.jobs.some((j) =>
    ["QUEUED", "PROCESSING"].includes(j.state),
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setVersion((v) => v + 1), 3000);
    return () => clearInterval(timer);
  }, [active]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      body = new FormData(form);
    await action.run(async () => {
      const job = await api<Job>("/settlements/upload", {
        method: "POST",
        body,
      });
      action.setMessage(`Upload accepted. Job ${job.jobId} is queued.`);
      setVersion((v) => v + 1);
      form.reset();
    });
  }
  return (
    <>
      <Heading
        eyebrow="SETTLEMENT OPERATIONS"
        title="Settlement processing"
        description="Import gateway records and reconcile them against your payments."
      >
        <button className="secondary" onClick={() => setVersion((v) => v + 1)}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </Heading>
      <div className="upload-panel">
        <div className="upload-symbol">
          <Upload size={28} />
        </div>
        <div>
          <h2>Bring your settlement file</h2>
          <p>
            One merchant per CSV · Up to 10 MB or 50,000 rows · Processed in the
            background
          </p>
          <a className="text-link" href="/settlement-template.csv" download>
            <ArrowDownToLine size={15} />
            Download CSV template
          </a>
        </div>
        {!user.demo && ["ADMIN", "FINANCE"].includes(user.role) ? (
          <form onSubmit={upload}>
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              aria-label="Settlement CSV"
              required
            />
            <button className="primary" disabled={action.busy}>
              Upload & process
            </button>
          </form>
        ) : (
          <span className="soft-label">Upload requires finance access</span>
        )}
      </div>
      <Feedback {...action} />
      {!!result.data?.jobs.length && (
        <Section
          title="Processing queue"
          detail="Recent uploads and retry status"
        >
          <div className="job-list">
            {result.data.jobs.map((j) => (
              <div key={j.jobId}>
                <FileText size={20} />
                <div>
                  <strong className="mono">{j.jobId}</strong>
                  <small>
                    {date(j.createdAt)}
                    {j.error && ` · ${j.error}`}
                  </small>
                </div>
                <progress
                  value={j.progress}
                  max={100}
                  aria-label={`Progress for ${j.jobId}`}
                />
                <Badge value={j.state} />
                {j.state === "FAILED" &&
                  !user.demo &&
                  ["ADMIN", "FINANCE", "ENGINEER"].includes(user.role) && (
                    <button
                      className="secondary"
                      onClick={() =>
                        void action.run(async () => {
                          await api("/jobs/" + j.jobId + "/retry", {
                            method: "POST",
                          });
                          setVersion((v) => v + 1);
                        })
                      }
                    >
                      Retry
                    </button>
                  )}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Settlement records">
        <State
          loading={result.loading}
          error={result.error}
          empty={!result.data?.items.length}
        />
        {result.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Settlement</th>
                    <th>Merchant</th>
                    <th>Gross</th>
                    <th>Fees</th>
                    <th>Net</th>
                    <th>Payments</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((s) => (
                    <tr key={s.settlementId}>
                      <td className="mono">
                        {s.settlementId}
                        <small>{s.period}</small>
                      </td>
                      <td>{s.merchantId.replace("MER_", "")}</td>
                      <td>{money(s.grossAmountMinor)}</td>
                      <td>{money(s.feesMinor)}</td>
                      <td className="number">{money(s.netAmountMinor)}</td>
                      <td>{s.transactionCount}</td>
                      <td>
                        <Badge value={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...result.data} onPage={setPage} />
          </>
        )}
      </Section>
    </>
  );
}

function RefundTable({ items }: { items: Refund[] }) {
  if (!items.length)
    return <p className="empty-inline">No refunds recorded.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Refund</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.refundId}>
              <td>
                <Link
                  className="mono row-link"
                  to={"/transactions/" + r.transactionId}
                >
                  {r.refundId}
                </Link>
                <small>{r.reason}</small>
              </td>
              <td>{money(r.amountMinor)}</td>
              <td>
                <Badge value={r.status} />
              </td>
              <td className="nowrap muted">{date(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Refunds() {
  const [page, setPage] = useState(1);
  const result = useApi<Page<Refund>>("/refunds?page=" + page);
  return (
    <>
      <Heading
        eyebrow="FINANCIAL OPERATIONS"
        title="Refund activity"
        description="Track full and partial refunds, reservations, and gateway outcomes."
      />
      <Section
        title="All refunds"
        detail="Open a payment to request a refund or inspect its timeline."
      >
        <State loading={result.loading} error={result.error} />
        {result.data && (
          <>
            <RefundTable items={result.data.items} />
            <Pagination {...result.data} onPage={setPage} />
          </>
        )}
      </Section>
    </>
  );
}
export function AnalyticsPage() {
  const result = useApi<Analytics>("/analytics/overview");
  const d = result.data;
  return (
    <>
      <Heading
        eyebrow="REPORTING"
        title="Payment intelligence"
        description="Operational trends calculated from reconciled records."
      />
      <State loading={result.loading} error={result.error} />
      {d && (
        <>
          <div className="metrics">
            <Metric
              title="SUCCESS RATE"
              value={d.successRate + "%"}
              detail={`${d.success} successful payments`}
            />
            <Metric
              title="SETTLEMENT RATE"
              value={d.settlementRate + "%"}
              detail={`${d.settled} settled payments`}
            />
            <Metric
              title="REFUND RATE"
              value={d.refundRate + "%"}
              detail={`${d.failedRefundCount} failed refund requests`}
            />
            <Metric
              title="RESOLVED INCIDENTS"
              value={d.resolvedIncidents}
              detail={`${d.openIncidents} remain open`}
            />
          </div>
          <Section title="Payment volume" detail="Latest 30 active days">
            <VolumeChart data={d} />
          </Section>
          <div className="dashboard-grid">
            <Section
              title="Reconciliation exceptions"
              detail="Conditions currently present"
            >
              {d.incidentTypes.map((i) => (
                <div className="distribution" key={i.type}>
                  <span>{label(i.type)}</span>
                  <meter
                    min={0}
                    max={Math.max(1, ...d.incidentTypes.map((x) => x.count))}
                    value={i.count}
                  />
                  <strong>{i.count}</strong>
                </div>
              ))}
            </Section>
            <Section
              title="Payment methods"
              detail="Share of processed transactions"
            >
              {d.methods.map((m) => (
                <div className="distribution" key={m.payment_method}>
                  <span>{label(m.payment_method)}</span>
                  <meter
                    min={0}
                    max={Math.max(1, d.transactions)}
                    value={m.count}
                  />
                  <strong>{m.count}</strong>
                </div>
              ))}
            </Section>
          </div>
          <Section title="Merchant volume">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Transactions</th>
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {d.merchants.map((m) => (
                    <tr key={m.merchant_id}>
                      <td>{m.merchant_id.replace("MER_", "")}</td>
                      <td>{m.count}</td>
                      <td>{money(m.volumeMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <p className="muted">
            Projection last updated:{" "}
            {d.lastReconciledAt
              ? date(d.lastReconciledAt)
              : "Awaiting first reconciliation"}
            . Queued changes appear after the worker completes.
          </p>
        </>
      )}
    </>
  );
}
export function Merchants() {
  const [version, setVersion] = useState(0),
    [page, setPage] = useState(1);
  const result = useApi<Page<Merchant>>("/merchants?page=" + page, version),
    { user } = useAuth();
  const action = useAction();
  return (
    <>
      <Heading
        eyebrow="ORGANIZATION"
        title="Merchants"
        description="Merchant references and settlement account mappings."
      />
      {!user.demo && user.role === "ADMIN" && (
        <Section title="Add merchant">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = Object.fromEntries(new FormData(form));
              void action.run(async () => {
                await api("/merchants", {
                  method: "POST",
                  body: JSON.stringify(values),
                });
                setVersion((v) => v + 1);
                form.reset();
                action.setMessage("Merchant created.");
              });
            }}
          >
            <label>
              Name
              <input name="name" required minLength={2} />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Settlement account reference
              <input name="settlementAccountReference" required minLength={3} />
            </label>
            <button className="primary" disabled={action.busy}>
              Add merchant
            </button>
          </form>
          <Feedback {...action} />
        </Section>
      )}
      <Section title="Organization merchants">
        <State loading={result.loading} error={result.error} />
        {result.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Reference</th>
                    <th>Email</th>
                    <th>Settlement account</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((m) => (
                    <tr key={m.merchantId}>
                      <td>
                        <strong>{m.name}</strong>
                      </td>
                      <td className="mono">{m.merchantId}</td>
                      <td>{m.email}</td>
                      <td>{m.settlementAccountReference}</td>
                      <td>
                        <Badge value={m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...result.data} onPage={setPage} />
          </>
        )}
      </Section>
    </>
  );
}
export function AuditPage() {
  const [page, setPage] = useState(1),
    result = useApi<Page<Audit>>("/audit?page=" + page);
  return (
    <>
      <Heading
        eyebrow="GOVERNANCE"
        title="Audit history"
        description="Server-attributed operational actions. Incident decisions are recorded in each investigation."
      />
      <Section title="Operational audit trail">
        <State loading={result.loading} error={result.error} />
        {result.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Entity</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((a) => (
                    <tr key={a.auditId}>
                      <td>{label(a.action)}</td>
                      <td className="mono">{a.actor}</td>
                      <td className="mono">{a.entityId}</td>
                      <td>{date(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...result.data} onPage={setPage} />
          </>
        )}
      </Section>
    </>
  );
}
export function Admin() {
  const [version, setVersion] = useState(0),
    result = useApi<{ items: User[] }>("/users", version),
    { user } = useAuth(),
    action = useAction();
  const editable = !user.demo && user.role === "ADMIN";
  return (
    <>
      <Heading
        eyebrow="ACCESS CONTROL"
        title="Workspace administration"
        description="Manage organization members and role-based permissions."
      />
      {editable && (
        <Section title="Create member">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = Object.fromEntries(new FormData(form));
              void action.run(async () => {
                await api("/users", {
                  method: "POST",
                  body: JSON.stringify(values),
                });
                form.reset();
                setVersion((v) => v + 1);
                action.setMessage("Member created.");
              });
            }}
          >
            <label>
              Name
              <input name="name" required minLength={2} />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Initial password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
              />
            </label>
            <label>
              Role
              <select name="role">
                {["VIEWER", "OPERATIONS", "FINANCE", "ENGINEER", "ADMIN"].map(
                  (r) => (
                    <option key={r}>{r}</option>
                  ),
                )}
              </select>
            </label>
            <button className="primary" disabled={action.busy}>
              Create member
            </button>
          </form>
        </Section>
      )}
      <Feedback {...action} />
      <Section title="Members" detail="Permissions are enforced by the API.">
        <State loading={result.loading} error={result.error} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {result.data?.items.map((u) => (
                <tr key={u.userId}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {editable && !u.demo && u.userId !== user.userId ? (
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        onChange={(e) =>
                          void action.run(async () => {
                            await api("/users/" + u.userId, {
                              method: "PATCH",
                              body: JSON.stringify({ role: e.target.value }),
                            });
                            setVersion((v) => v + 1);
                          })
                        }
                      >
                        {[
                          "VIEWER",
                          "OPERATIONS",
                          "FINANCE",
                          "ENGINEER",
                          "ADMIN",
                        ].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge value={u.role} />
                    )}
                  </td>
                  <td>{u.demo ? "Read-only demo" : "Organization member"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
