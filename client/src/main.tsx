import React, { createContext, useContext, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  ArrowLeftRight,
  ChartNoAxesCombined,
  ChevronDown,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  ShieldCheck,
  Store,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, setCsrf } from "./api";
import { State } from "./components";
import type { User } from "./types";
import {
  Dashboard,
  Transactions,
  Investigation,
  Incidents,
  IncidentDetail,
  Settlements,
  AnalyticsPage,
  Refunds,
  Merchants,
  AuditPage,
  Admin,
} from "./pages";
import "./styles.css";
type Auth = { user: User; organization: string; reload: () => Promise<void> };
const AuthContext = createContext<Auth | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Authentication context required");
  return value;
}
function App() {
  const [auth, setAuth] = useState<{ user: User; organization: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function reload() {
    try {
      const result = await api<{
        user: User;
        organization: string;
        csrf: string;
      }>("/auth/me");
      setCsrf(result.csrf);
      setAuth(result);
      setError("");
    } catch (e) {
      setAuth(undefined);
      if ((e as { status?: number }).status !== 401)
        setError(e instanceof Error ? e.message : "Unable to connect");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  if (loading) return <State loading />;
  if (!auth) return <Login reload={reload} connectionError={error} />;
  return (
    <AuthContext.Provider value={{ ...auth, reload }}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route
            path="transactions/:transactionId"
            element={<Investigation />}
          />
          <Route path="incidents" element={<Incidents />} />
          <Route path="incidents/:incidentId" element={<IncidentDetail />} />
          <Route path="settlements" element={<Settlements />} />
          <Route path="refunds" element={<Refunds />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="merchants" element={<Merchants />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="administration" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}
function Login({
  reload,
  connectionError,
}: {
  reload: () => Promise<void>;
  connectionError: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(connectionError);
  async function login(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = event
        ? Object.fromEntries(new FormData(event.currentTarget))
        : undefined;
      const result = await api<{ csrf: string }>(
        event ? "/auth/login" : "/auth/demo",
        { method: "POST", body: event ? JSON.stringify(values) : undefined },
      );
      setCsrf(result.csrf);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="login-story">
        <div className="brand">
          <ScanLine size={32} />
          <span>LedgerLens</span>
        </div>
        <div>
          <span className="eyebrow">PAYMENT OPERATIONS, IN FOCUS</span>
          <h1>
            Every payment
            <br />
            has a story.
            <br />
            <em>Find the truth.</em>
          </h1>
          <p>
            Follow the money from gateway to ledger to settlement. Investigate
            exceptions with the whole picture.
          </p>
          <div className="story-flow">
            <span>Payment</span>
            <i />
            <span>Ledger</span>
            <i />
            <span>Settlement</span>
          </div>
        </div>
        <small>
          Investigate transactions. Detect inconsistencies. Reconcile payments.
        </small>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="eyebrow">OPERATIONS WORKSPACE</span>
          <h2>Welcome to LedgerLens</h2>
          <p className="muted">Sign in to your organization’s workspace.</p>
          <form onSubmit={login}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@company.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={12}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? "Connecting…" : "Sign in"}
            </button>
          </form>
          <div className="divider">
            <span>EXPLORE THE PLATFORM</span>
          </div>
          <button
            className="secondary full"
            disabled={busy}
            onClick={() => void login()}
          >
            Open demo workspace <ArrowLeftRight size={16} />
          </button>
          <p className="demo-note">
            <ShieldCheck size={18} />
            Read-only access. Simulated payments. No signup needed.
          </p>
        </div>
      </section>
    </div>
  );
}
const nav = [
  { path: "/", name: "Overview", icon: LayoutDashboard },
  { path: "/transactions", name: "Transactions", icon: ArrowLeftRight },
  { path: "/incidents", name: "Incidents", icon: ShieldCheck },
  { path: "/settlements", name: "Settlements", icon: Upload },
  { path: "/refunds", name: "Refunds", icon: FileClock },
  { path: "/analytics", name: "Analytics", icon: ChartNoAxesCombined },
  { path: "/merchants", name: "Merchants", icon: Store },
  { path: "/audit", name: "Audit history", icon: Activity },
  { path: "/administration", name: "Administration", icon: Users },
];
function Shell() {
  const { user, organization, reload } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    await reload();
    navigate("/");
  }
  return (
    <div className="app-shell">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <NavLink to="/" className="brand">
          <ScanLine size={29} />
          <span>
            LedgerLens<small>PAYMENT OPERATIONS</small>
          </span>
        </NavLink>
        <button
          className="mobile-close icon-button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <div className="organization">
          <div className="org-avatar">N</div>
          <div>
            <strong>{organization}</strong>
            <small>Organization workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ path, name, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={() => setOpen(false)}
            >
              <Icon size={19} />
              {name}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="mode">
            <ShieldCheck size={17} />
            {user.demo ? "Read-only demo" : "Simulated gateway"}
          </div>
          <p>
            Payments without real money.
            <br />
            Investigations with real context.
          </p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>Payment operations</strong>
          </div>
          <div className="account">
            <span className="environment">SANDBOX</span>
            <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role.toLowerCase()}</small>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {user.demo && (
          <div className="demo-banner">
            You’re exploring NovaPay’s demo workspace. All records are
            simulated; changes are disabled.
          </div>
        )}
        <main>
          <Outlet />
        </main>
        <footer>
          LedgerLens{" "}
          <span>Payment reconciliation & transaction investigation</span>
        </footer>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
