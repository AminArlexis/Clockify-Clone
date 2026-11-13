import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Download,
  FileClock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Square,
  Tags,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppStoreProvider, useAppStore } from "./store/AppStore";
import { entriesToCsv, filterEntries, type EntryFilters } from "./lib/domain";
import { supabase, isSupabaseConfigured } from "./lib/supabase";
import {
  claimWorkspaceInvitesInSupabase,
  fetchAppDataFromSupabase,
} from "./lib/supabaseSync";
import type { AppData, EntryInput, Page, Project, Tag, Task, TimeEntry, User } from "./types";

const id = (prefix: string) => `${prefix}-${Date.now()}`;
const dateKey = (date: Date | string) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const minutesBetween = (start: string, end?: string) =>
  Math.max(
    0,
    Math.round(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 60000),
  );
const entryMinutes = (entry: TimeEntry) =>
  entry.segments
    .filter((segment) => segment.type === "work")
    .reduce((sum, segment) => sum + minutesBetween(segment.start, segment.end), 0);
const breakMinutes = (entry: TimeEntry) =>
  entry.segments
    .filter((segment) => segment.type === "break")
    .reduce((sum, segment) => sum + minutesBetween(segment.start, segment.end), 0);
const fmtDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const startOfWeek = (value = new Date()) => {
  const d = new Date(value);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};
const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");

const pageMeta: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "A clear view of your week" },
  tracker: { title: "Time tracker", subtitle: "Track and review your work" },
  calendar: { title: "Calendar", subtitle: "See where your time goes" },
  timesheet: { title: "Timesheet", subtitle: "Your weekly work at a glance" },
  projects: { title: "Projects", subtitle: "Manage projects and tasks" },
  tags: { title: "Tags", subtitle: "Organize time with flexible labels" },
  reports: { title: "Reports", subtitle: "Analyze and export tracked time" },
  team: { title: "Team", subtitle: "Manage people and access" },
  audit: { title: "Audit log", subtitle: "Review workspace activity" },
  settings: { title: "Settings", subtitle: "Personalize your workspace" },
};

function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={cn("button", `button-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className={cn("modal", wide && "modal-wide")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function SelectField({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}

type AuthMode = "login" | "register" | "forgot" | "reset" | "verify";

function PublicLanding({ navigate }: { navigate: (path: string) => void }) {
  const features = [
    {
      icon: Clock3,
      title: "Effortless tracking",
      body: "Start, pause, and finish focused sessions without breaking your flow.",
    },
    {
      icon: CalendarDays,
      title: "A clearer week",
      body: "Review every project, break, and work block in one calm calendar.",
    },
    {
      icon: BarChart3,
      title: "Useful insights",
      body: "Turn shared activity into reports your team can actually act on.",
    },
    {
      icon: Users,
      title: "Team visibility",
      body: "Give members autonomy while admins retain the context they need.",
    },
  ];
  return (
    <div className="landing">
      <header className="landing-nav">
        <button className="landing-logo" onClick={() => navigate("/")} aria-label="TimeFlow home">
          <span className="brand-mark">
            <Clock3 size={20} />
          </span>
          <strong>TimeFlow</strong>
        </button>
        <nav aria-label="Public navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#benefits">Benefits</a>
        </nav>
        <div className="landing-actions">
          <Button variant="ghost" onClick={() => navigate("/login")}>
            Log in
          </Button>
          <Button onClick={() => navigate("/register")}>Start for free</Button>
        </div>
      </header>
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="landing-badge">
              <Activity size={13} /> Built for focused teams
            </span>
            <h1>Time tracking that gets out of your way.</h1>
            <p>
              TimeFlow brings timers, timesheets, project clarity, and useful reporting into one
              thoughtful workspace.
            </p>
            <div className="hero-actions">
              <Button onClick={() => navigate("/register")}>
                Create your workspace <ChevronRight size={16} />
              </Button>
              <Button variant="secondary" onClick={() => navigate("/login")}>
                Log in
              </Button>
            </div>
            <div className="hero-proof">
              <span>
                <Check size={14} /> No credit card
              </span>
              <span>
                <Check size={14} /> Ready in minutes
              </span>
            </div>
          </div>
          <div className="product-window" aria-label="TimeFlow workspace overview">
            <div className="window-bar">
              <i />
              <i />
              <i />
              <span>TimeFlow / Workspace</span>
            </div>
            <div className="preview-shell">
              <aside>
                <div className="preview-brand">
                  <Clock3 size={15} />
                </div>
                {[LayoutDashboard, Clock3, CalendarDays, FolderKanban, BarChart3].map(
                  (Icon, index) => (
                    <span className={index === 0 ? "active" : ""} key={index}>
                      <Icon size={15} />
                    </span>
                  ),
                )}
              </aside>
              <div className="preview-content">
                <header>
                  <div>
                    <small>YOUR WORKSPACE</small>
                    <strong>Projects, time, and reports in one place.</strong>
                  </div>
                  <Clock3 size={20} />
                </header>
                <div className="preview-chart">
                  <div className="preview-chart-title">
                    <strong>Connected tools</strong>
                    <span>Supabase</span>
                  </div>
                  <div className="preview-kpis">
                    <div>
                      <small>Track</small>
                      <strong>Time</strong>
                    </div>
                    <div>
                      <small>Organize</small>
                      <strong>Projects</strong>
                    </div>
                    <div>
                      <small>Review</small>
                      <strong>Reports</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="landing-section" id="features">
          <div className="landing-section-heading">
            <span className="eyebrow">Everything in one place</span>
            <h2>Know where the workday went.</h2>
            <p>A connected toolkit for individual focus and team-wide clarity.</p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article key={feature.title}>
                <span>
                  <feature.icon size={21} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-section how-section" id="how-it-works">
          <div className="landing-section-heading">
            <span className="eyebrow">Simple by design</span>
            <h2>From intention to insight in three steps.</h2>
          </div>
          <div className="step-grid">
            {[
              {
                n: "01",
                t: "Choose your work",
                b: "Pick a project, task, and the labels that add useful context.",
              },
              {
                n: "02",
                t: "Stay in flow",
                b: "Start your timer, pause for breaks, or add time after the fact.",
              },
              {
                n: "03",
                t: "Learn and improve",
                b: "Review trends and share focused reports with your team.",
              },
            ].map((step) => (
              <article key={step.n}>
                <span>{step.n}</span>
                <h3>{step.t}</h3>
                <p>{step.b}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-section benefit-section" id="benefits">
          <div>
            <span className="eyebrow">Built for better work</span>
            <h2>Less time managing time.</h2>
            <p>
              TimeFlow keeps daily tracking lightweight while giving leaders the reliable picture
              they need.
            </p>
            <ul>
              <li>
                <Check size={16} /> One shared source of truth
              </li>
              <li>
                <Check size={16} /> Flexible manual and live tracking
              </li>
              <li>
                <Check size={16} /> Reports that match active filters
              </li>
              <li>
                <Check size={16} /> Clear admin and member experiences
              </li>
            </ul>
          </div>
          <div className="benefit-card">
            <span className="benefit-icon">
              <Activity size={22} />
            </span>
            <small>YOUR WORKSPACE</small>
            <strong>In sync</strong>
            <p>Use your own projects and time records.</p>
            <div className="focus-line">
              <i />
            </div>
          </div>
        </section>
        <section className="landing-cta">
          <span className="eyebrow">Make time visible</span>
          <h2>Start building a more focused week.</h2>
          <p>Create an account to start using your Supabase-connected workspace.</p>
          <Button onClick={() => navigate("/register")}>
            Start tracking for free <ChevronRight size={16} />
          </Button>
        </section>
      </main>
      <footer className="landing-footer">
        <button className="landing-logo" onClick={() => navigate("/")}>
          <span className="brand-mark">
            <Clock3 size={18} />
          </span>
          <strong>TimeFlow</strong>
        </button>
        <p>Thoughtful time tracking for modern teams.</p>
        <div>
          <button onClick={() => navigate("/login")}>Log in</button>
          <button onClick={() => navigate("/register")}>Create account</button>
        </div>
        <small>© {new Date().getFullYear()} TimeFlow.</small>
      </footer>
    </div>
  );
}

function AuthScreen({
  initialMode,
  navigate,
}: {
  initialMode: AuthMode;
  navigate: (path: string) => void;
}) {
  const { login, register, dataError } = useAppStore();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => {
    const saved = sessionStorage.getItem("authNotice") || "";
    sessionStorage.removeItem("authNotice");
    return saved;
  });
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{
    name: string;
    email: string;
    password?: string;
    verificationCode?: string;
  } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);
  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setSent(false);
    navigate(`/${next}`);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const client = supabase;
    if (!client) {
      setLoading(false);
      setError("Supabase is not configured. Add the project URL and anon key to .env.local.");
      return;
    }
    if (mode === "forgot") {
      void client.auth
        .resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset`,
        })
        .then(({ error: resetError }) => {
          if (resetError) setError(resetError.message);
          else setSent(true);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not request a password reset.");
        })
        .finally(() => {
          setLoading(false);
        });
      return;
    }
    if (mode === "reset") {
      const password = String(form.get("password") || "");
      const confirmation = String(form.get("confirmation") || "");
      if (password !== confirmation) {
        setError("Passwords must match.");
        setLoading(false);
        return;
      }
      void client.auth
        .updateUser({ password })
        .then(({ error: updateError }) => {
          if (updateError) setError(updateError.message);
          else setSent(true);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not update your password.");
        })
        .finally(() => {
          setLoading(false);
        });
      return;
    }
    if (mode === "register") {
      const name = String(form.get("name") || "");
      const password = String(form.get("password") || "");
      if (isSupabaseConfigured) {
        client.auth
          .signUp({
            email,
            password,
            options: {
              data: { full_name: name },
            },
          })
          .then(async ({ data: signUpData, error: signUpError }) => {
            if (signUpError) {
              setLoading(false);
              setError(signUpError.message);
              return;
            }
            if (signUpData.session) {
              // Naka-off ang Confirm email: gumawa ng account, tapos diretso sa login.
              await client.auth.signOut();
              setLoading(false);
              sessionStorage.setItem("authNotice", "Account created! Please sign in.");
              changeMode("login");
              return;
            }
            setLoading(false);
            setPending({ name, email, password });
            setResendCooldown(60);
            setMode("verify");
            navigate("/verify");
          })
          .catch((err) => {
            setLoading(false);
            setError(err instanceof Error ? err.message : "Failed to sign up.");
          });
        return;
      }
    }
    if (mode === "login") {
      const password = String(form.get("password") || "");

      if (isSupabaseConfigured) {
        client.auth
          .signInWithPassword({
            email,
            password,
          })
          .then(async ({ data: authData, error: authError }) => {
            if (authError) {
              setLoading(false);
              setError(authError.message || "Invalid email or password.");
              return;
            }

            if (authData.user) {
              const userName = authData.user.user_metadata?.full_name || email.split("@")[0];
              await claimWorkspaceInvitesInSupabase();
              const remoteData = await fetchAppDataFromSupabase(authData.user.id);
              const existingUser = remoteData?.users.find(
                (user) => user.id === authData.user.id,
              );
              if (remoteData && existingUser) {
                if (!login(email, existingUser, remoteData)) {
                  throw new Error("This account does not have active access to a workspace.");
                }
              } else {
                await register(userName, email, authData.user.id);
              }
              navigate("/dashboard");
            }
            setLoading(false);
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Could not sign in.");
            setLoading(false);
          });
        return;
      }
    }
    setLoading(false);
    setError("Supabase is not configured. Add the project URL and anon key to .env.local.");
  };
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark large">
          <Clock3 size={27} />
        </div>
        <div>
          <span className="eyebrow">TimeFlow</span>
          <h1>Make every hour count.</h1>
          <p>One calm place for focused work, team visibility, and better decisions.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="mobile-brand">
            <div className="brand-mark">
              <Clock3 size={21} />
            </div>
            <strong>TimeFlow</strong>
          </div>
          <button className="auth-home" onClick={() => navigate("/")}>
            <ChevronLeft size={15} /> Back to home
          </button>
          <span className="eyebrow">
            {mode === "register"
              ? "Start for free"
              : mode === "forgot"
                ? "Account recovery"
                : mode === "reset"
                  ? "Choose a new password"
                  : mode === "verify"
                    ? "Verify your email"
                    : "Welcome back"}
          </span>
          <h2>
            {mode === "register"
              ? "Create your account"
              : mode === "forgot"
                ? "Find your account"
                : mode === "reset"
                  ? "Reset your password"
                  : mode === "verify"
                    ? "Check your inbox"
                    : "Sign in to TimeFlow"}
          </h2>
          <p className="muted">
            {mode === "verify"
              ? `We sent a verification code to ${pending?.email || "your email"}.`
              : mode === "forgot"
                ? "We’ll send a secure password reset link to your email."
                : mode === "reset"
                  ? "Use at least six characters for your new password."
                  : "Continue to your team workspace."}
          </p>
          {dataError && (
            <p className="form-error" role="alert">
              {dataError}
            </p>
          )}
          {mode === "verify" ? (
            <div className="verification-panel">
              <span
                style={{
                  display: "inline-flex",
                  padding: "10px",
                  borderRadius: "50%",
                  background: "#eff6ff",
                  color: "#2563eb",
                  marginBottom: "8px",
                }}
              >
                <Clock3 size={28} />
              </span>
              <p style={{ margin: "4px 0" }}>
                A confirmation code has been dispatched to <strong>{pending?.email}</strong>.
              </p>
              <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 12px 0" }}>
                Check your inbox (and spam folder) for the confirmation link or enter the 6-digit
                code.
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  width: "100%",
                  margin: "8px 0",
                }}
              >
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter 6-digit code"
                  style={{
                    textAlign: "center",
                    fontSize: "18px",
                    letterSpacing: "4px",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                  }}
                />
                {error && <span style={{ color: "#ef4444", fontSize: "13px" }}>{error}</span>}
                {notice && <span style={{ color: "#118564", fontSize: "13px" }}>{notice}</span>}
              </div>
              <Button
                disabled={loading}
                onClick={async () => {
                  if (!pending) return;
                  const cleanCode = otpCode.trim();
                  if (!cleanCode || cleanCode.length < 6) {
                    setError("Please enter the complete 6-digit confirmation code.");
                    return;
                  }

                  setLoading(true);
                  setError("");
                  setNotice("");

                  if (isSupabaseConfigured && supabase) {
                    try {
                      let { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
                        email: pending.email,
                        token: cleanCode,
                        type: "signup",
                      });

                      if (verifyError) {
                        const fallback = await supabase.auth.verifyOtp({
                          email: pending.email,
                          token: cleanCode,
                          type: "email",
                        });
                        verifyData = fallback.data;
                        verifyError = fallback.error;
                      }

                      if (verifyError) {
                        setLoading(false);
                        setError(verifyError.message || "Invalid or expired verification code.");
                        return;
                      }

                      const user = verifyData.user || (await supabase.auth.getUser()).data.user;
                      if (!user) {
                        setLoading(false);
                        setError(
                          "Email verified, but no Supabase user session was returned. Sign in to continue.",
                        );
                        return;
                      }
                      await register(pending.name, pending.email, user.id);
                      navigate("/dashboard");
                      setLoading(false);
                    } catch (err: unknown) {
                      setLoading(false);
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Verification failed. Please try again.",
                      );
                    }
                  } else {
                    setLoading(false);
                    setError(
                      "Supabase is not configured. Add the project URL and anon key to .env.local.",
                    );
                  }
                }}
              >
                {loading ? "Verifying..." : "Verify & complete registration"}
              </Button>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  marginTop: "8px",
                }}
              >
                <button
                  className="text-button"
                  disabled={resending || resendCooldown > 0}
                  onClick={async () => {
                    if (!pending?.email || resendCooldown > 0) return;
                    setResending(true);
                    setError("");
                    setNotice("");
                    try {
                      if (!supabase) throw new Error("Supabase is not configured.");
                      const { error: resendError } = await supabase.auth.resend({
                        type: "signup",
                        email: pending.email,
                      });
                      if (resendError) {
                        setError(resendError.message);
                      } else {
                        setOtpCode("");
                        setResendCooldown(60);
                        setNotice(
                          "New confirmation code sent! Use only the latest code in your inbox.",
                        );
                      }
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Failed to resend confirmation email.",
                      );
                    } finally {
                      setResending(false);
                    }
                  }}
                >
                  {resending
                    ? "Sending..."
                    : resendCooldown > 0
                      ? `Resend code (${resendCooldown}s)`
                      : "Resend email"}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setError("");
                    changeMode("register");
                  }}
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : sent ? (
            <div className="success-panel">
              <Check size={22} />
              <div>
                <strong>{mode === "reset" ? "Password updated" : "Recovery link sent"}</strong>
                <p>
                  {mode === "reset"
                    ? "You can now sign in with your new password."
                    : "Use the reset link sent to your email to choose a new password."}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => (mode === "reset" ? changeMode("login") : changeMode("reset"))}
              >
                {mode === "reset" ? "Return to login" : "Open reset form"}
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="auth-form">
              {mode === "register" && (
                <label className="field">
                  <span>Full name</span>
                  <input name="name" required placeholder="Alex Morgan" />
                </label>
              )}
              {mode !== "reset" && (
                <label className="field">
                  <span>Work email</span>
                  <input name="email" type="email" required placeholder="you@company.com" />
                </label>
              )}
              {(mode === "login" || mode === "register" || mode === "reset") && (
                <label className="field">
                  <span>{mode === "reset" ? "New password" : "Password"}</span>
                  <input name="password" type="password" required minLength={6} />
                </label>
              )}
              {mode === "reset" && (
                <label className="field">
                  <span>Confirm password</span>
                  <input name="confirmation" type="password" required minLength={6} />
                </label>
              )}
              {notice && (
                <p style={{ color: "#16a34a", fontSize: "14px", margin: 0 }} role="status">
                  {notice}
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
              <Button type="submit" disabled={loading} aria-busy={loading}>
                {loading
                  ? "Please wait…"
                  : mode === "register"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Send recovery link"
                      : mode === "reset"
                        ? "Update password"
                        : "Sign in"}
              </Button>
            </form>
          )}
          {mode === "login" && (
            <>
              <button
                className="text-button forgot"
                onClick={() => {
                  changeMode("forgot");
                }}
              >
                Forgot password?
              </button>
            </>
          )}
          <p className="auth-switch">
            {mode === "login" ? "New to TimeFlow?" : "Already have an account?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                changeMode(mode === "login" ? "register" : "login");
              }}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

const navItems: Array<{ page: Page; label: string; icon: typeof Activity; admin?: boolean }> = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "tracker", label: "Time tracker", icon: Clock3 },
  { page: "calendar", label: "Calendar", icon: CalendarDays },
  { page: "timesheet", label: "Timesheet", icon: FileClock },
  { page: "projects", label: "Projects", icon: FolderKanban },
  { page: "tags", label: "Tags", icon: Tags },
  { page: "reports", label: "Reports", icon: BarChart3 },
  { page: "team", label: "Team", icon: Users, admin: true },
  { page: "audit", label: "Audit log", icon: FileText, admin: true },
  { page: "settings", label: "Settings", icon: Settings },
];

function AppShell() {
  const { data, currentUser, logout, switchWorkspace, dataError } = useAppStore();
  const [page, setPage] = useState<Page>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const activeWorkspace = data.workspaces.find(
    (workspace) => workspace.id === data.activeWorkspaceId,
  );
  const navigate = (next: Page) => {
    setPage(next);
    setMobileOpen(false);
  };
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={cn(
          "sidebar",
          collapsed && "sidebar-collapsed",
          mobileOpen && "sidebar-mobile-open",
        )}
      >
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Clock3 size={20} />
          </div>
          {!collapsed && <strong>TimeFlow</strong>}
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Collapse sidebar"
          >
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          </button>
        </div>
        <div className="workspace-card">
          <span className="workspace-avatar">{activeWorkspace?.name[0]}</span>
          {!collapsed && (
            <label>
              <small>Workspace</small>
              <select
                value={data.activeWorkspaceId}
                onChange={(e) => switchWorkspace(e.target.value)}
              >
                {data.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <nav>
          <span className="nav-label">{!collapsed && "Workspace"}</span>
          {navItems
            .filter((item) => !item.admin || currentUser?.role === "admin")
            .map((item) => (
              <button
                key={item.page}
                className={cn("nav-item", page === item.page && "active")}
                onClick={() => navigate(item.page)}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.label}</span>}
                {item.page === "tracker" && data.activeTimer && !collapsed && (
                  <i className="live-dot" />
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-help">
          {!collapsed && (
            <>
              <span className="eyebrow">Supabase</span>
              <p>Workspace data is synced to your database.</p>
            </>
          )}
          <button className="icon-button" title="Workspace data is synced to Supabase">
            <Activity size={17} />
          </button>
        </div>
      </aside>
      <section className={cn("main-shell", collapsed && "main-shell-expanded")}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="page-heading">
            <h1>{pageMeta[page].title}</h1>
            <p>{pageMeta[page].subtitle}</p>
          </div>
          <div className="topbar-actions">
            {data.activeTimer && page !== "tracker" && (
              <button className="mini-timer" onClick={() => setPage("tracker")}>
                <span className="live-dot" />
                <TimerClock /> <ChevronRight size={15} />
              </button>
            )}
            <div className="popover-wrap">
              <button
                className="icon-button"
                onClick={() => setNoticesOpen(!noticesOpen)}
                aria-label="Notifications"
              >
                <Bell size={19} />
                <i className="notification-dot" />
              </button>
              {noticesOpen && (
                <div className="popover notifications">
                  <strong>Notifications</strong>
                  <p>No new notifications.</p>
                </div>
              )}
            </div>
            <div className="popover-wrap">
              <button className="profile-button" onClick={() => setProfileOpen(!profileOpen)}>
                <span className="avatar">{currentUser?.avatar}</span>
                <span className="profile-name">
                  <strong>{currentUser?.name}</strong>
                  <small>{currentUser?.role}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {profileOpen && (
                <div className="popover profile-popover">
                  <button
                    onClick={() => {
                      setPage("settings");
                      setProfileOpen(false);
                    }}
                  >
                    <Settings size={16} /> Profile settings
                  </button>
                  <button onClick={logout}>
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          {dataError && (
            <p className="form-error" role="alert">
              {dataError}
            </p>
          )}
          {page === "dashboard" && <DashboardPage onNavigate={setPage} />}
          {page === "tracker" && <TrackerPage />}
          {page === "calendar" && <CalendarPage />}
          {page === "timesheet" && <TimesheetPage />}
          {page === "projects" && <ProjectsPage />}
          {page === "tags" && <TagsPage />}
          {page === "reports" && <ReportsPage />}
          {page === "team" && <TeamPage />}
          {page === "audit" && <AuditPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </section>
    </div>
  );
}

function TimerClock() {
  const { data } = useAppStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const mins =
    data.activeTimer?.segments
      .filter((segment) => segment.type === "work")
      .reduce((sum, segment) => sum + minutesBetween(segment.start, segment.end), 0) || 0;
  const seconds = data.activeTimer
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(data.activeTimer.startedAt).getTime()) / 1000) % 60,
      )
    : 0;
  return (
    <strong>{`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}</strong>
  );
}

function DashboardPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { data, currentUser } = useAppStore();
  const visible = data.entries.filter(
    (entry) => currentUser?.role === "admin" || entry.userId === currentUser?.id,
  );
  const today = visible.filter((entry) => dateKey(entry.start) === dateKey(new Date()));
  const monday = startOfWeek().getTime();
  const week = visible.filter((entry) => new Date(entry.start).getTime() >= monday);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startOfWeek());
    date.setDate(date.getDate() + index);
    return {
      day: date.toLocaleDateString([], { weekday: "short" }),
      hours: +(
        visible
          .filter((e) => dateKey(e.start) === dateKey(date))
          .reduce((sum, e) => sum + entryMinutes(e), 0) / 60
      ).toFixed(1),
    };
  });
  const projects = data.projects
    .map((project) => ({
      name: project.name,
      value: visible
        .filter((e) => e.projectId === project.id)
        .reduce((sum, e) => sum + entryMinutes(e), 0),
      color: project.color,
    }))
    .filter((item) => item.value);
  const kpis = [
    {
      label: "Today",
      value: fmtDuration(today.reduce((sum, e) => sum + entryMinutes(e), 0)),
      note: `${today.length} entries`,
      icon: Clock3,
    },
    {
      label: "This week",
      value: fmtDuration(week.reduce((sum, e) => sum + entryMinutes(e), 0)),
      note: "Monday–today",
      icon: CalendarDays,
    },
    {
      label: "Break time",
      value: fmtDuration(week.reduce((sum, e) => sum + breakMinutes(e), 0)),
      note: "This week",
      icon: CirclePause,
    },
    {
      label: "Sessions",
      value: String(week.length),
      note: data.activeTimer ? "1 currently active" : "No active timer",
      icon: Activity,
    },
  ];
  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">
            Good {new Date().getHours() < 12 ? "morning" : "afternoon"},{" "}
            {currentUser?.name.split(" ")[0]}
          </span>
          <h2>Your week is moving forward.</h2>
          <p>Here’s how your team’s focus is shaping up.</p>
        </div>
        <Button onClick={() => onNavigate("tracker")}>
          <Play size={16} fill="currentColor" /> Track time
        </Button>
      </section>
      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <article className="kpi-card" key={kpi.label}>
            <span className="kpi-icon">
              <kpi.icon size={19} />
            </span>
            <div>
              <p>{kpi.label}</p>
              <strong>{kpi.value}</strong>
              <small>{kpi.note}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card chart-card span-2">
          <div className="card-header">
            <div>
              <h3>Weekly activity</h3>
              <p>Net tracked hours by day</p>
            </div>
            <span className="status-pill neutral">This week</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5068e9" stopOpacity=".28" />
                    <stop offset="100%" stopColor="#5068e9" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} width={30} />
                <Tooltip formatter={(value) => [`${value}h`, "Tracked"]} />
                <Area
                  type="monotone"
                  dataKey="hours"
                  stroke="#5068e9"
                  strokeWidth={2.5}
                  fill="url(#activityFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card chart-card">
          <div className="card-header">
            <div>
              <h3>Project distribution</h3>
              <p>All tracked activity</p>
            </div>
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={projects}
                  dataKey="value"
                  innerRadius={58}
                  outerRadius={78}
                  paddingAngle={3}
                >
                  {projects.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => fmtDuration(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>{fmtDuration(visible.reduce((sum, e) => sum + entryMinutes(e), 0))}</strong>
              <span>total</span>
            </div>
          </div>
          <div className="legend">
            {projects.slice(0, 3).map((item) => (
              <span key={item.name}>
                <i style={{ background: item.color }} />
                {item.name}
              </span>
            ))}
          </div>
        </section>
      </div>
      <RecentEntries entries={visible.slice(0, 5)} title="Recent activity" />
    </div>
  );
}

function TrackerPage() {
  const store = useAppStore();
  const {
    data,
    currentUser,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    timerError,
    timerBusy,
    retryTimerAction,
    clearTimerError,
  } = store;
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [entryModal, setEntryModal] = useState<TimeEntry | "new" | null>(null);
  const ownEntries =
    currentUser?.role === "admin"
      ? data.entries
      : data.entries.filter((entry) => entry.userId === currentUser?.id);
  const active = data.activeTimer;
  useEffect(() => {
    if (active) {
      setDescription(active.description);
      setProjectId(active.projectId || "");
      setTaskId(active.taskId || "");
      setTagIds(active.tagIds);
    }
  }, [active?.id]);
  const begin = () =>
    startTimer({
      description,
      projectId: projectId || undefined,
      taskId: taskId || undefined,
      tagIds,
    });
  return (
    <div className="page-stack">
      <section className={cn("timer-panel", active && "timer-panel-active")}>
        <div className="timer-input-row">
          <label className="description-input">
            <span className="live-status">
              {active ? <i className="live-dot" /> : <Clock3 size={18} />}
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!!active}
              placeholder="What are you working on?"
              aria-label="Task description"
            />
          </label>
          <label className="compact-select">
            <FolderKanban size={16} />
            <select
              value={projectId}
              disabled={!!active}
              onChange={(e) => {
                setProjectId(e.target.value);
                setTaskId("");
              }}
              aria-label="Project"
            >
              <option value="">No project</option>
              {data.projects
                .filter((project) => project.status === "active")
                .map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="compact-select">
            <Check size={16} />
            <select
              value={taskId}
              disabled={!!active || !projectId}
              onChange={(e) => setTaskId(e.target.value)}
              aria-label="Task"
            >
              <option value="">No task</option>
              {data.tasks
                .filter((task) => task.projectId === projectId && !task.completed)
                .map((task) => (
                  <option value={task.id} key={task.id}>
                    {task.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="tag-picker">
            <Tags size={16} />
            <select
              value=""
              disabled={!!active}
              onChange={(e) =>
                e.target.value &&
                setTagIds((current) =>
                  current.includes(e.target.value) ? current : [...current, e.target.value],
                )
              }
              aria-label="Add tag"
            >
              <option value="">Tags</option>
              {data.tags
                .filter((tag) => !tagIds.includes(tag.id))
                .map((tag) => (
                  <option value={tag.id} key={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="timer-display">
            <TimerClock />
            <span>{active?.status || "ready"}</span>
          </div>
          {!active ? (
            <Button
              onClick={begin}
              disabled={!description.trim() || timerBusy}
              aria-busy={timerBusy}
            >
              <Play size={16} fill="currentColor" /> Start
            </Button>
          ) : (
            <div className="timer-actions">
              {active.status === "running" ? (
                <Button variant="secondary" onClick={pauseTimer} disabled={timerBusy}>
                  <CirclePause size={17} /> Pause
                </Button>
              ) : (
                <Button onClick={resumeTimer} disabled={timerBusy}>
                  <CirclePlay size={17} /> Resume
                </Button>
              )}
              <Button variant="danger" onClick={stopTimer} disabled={timerBusy}>
                <Square size={15} fill="currentColor" /> Stop
              </Button>
            </div>
          )}
        </div>
        {timerError && (
          <div className="timer-error" role="alert">
            <span>
              <X size={16} />
            </span>
            <p>{timerError}</p>
            <button onClick={retryTimerAction}>Retry</button>
            <button onClick={clearTimerError} aria-label="Dismiss timer error">
              <X size={14} />
            </button>
          </div>
        )}
        {tagIds.length > 0 && (
          <div className="selected-tags">
            {tagIds.map((tagId) => {
              const tag = data.tags.find((candidate) => candidate.id === tagId);
              return (
                tag && (
                  <button
                    disabled={!!active}
                    key={tag.id}
                    onClick={() =>
                      setTagIds((current) => current.filter((value) => value !== tag.id))
                    }
                  >
                    <i style={{ background: tag.color }} />
                    {tag.name}
                    {!active && <X size={12} />}
                  </button>
                )
              );
            })}
          </div>
        )}
        {active && (
          <div className="segment-summary">
            <span>
              <Activity size={15} /> Session started {fmtClock(active.startedAt)}
            </span>
            <span>
              {active.segments.filter((segment) => segment.type === "work").length} work segments
            </span>
            <span>
              {active.segments.filter((segment) => segment.type === "break").length} breaks
            </span>
          </div>
        )}
      </section>
      <div className="section-title-row">
        <div>
          <h2>Your time entries</h2>
          <p>Review, adjust, or add time manually.</p>
        </div>
        <Button variant="secondary" onClick={() => setEntryModal("new")}>
          <Plus size={16} /> Add time
        </Button>
      </div>
      <EntryTable entries={ownEntries} onEdit={(entry) => setEntryModal(entry)} />
      {entryModal && (
        <EntryModal
          entry={entryModal === "new" ? undefined : entryModal}
          initialDate={new Date()}
          onClose={() => setEntryModal(null)}
        />
      )}
    </div>
  );
}

function EntryTable({
  entries,
  onEdit,
}: {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
}) {
  const { data, deleteEntry } = useAppStore();
  const [filters, setFilters] = useState<EntryFilters>({ sort: "newest" });
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState(10);
  const filtered = filterEntries(entries, filters);
  const filteredMinutes = filtered.reduce((sum, entry) => sum + entryMinutes(entry), 0);
  const paged = filtered.slice(page * rows, page * rows + rows);
  const updateFilter = (patch: Partial<EntryFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };
  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            value={filters.search || ""}
            onChange={(e) => updateFilter({ search: e.target.value })}
            placeholder="Search entries"
          />
        </label>
        <span>
          {filtered.length} entries · {fmtDuration(filteredMinutes)}
        </span>
      </div>
      <div className="advanced-filters" aria-label="Time entry filters">
        <label>
          <span>From</span>
          <input
            type="date"
            value={filters.from || ""}
            onChange={(e) => updateFilter({ from: e.target.value })}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={filters.to || ""}
            onChange={(e) => updateFilter({ to: e.target.value })}
          />
        </label>
        <label>
          <span>Project</span>
          <select
            value={filters.projectId || ""}
            onChange={(e) => updateFilter({ projectId: e.target.value, taskId: "" })}
          >
            <option value="">All projects</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Task</span>
          <select
            value={filters.taskId || ""}
            onChange={(e) => updateFilter({ taskId: e.target.value })}
          >
            <option value="">All tasks</option>
            {data.tasks
              .filter((task) => !filters.projectId || task.projectId === filters.projectId)
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>Tag</span>
          <select
            value={filters.tagId || ""}
            onChange={(e) => updateFilter({ tagId: e.target.value })}
          >
            <option value="">All tags</option>
            {data.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Member</span>
          <select
            value={filters.memberId || ""}
            onChange={(e) => updateFilter({ memberId: e.target.value })}
          >
            <option value="">All members</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Source</span>
          <select
            value={filters.source || ""}
            onChange={(e) => updateFilter({ source: e.target.value as EntryFilters["source"] })}
          >
            <option value="">Any source</option>
            <option value="timer">Timer</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select
            value={filters.sort}
            onChange={(e) => updateFilter({ sort: e.target.value as EntryFilters["sort"] })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="longest">Longest first</option>
            <option value="shortest">Shortest first</option>
          </select>
        </label>
        <button className="clear-filters" onClick={() => setFilters({ sort: "newest" })}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {paged.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Project</th>
                <th>Date</th>
                <th>Time</th>
                <th>Break</th>
                <th>Duration</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {paged.map((entry) => {
                const project = data.projects.find((p) => p.id === entry.projectId);
                return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.description}</strong>
                      <small>{entry.source}</small>
                    </td>
                    <td>
                      {project ? (
                        <span className="project-label">
                          <i style={{ background: project.color }} />
                          {project.name}
                        </span>
                      ) : (
                        <span className="muted">No project</span>
                      )}
                    </td>
                    <td>{fmtDate(entry.start)}</td>
                    <td>
                      {fmtClock(entry.start)} – {fmtClock(entry.end)}
                    </td>
                    <td>{fmtDuration(breakMinutes(entry))}</td>
                    <td>
                      <strong>{fmtDuration(entryMinutes(entry))}</strong>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => onEdit(entry)} title="Edit">
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() =>
                            window.confirm("Delete this time entry?") && deleteEntry(entry.id)
                          }
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<Clock3 size={24} />}
          title="No entries found"
          body="Change your search or add a time entry."
        />
      )}
      <div className="pagination">
        <label>
          Rows{" "}
          <select
            value={rows}
            onChange={(e) => {
              setRows(Number(e.target.value));
              setPage(0);
            }}
          >
            <option>10</option>
            <option>20</option>
            <option>30</option>
          </select>
        </label>
        <span>
          {filtered.length ? page * rows + 1 : 0}–{Math.min((page + 1) * rows, filtered.length)} of{" "}
          {filtered.length}
        </span>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          <ChevronLeft size={16} />
        </button>
        <button disabled={(page + 1) * rows >= filtered.length} onClick={() => setPage(page + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

function EntryModal({
  entry,
  initialDate,
  onClose,
}: {
  entry?: TimeEntry;
  initialDate?: Date;
  onClose: () => void;
}) {
  const { data, currentUser, saveEntry } = useAppStore();
  const initial = initialDate || new Date(entry?.start || Date.now());
  const [projectId, setProjectId] = useState(entry?.projectId || "");
  const [tagIds, setTagIds] = useState(entry?.tagIds || []);
  const [overlap, setOverlap] = useState<TimeEntry | null>(null);
  const [pending, setPending] = useState<EntryInput | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const isAdminCorrection =
    Boolean(entry) && currentUser?.role === "admin" && entry?.userId !== currentUser.id;
  const persist = (value: EntryInput) => {
    saveEntry(value, isAdminCorrection ? correctionReason : undefined);
    onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const day = String(form.get("date"));
    let start = new Date(`${day}T${String(form.get("start"))}`);
    let end = new Date(`${day}T${String(form.get("end"))}`);
    if (end <= start) end.setDate(end.getDate() + 1);
    const value: EntryInput = {
      id: entry?.id,
      userId: entry?.userId || currentUser!.id,
      description: String(form.get("description")),
      projectId: projectId || undefined,
      taskId: String(form.get("taskId")) || undefined,
      tagIds,
      start: start.toISOString(),
      end: end.toISOString(),
      notes: String(form.get("notes") || ""),
      source: entry?.source || "manual",
      segments: [
        { id: id("segment"), type: "work", start: start.toISOString(), end: end.toISOString() },
      ],
    };
    const conflict = data.entries.find(
      (candidate) =>
        candidate.id !== entry?.id &&
        candidate.userId === value.userId &&
        new Date(candidate.start) < end &&
        new Date(candidate.end) > start,
    );
    if (conflict) {
      setOverlap(conflict);
      setPending(value);
    } else persist(value);
  };
  const dateValue = dateKey(initial);
  return (
    <Modal
      title={entry ? "Edit time entry" : "Add time entry"}
      subtitle="Times are saved in your current timezone."
      onClose={onClose}
    >
      {overlap && (
        <div className="warning-panel">
          <Clock3 size={18} />
          <div>
            <strong>This overlaps another entry</strong>
            <p>
              {overlap.description}, {fmtClock(overlap.start)}–{fmtClock(overlap.end)}. You can save
              anyway.
            </p>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="modal-form">
        <label className="field field-full">
          <span>Description</span>
          <input
            name="description"
            required
            defaultValue={entry?.description}
            placeholder="What did you work on?"
          />
        </label>
        <label className="field">
          <span>Date</span>
          <input
            name="date"
            type="date"
            required
            defaultValue={entry ? dateKey(entry.start) : dateValue}
          />
        </label>
        <div className="field-pair">
          <label className="field">
            <span>Start</span>
            <input
              name="start"
              type="time"
              required
              defaultValue={entry ? new Date(entry.start).toTimeString().slice(0, 5) : "09:00"}
            />
          </label>
          <label className="field">
            <span>End</span>
            <input
              name="end"
              type="time"
              required
              defaultValue={entry ? new Date(entry.end).toTimeString().slice(0, 5) : "10:00"}
            />
          </label>
        </div>
        <SelectField
          label="Project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">No project</option>
          {data.projects
            .filter((project) => project.status === "active" || project.id === entry?.projectId)
            .map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
        </SelectField>
        <SelectField label="Task" name="taskId" defaultValue={entry?.taskId || ""}>
          <option value="">No task</option>
          {data.tasks
            .filter((task) => task.projectId === projectId)
            .map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
        </SelectField>
        <label className="field field-full">
          <span>Tags</span>
          <div className="check-grid">
            {data.tags.map((tag) => (
              <label key={tag.id} className="check-chip">
                <input
                  type="checkbox"
                  checked={tagIds.includes(tag.id)}
                  onChange={() =>
                    setTagIds((current) =>
                      current.includes(tag.id)
                        ? current.filter((value) => value !== tag.id)
                        : [...current, tag.id],
                    )
                  }
                />
                <i style={{ background: tag.color }} />
                {tag.name}
              </label>
            ))}
          </div>
        </label>
        <label className="field field-full">
          <span>
            Notes <small>optional</small>
          </span>
          <textarea name="notes" defaultValue={entry?.notes} placeholder="Add context or links" />
        </label>
        {isAdminCorrection && (
          <label className="field field-full correction-reason">
            <span>Correction reason</span>
            <textarea
              required
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              placeholder="Explain why this team member’s entry is being changed"
            />
          </label>
        )}
        <footer className="modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {overlap && pending ? (
            <Button type="button" onClick={() => persist(pending)}>
              Save anyway
            </Button>
          ) : (
            <Button type="submit">{entry ? "Save changes" : "Add entry"}</Button>
          )}
        </footer>
      </form>
    </Modal>
  );
}

function ProjectsPage() {
  const { data, saveProject, archiveProject, saveTask } = useAppStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [detail, setDetail] = useState<Project | null>(null);
  const [taskProject, setTaskProject] = useState<Project | null>(null);
  const visible = data.projects.filter(
    (project) =>
      (filter === "all" || project.status === filter) &&
      `${project.name} ${project.client}`.toLowerCase().includes(search.toLowerCase()),
  );
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const current = editing === "new" ? undefined : editing || undefined;
    saveProject({
      id: current?.id || id("project"),
      name: String(form.get("name")),
      client: String(form.get("client")),
      description: String(form.get("description")),
      color: String(form.get("color")),
      status: current?.status || "active",
      createdAt: current?.createdAt,
    });
    setEditing(null);
  };
  return (
    <div className="page-stack">
      <div className="section-title-row">
        <div className="filter-row">
          <label className="search-input">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects"
            />
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All projects</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} /> New project
        </Button>
      </div>
      <div className="project-grid">
        {visible.map((project) => {
          const total = data.entries
            .filter((entry) => entry.projectId === project.id)
            .reduce((sum, entry) => sum + entryMinutes(entry), 0);
          const tasks = data.tasks.filter((task) => task.projectId === project.id);
          return (
            <article className="project-card" key={project.id}>
              <div className="project-card-top">
                <span
                  className="project-icon"
                  style={{ background: `${project.color}18`, color: project.color }}
                >
                  <FolderKanban size={20} />
                </span>
                <span
                  className={cn("status-pill", project.status === "active" ? "success" : "neutral")}
                >
                  {project.status}
                </span>
              </div>
              <button className="project-title" onClick={() => setDetail(project)}>
                <h3>{project.name}</h3>
                <p>{project.client}</p>
              </button>
              <p className="project-description">{project.description}</p>
              <div className="project-metrics">
                <span>
                  <strong>{fmtDuration(total)}</strong> tracked
                </span>
                <span>
                  <strong>{tasks.filter((task) => !task.completed).length}</strong> open tasks
                </span>
              </div>
              <div className="project-footer">
                <div className="member-stack">
                  {Array.from(new Set(tasks.map((task) => task.assigneeId)))
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((userId) => {
                      const user = data.users.find((candidate) => candidate.id === userId);
                      return (
                        user && (
                          <span className="avatar small" key={user.id}>
                            {user.avatar}
                          </span>
                        )
                      );
                    })}
                </div>
                <div className="row-actions">
                  <button onClick={() => setTaskProject(project)} title="Add task">
                    <Plus size={15} />
                  </button>
                  <button onClick={() => setEditing(project)} title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => archiveProject(project.id)}
                    title={project.status === "active" ? "Archive" : "Restore"}
                  >
                    <Archive size={15} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <EmptyState
          icon={<FolderKanban size={25} />}
          title="No matching projects"
          body="Try a different search or create a project."
        />
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "Create project" : "Edit project"}
          onClose={() => setEditing(null)}
        >
          <form className="modal-form" onSubmit={save}>
            <label className="field field-full">
              <span>Project name</span>
              <input name="name" required defaultValue={editing === "new" ? "" : editing.name} />
            </label>
            <label className="field">
              <span>Client</span>
              <input
                name="client"
                required
                defaultValue={editing === "new" ? "" : editing.client}
              />
            </label>
            <label className="field">
              <span>Color</span>
              <input
                name="color"
                type="color"
                defaultValue={editing === "new" ? "#5068e9" : editing.color}
              />
            </label>
            <label className="field field-full">
              <span>Description</span>
              <textarea
                name="description"
                required
                defaultValue={editing === "new" ? "" : editing.description}
              />
            </label>
            <footer className="modal-actions">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save project</Button>
            </footer>
          </form>
        </Modal>
      )}
      {taskProject && (
        <Modal title={`Add task to ${taskProject.name}`} onClose={() => setTaskProject(null)}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              saveTask({
                id: id("task"),
                workspaceId: data.activeWorkspaceId,
                projectId: taskProject.id,
                name: String(form.get("name")),
                assigneeId: String(form.get("assignee")) || undefined,
                completed: false,
              });
              setTaskProject(null);
            }}
          >
            <label className="field field-full">
              <span>Task name</span>
              <input name="name" required autoFocus />
            </label>
            <SelectField label="Assignee" name="assignee">
              <option value="">Unassigned</option>
              {data.users
                .filter((user) => user.status === "active")
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </SelectField>
            <footer className="modal-actions">
              <Button type="button" variant="ghost" onClick={() => setTaskProject(null)}>
                Cancel
              </Button>
              <Button type="submit">Add task</Button>
            </footer>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.name} subtitle={detail.client} onClose={() => setDetail(null)} wide>
          <div className="detail-summary">
            <p>{detail.description}</p>
            <span className="project-label">
              <i style={{ background: detail.color }} />
              {detail.status}
            </span>
          </div>
          <div className="task-list">
            <div className="card-header">
              <h3>Tasks</h3>
              <Button
                variant="secondary"
                onClick={() => {
                  setTaskProject(detail);
                  setDetail(null);
                }}
              >
                <Plus size={15} /> Add task
              </Button>
            </div>
            {data.tasks
              .filter((task) => task.projectId === detail.id)
              .map((task) => (
                <label className="task-row" key={task.id}>
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => saveTask({ ...task, completed: !task.completed })}
                  />
                  <span className={task.completed ? "done" : ""}>{task.name}</span>
                  <small>
                    {data.users.find((user) => user.id === task.assigneeId)?.name || "Unassigned"}
                  </small>
                </label>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function TagsPage() {
  const { data, saveTag, deleteTag } = useAppStore();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const visible = data.tags.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="page-stack">
      <div className="section-title-row">
        <label className="search-input">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags"
          />
        </label>
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} /> New tag
        </Button>
      </div>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Usage</th>
                <th>Color</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <span className="tag-label">
                      <i style={{ background: tag.color }} />
                      {tag.name}
                    </span>
                  </td>
                  <td>
                    {data.entries.filter((entry) => entry.tagIds.includes(tag.id)).length} entries
                  </td>
                  <td>
                    <code>{tag.color}</code>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => setEditing(tag)}>
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => window.confirm(`Delete “${tag.name}”?`) && deleteTag(tag.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <Modal
          title={editing === "new" ? "Create tag" : "Edit tag"}
          onClose={() => setEditing(null)}
        >
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              saveTag({
                id: editing === "new" ? id("tag") : editing.id,
                workspaceId: data.activeWorkspaceId,
                name: String(form.get("name")),
                color: String(form.get("color")),
              });
              setEditing(null);
            }}
          >
            <label className="field field-full">
              <span>Tag name</span>
              <input name="name" required defaultValue={editing === "new" ? "" : editing.name} />
            </label>
            <label className="field">
              <span>Color</span>
              <input
                name="color"
                type="color"
                defaultValue={editing === "new" ? "#5068e9" : editing.color}
              />
            </label>
            <footer className="modal-actions">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save tag</Button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}

function CalendarPage() {
  const { data, currentUser } = useAppStore();
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [cursor, setCursor] = useState(new Date());
  const [entryModal, setEntryModal] = useState<TimeEntry | "new" | null>(null);
  const own = data.entries.filter((entry) => entry.userId === currentUser?.id);
  const move = (step: number) => {
    const next = new Date(cursor);
    next.setDate(next.getDate() + step * (view === "day" ? 1 : view === "week" ? 7 : 30));
    setCursor(next);
  };
  const days =
    view === "day"
      ? [cursor]
      : view === "week"
        ? Array.from({ length: 7 }, (_, i) => {
            const d = startOfWeek(cursor);
            d.setDate(d.getDate() + i);
            return d;
          })
        : Array.from({ length: 42 }, (_, i) => {
            const d = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const offset = (d.getDay() + 6) % 7;
            d.setDate(d.getDate() - offset + i);
            return d;
          });
  return (
    <div className="page-stack">
      <div className="calendar-toolbar">
        <div className="segmented">
          {(["day", "week", "month"] as const).map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div className="date-nav">
          <button onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setCursor(new Date())}>Today</button>
          <button onClick={() => move(1)}>
            <ChevronRight size={18} />
          </button>
          <strong>{cursor.toLocaleDateString([], { month: "long", year: "numeric" })}</strong>
        </div>
        <Button onClick={() => setEntryModal("new")}>
          <Plus size={16} /> Add entry
        </Button>
      </div>
      <section className={cn("calendar-grid", `calendar-${view}`)}>
        {days.map((day) => {
          const entries = own.filter((entry) => dateKey(entry.start) === dateKey(day));
          const outside = view === "month" && day.getMonth() !== cursor.getMonth();
          return (
            <div
              className={cn(
                "calendar-day",
                outside && "outside",
                dateKey(day) === dateKey(new Date()) && "today",
              )}
              key={day.toISOString()}
              onDoubleClick={() => {
                setCursor(day);
                setEntryModal("new");
              }}
            >
              <header>
                <span>
                  {day.toLocaleDateString([], { weekday: view === "month" ? "short" : "long" })}
                </span>
                <strong>{day.getDate()}</strong>
                <small>
                  {fmtDuration(entries.reduce((sum, entry) => sum + entryMinutes(entry), 0))}
                </small>
              </header>
              <div className="calendar-entries">
                {entries.map((entry) => {
                  const project = data.projects.find((p) => p.id === entry.projectId);
                  return (
                    <button
                      key={entry.id}
                      style={{ borderLeftColor: project?.color || "#94a3b8" }}
                      onClick={() => setEntryModal(entry)}
                    >
                      <span>{view !== "month" && fmtClock(entry.start)}</span>
                      <strong>{entry.description}</strong>
                      {view !== "month" && <small>{fmtDuration(entryMinutes(entry))}</small>}
                    </button>
                  );
                })}
              </div>
              {view !== "month" && !entries.length && (
                <button
                  className="calendar-add"
                  onClick={() => {
                    setCursor(day);
                    setEntryModal("new");
                  }}
                >
                  <Plus size={14} /> Add time
                </button>
              )}
            </div>
          );
        })}
      </section>
      {entryModal && (
        <EntryModal
          entry={entryModal === "new" ? undefined : entryModal}
          initialDate={cursor}
          onClose={() => setEntryModal(null)}
        />
      )}
    </div>
  );
}

function TimesheetPage() {
  const { data, currentUser } = useAppStore();
  const [week, setWeek] = useState(startOfWeek());
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const days = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(week);
    d.setDate(d.getDate() + index);
    return d;
  });
  const own = data.entries.filter((entry) => entry.userId === currentUser?.id);
  const total = own
    .filter((entry) => days.some((day) => dateKey(day) === dateKey(entry.start)))
    .reduce((sum, entry) => sum + entryMinutes(entry), 0);
  return (
    <div className="page-stack">
      <div className="timesheet-summary">
        <div className="date-nav">
          <button
            onClick={() => {
              const d = new Date(week);
              d.setDate(d.getDate() - 7);
              setWeek(d);
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setWeek(startOfWeek())}>This week</button>
          <button
            onClick={() => {
              const d = new Date(week);
              d.setDate(d.getDate() + 7);
              setWeek(d);
            }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div>
          <span>Week total</span>
          <strong>{fmtDuration(total)}</strong>
        </div>
      </div>
      <section className="timesheet-grid">
        {days.map((day) => {
          const entries = own.filter((entry) => dateKey(entry.start) === dateKey(day));
          return (
            <article
              className={cn("timesheet-day", dateKey(day) === dateKey(new Date()) && "today")}
              key={day.toISOString()}
            >
              <header>
                <div>
                  <span>{day.toLocaleDateString([], { weekday: "long" })}</span>
                  <strong>{day.toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
                </div>
                <b>{fmtDuration(entries.reduce((sum, entry) => sum + entryMinutes(entry), 0))}</b>
              </header>
              {entries.map((entry) => {
                const project = data.projects.find((p) => p.id === entry.projectId);
                return (
                  <button
                    className="timesheet-entry"
                    key={entry.id}
                    onClick={() => setEditing(entry)}
                  >
                    <i style={{ background: project?.color }} />
                    <span>
                      <strong>{entry.description}</strong>
                      <small>
                        {project?.name || "No project"} · {fmtClock(entry.start)}–
                        {fmtClock(entry.end)}
                      </small>
                    </span>
                    <b>{fmtDuration(entryMinutes(entry))}</b>
                  </button>
                );
              })}
              {!entries.length && <p className="day-empty">No time tracked</p>}
            </article>
          );
        })}
      </section>
      {editing && <EntryModal entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReportsPage() {
  const { data, currentUser } = useAppStore();
  const [type, setType] = useState<"summary" | "detailed" | "weekly">("summary");
  const [project, setProject] = useState("");
  const [member, setMember] = useState(currentUser?.role === "member" ? currentUser.id : "");
  const [tag, setTag] = useState("");
  const [range, setRange] = useState("30");
  const [groupBy, setGroupBy] = useState<"project" | "tag">("project");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const filtered = data.entries.filter(
    (entry) =>
      new Date(entry.start) >= cutoff &&
      (!project || entry.projectId === project) &&
      (!member || entry.userId === member) &&
      (!tag || entry.tagIds.includes(tag)) &&
      (currentUser?.role === "admin" || entry.userId === currentUser?.id),
  );
  const rows = filtered.map((entry) => ({
    Date: fmtDate(entry.start),
    Member: data.users.find((u) => u.id === entry.userId)?.name || "",
    Description: entry.description,
    Project: data.projects.find((p) => p.id === entry.projectId)?.name || "",
    Start: fmtClock(entry.start),
    End: fmtClock(entry.end),
    Break: fmtDuration(breakMinutes(entry)),
    Duration: fmtDuration(entryMinutes(entry)),
  }));
  const exportReport = async (format: "csv" | "xlsx" | "pdf") => {
    if (format === "csv") {
      const content = entriesToCsv(rows);
      downloadBlob(new Blob([content], { type: "text/csv" }), "timeflow-report.csv");
    } else if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(rows);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Time report");
      XLSX.writeFile(book, "timeflow-report.xlsx");
    } else {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF();
      pdf.setFontSize(18);
      pdf.text("TimeFlow Activity Report", 14, 18);
      pdf.setFontSize(10);
      pdf.text(
        `${filtered.length} entries · ${fmtDuration(filtered.reduce((sum, entry) => sum + entryMinutes(entry), 0))}`,
        14,
        26,
      );
      rows
        .slice(0, 34)
        .forEach((row, index) =>
          pdf.text(
            `${row.Date}  ${row.Description.slice(0, 42)}  ${row.Duration}`,
            14,
            36 + index * 7,
          ),
        );
      pdf.save("timeflow-report.pdf");
    }
  };
  const grouped = (groupBy === "project" ? data.projects : data.tags)
    .map((item) => {
      const matches = filtered.filter((entry) =>
        groupBy === "project" ? entry.projectId === item.id : entry.tagIds.includes(item.id),
      );
      return {
        name: item.name,
        hours: +(matches.reduce((sum, entry) => sum + entryMinutes(entry), 0) / 60).toFixed(1),
        color: item.color,
      };
    })
    .filter((item) => item.hours);
  return (
    <div className="page-stack">
      <div className="report-tabs">
        {(["summary", "detailed", "weekly"] as const).map((item) => (
          <button
            className={type === item ? "active" : ""}
            onClick={() => setType(item)}
            key={item}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <section className="card report-filters">
        <SelectField label="Date range" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </SelectField>
        <SelectField label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {data.projects.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        {currentUser?.role === "admin" && (
          <SelectField label="Member" value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">All members</option>
            {data.users
              .filter((user) => user.status === "active")
              .map((user) => (
                <option value={user.id} key={user.id}>
                  {user.name}
                </option>
              ))}
          </SelectField>
        )}
        <SelectField label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {data.tags.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
      </section>
      <div className="report-total">
        <div>
          <span>Filtered tracked time</span>
          <strong>
            {fmtDuration(filtered.reduce((sum, entry) => sum + entryMinutes(entry), 0))}
          </strong>
          <small>{filtered.length} entries</small>
        </div>
        <div className="export-group">
          <Button variant="secondary" onClick={() => exportReport("csv")}>
            <Download size={15} /> CSV
          </Button>
          <Button variant="secondary" onClick={() => exportReport("xlsx")}>
            XLSX
          </Button>
          <Button variant="secondary" onClick={() => exportReport("pdf")}>
            PDF
          </Button>
        </div>
      </div>
      {type === "summary" ? (
        <section className="card chart-card report-chart">
          <div className="card-header">
            <div>
              <h3>Hours by {groupBy}</h3>
              <p>Based on active report filters</p>
            </div>
            <div className="segmented" aria-label="Summary grouping">
              <button
                className={groupBy === "project" ? "active" : ""}
                onClick={() => setGroupBy("project")}
              >
                Projects
              </button>
              <button
                className={groupBy === "tag" ? "active" : ""}
                onClick={() => setGroupBy("tag")}
              >
                Tags
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={grouped} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid stroke="#edf0f5" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={120} />
              <Tooltip formatter={(value) => [`${value}h`, "Tracked"]} />
              <Bar dataKey="hours" radius={[0, 5, 5, 0]}>
                {grouped.map((item) => (
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      ) : type === "detailed" ? (
        <section className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(
                    rows[0] || { Date: "", Member: "", Description: "", Project: "", Duration: "" },
                  ).map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {Object.values(row).map((value, i) => (
                      <td key={i}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <WeeklyReport entries={filtered} />
      )}
    </div>
  );
}

function WeeklyReport({ entries }: { entries: TimeEntry[] }) {
  const week = startOfWeek();
  const data = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(week);
    d.setDate(d.getDate() + index);
    return {
      day: d.toLocaleDateString([], { weekday: "short" }),
      hours: +(
        entries
          .filter((entry) => dateKey(entry.start) === dateKey(d))
          .reduce((sum, entry) => sum + entryMinutes(entry), 0) / 60
      ).toFixed(1),
    };
  });
  return (
    <section className="card chart-card report-chart">
      <div className="card-header">
        <div>
          <h3>Weekly activity</h3>
          <p>Daily tracked totals</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid stroke="#edf0f5" vertical={false} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} />
          <YAxis axisLine={false} tickLine={false} />
          <Tooltip />
          <Bar dataKey="hours" fill="#5068e9" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TeamPage() {
  const { data, currentUser, saveUser, inviteMember, addAudit } = useAppStore();
  const [search, setSearch] = useState("");
  const [invite, setInvite] = useState(false);
  const [detail, setDetail] = useState<User | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<User["role"]>("member");
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const users = data.users.filter((user) =>
    `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteError("");
    setInviteLoading(true);
    try {
      await inviteMember(inviteEmail, inviteRole);
      setInviteNotice(
        `Invitation saved for ${inviteEmail}. Ask them to sign up using this email address.`,
      );
      setInviteEmail("");
      setInvite(false);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Could not save the invitation.");
    } finally {
      setInviteLoading(false);
    }
  };
  const totalFor = (userId: string) =>
    data.entries
      .filter((entry) => entry.userId === userId)
      .reduce((sum, entry) => sum + entryMinutes(entry), 0);
  return (
    <div className="page-stack">
      <div className="section-title-row">
        <label className="search-input">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
          />
        </label>
        <Button onClick={() => setInvite(true)}>
          <UserPlus size={16} /> Invite member
        </Button>
      </div>
      {inviteNotice && <p role="status">{inviteNotice}</p>}
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Tracked</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <button className="person-cell" onClick={() => setDetail(user)}>
                      <span className="avatar">{user.avatar}</span>
                      <span>
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <select
                      value={user.role}
                      disabled={user.id === currentUser?.id}
                      onChange={(e) => {
                        saveUser({ ...user, role: e.target.value as User["role"] });
                        addAudit("Changed member role", user.name, `Role set to ${e.target.value}`);
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td>
                    <span
                      className={cn(
                        "status-pill",
                        user.status === "active"
                          ? "success"
                          : user.status === "invited"
                            ? "warning"
                            : "neutral",
                      )}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td>{fmtDate(user.joinedAt)}</td>
                  <td>
                    <strong>{fmtDuration(totalFor(user.id))}</strong>
                  </td>
                  <td>
                    <button className="icon-button" onClick={() => setDetail(user)}>
                      <MoreHorizontal size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {invite && (
        <Modal
          title="Invite a team member"
          subtitle="They must create their account with the invited email address."
          onClose={() => setInvite(false)}
        >
          <form className="modal-form" onSubmit={submitInvite}>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span>Workspace role</span>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as User["role"])}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {inviteError && <p role="alert">{inviteError}</p>}
            <p>The invite is stored securely. Send the sign-up instructions to the invitee.</p>
            <footer className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setInvite(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviteLoading}>
                {inviteLoading ? "Saving..." : "Save invitation"}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.name} subtitle={detail.email} onClose={() => setDetail(null)}>
          <div className="member-detail">
            <span className="avatar xl">{detail.avatar}</span>
            <div>
              <span className="status-pill success">{detail.status}</span>
              <p>
                {detail.role} · Joined {fmtDate(detail.joinedAt)}
              </p>
            </div>
          </div>
          <div className="detail-stats">
            <div>
              <span>Total tracked</span>
              <strong>{fmtDuration(totalFor(detail.id))}</strong>
            </div>
            <div>
              <span>Time entries</span>
              <strong>{data.entries.filter((entry) => entry.userId === detail.id).length}</strong>
            </div>
          </div>
          {detail.id !== currentUser?.id && (
            <footer className="modal-actions">
              <Button
                variant="danger"
                onClick={() => {
                  saveUser({
                    ...detail,
                    status: detail.status === "inactive" ? "active" : "inactive",
                  });
                  setDetail(null);
                }}
              >
                {detail.status === "inactive" ? "Reactivate member" : "Deactivate member"}
              </Button>
            </footer>
          )}
        </Modal>
      )}
    </div>
  );
}

function AuditPage() {
  const { data } = useAppStore();
  const [search, setSearch] = useState("");
  const events = data.audit.filter((event) =>
    `${event.action} ${event.target} ${event.detail}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page-stack">
      <div className="section-title-row">
        <label className="search-input">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity"
          />
        </label>
        <span className="status-pill neutral">{events.length} events</span>
      </div>
      <section className="audit-list">
        {events.map((event) => {
          const user = data.users.find((candidate) => candidate.id === event.actorId);
          return (
            <article key={event.id}>
              <span className="audit-icon">
                <Activity size={17} />
              </span>
              <div>
                <strong>{event.action}</strong>
                <p>{event.detail}</p>
                {event.reason && (
                  <p className="audit-reason">
                    <b>Reason:</b> {event.reason}
                  </p>
                )}
                {(event.previousValue || event.updatedValue) && (
                  <details className="audit-change">
                    <summary>View recorded changes</summary>
                    <div>
                      <span>Previous</span>
                      <code>{event.previousValue}</code>
                    </div>
                    <div>
                      <span>Updated</span>
                      <code>{event.updatedValue}</code>
                    </div>
                  </details>
                )}
                <span>
                  {user?.name || "Unknown"} · {event.target}
                </span>
              </div>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function SettingsPage() {
  const { data, currentUser, updateProfile } = useAppStore();
  const [saved, setSaved] = useState(false);
  if (!currentUser) return null;
  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        <button className="active">Profile</button>
        <button
          onClick={() =>
            document.getElementById("workspace-settings")?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Workspace
        </button>
      </nav>
      <div className="settings-content">
        <section className="card settings-card">
          <div className="card-header">
            <div>
              <h3>Profile preferences</h3>
              <p>Choose how time and dates appear for you.</p>
            </div>
          </div>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              updateProfile({
                name: String(form.get("name")),
                timezone: String(form.get("timezone")),
                timeFormat: String(form.get("timeFormat")) as User["timeFormat"],
              });
              setSaved(true);
              window.setTimeout(() => setSaved(false), 2500);
            }}
          >
            <label className="field">
              <span>Full name</span>
              <input name="name" defaultValue={currentUser.name} />
            </label>
            <label className="field">
              <span>Email</span>
              <input value={currentUser.email} disabled />
            </label>
            <SelectField label="Timezone" name="timezone" defaultValue={currentUser.timezone}>
              <option>{Intl.DateTimeFormat().resolvedOptions().timeZone}</option>
              <option>America/New_York</option>
              <option>America/Chicago</option>
              <option>Europe/London</option>
              <option>Asia/Singapore</option>
            </SelectField>
            <SelectField
              label="Time format"
              name="timeFormat"
              defaultValue={currentUser.timeFormat}
            >
              <option value="12h">12-hour</option>
              <option value="24h">24-hour</option>
            </SelectField>
            <div className="settings-save">
              <Button type="submit">
                {saved ? (
                  <>
                    <Check size={16} /> Saved
                  </>
                ) : (
                  "Save preferences"
                )}
              </Button>
            </div>
          </form>
        </section>
        <section className="card settings-card" id="workspace-settings">
          <div className="card-header">
            <div>
              <h3>Workspace</h3>
              <p>These preferences are saved to your profile.</p>
            </div>
          </div>
          <div className="settings-form">
            <label className="field">
              <span>Workspace name</span>
              <input
                value={
                  data.workspaces.find((workspace) => workspace.id === data.activeWorkspaceId)
                    ?.name || ""
                }
                readOnly
              />
            </label>
            <label className="field">
              <span>Your access</span>
              <input value={currentUser.role} readOnly />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}

function RecentEntries({ entries, title }: { entries: TimeEntry[]; title: string }) {
  const { data } = useAppStore();
  return (
    <section className="card recent-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>Your latest completed sessions</p>
        </div>
      </div>
      {entries.map((entry) => {
        const project = data.projects.find((p) => p.id === entry.projectId);
        return (
          <div className="recent-row" key={entry.id}>
            <span
              className="recent-icon"
              style={{ color: project?.color, background: `${project?.color || "#94a3b8"}15` }}
            >
              <Clock3 size={17} />
            </span>
            <div>
              <strong>{entry.description}</strong>
              <span>
                {project?.name || "No project"} · {fmtDate(entry.start)}
              </span>
            </div>
            <b>{fmtDuration(entryMinutes(entry))}</b>
          </div>
        );
      })}
    </section>
  );
}

function Root() {
  const { currentUser } = useAppStore();
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = (next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (currentUser) return <AppShell />;
  if (path === "/") return <PublicLanding navigate={navigate} />;
  const mode: AuthMode =
    path === "/register"
      ? "register"
      : path === "/forgot"
        ? "forgot"
        : path === "/reset"
          ? "reset"
          : path === "/verify"
            ? "verify"
            : "login";
  return <AuthScreen initialMode={mode} navigate={navigate} />;
}

export default function App({
  initialData,
  initialSessionId,
}: {
  initialData?: AppData;
  initialSessionId?: string;
} = {}) {
  return (
    <AppStoreProvider initialData={initialData} initialSessionId={initialSessionId}>
      <Root />
    </AppStoreProvider>
  );
}
