import { Link, useRouterState } from "@tanstack/react-router";
import { ClipboardCheck, Database, Inbox, LayoutDashboard, Menu, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { draftSummary, hydrateDraft, useDraft } from "@/lib/minagri/draft";
import { SOURCE_LABEL } from "@/lib/minagri/pipeline";
import { issueCounts } from "@/lib/minagri/scoring";
import { useAnalysis } from "@/lib/minagri/store";
import { cn } from "@/lib/utils";

type NavItem = {
  to: "/" | "/upload" | "/validate" | "/dataset" | "/review";
  label: string;
  icon: typeof LayoutDashboard;
  reviewHome?: boolean;
  draftHome?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/review", label: "Review", icon: Inbox, reviewHome: true },
  { to: "/upload", label: "Upload", icon: Upload },
  { to: "/validate", label: "Validate", icon: ClipboardCheck, draftHome: true },
  { to: "/dataset", label: "Clean data", icon: Database },
];

function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg bg-black", className)}>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: "1370 / 553" }}>
        <img
          src="/logo.png"
          alt="MINAGRI Data Platform — From raw data to trusted agricultural insights"
          className="absolute max-w-none"
          style={{ width: "112.1%", height: "185.2%", left: "-5.9%", top: "-41.6%" }}
        />
      </div>
    </div>
  );
}

export function AppShell({
  kicker,
  title,
  subtitle,
  actions,
  children,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { result, score } = useAnalysis();
  const openIssues = issueCounts(result.issues).open;
  const draft = useDraft();
  const draftAttention = useMemo(() => {
    if (!draft) return 0;
    const s = draftSummary(draft);
    return s.errors + s.warnings;
  }, [draft]);
  const location = useRouterState({ select: (s) => s.location });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => hydrateDraft(), []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.href]);

  const active = (item: NavItem) => location.pathname === item.to;

  const nav = (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
      {NAV.map((item) => {
        const on = active(item);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            to={item.to}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              on && "bg-white/15 text-white shadow-[inset_3px_0_0_0_#8CC63F]",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {item.reviewHome && openIssues > 0 && (
              <span className="rounded-full bg-accent-green px-2 py-0.5 text-[11px] font-semibold text-primary">
                {openIssues}
              </span>
            )}
            {item.draftHome && draft && (
              <span className="rounded-full bg-info px-2 py-0.5 text-[11px] font-semibold text-white">
                {draftAttention > 0 ? draftAttention : "Ready"}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="hidden w-[248px] shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex lg:min-h-screen">
        <div className="px-4 pb-4 pt-5">
          <BrandLogo />
        </div>
        {nav}
        <div className="border-t border-white/10 p-4 text-xs text-white/70">
          <div className="font-medium text-white">Active dataset</div>
          <div className="mt-1 line-clamp-2">{result.datasetName}</div>
          <div className="mt-2">
            Quality <span className="font-semibold text-white">{score.total}</span>
            <span className="text-white/50">/100</span>
          </div>
          <div className="mt-2 text-accent-green">{SOURCE_LABEL[result.source]}</div>
        </div>
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 text-white lg:hidden">
        <BrandLogo className="w-36" />
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-white/10"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </div>
      {menuOpen && (
        <div id="mobile-nav" className="border-b border-sidebar-border bg-sidebar pb-4 lg:hidden">
          {nav}
        </div>
      )}

      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="page-rise mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              {kicker && <p className="text-eyebrow">{kicker}</p>}
              <h1 className="text-page-title mt-1">{title}</h1>
              {subtitle && (
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
                  {subtitle}
                </p>
              )}
            </div>
            {actions}
          </div>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  const className =
    "rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40";
  const body = (
    <>
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

export function Panel({
  title,
  children,
  className = "",
  action,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card p-5 shadow-sm md:p-6", className)}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const SEV: Record<string, string> = {
  critical: "bg-red-50 text-red-700 ring-1 ring-red-200",
  high: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  medium: "bg-secondary text-foreground ring-1 ring-border",
  low: "bg-muted text-muted-foreground ring-1 ring-border",
};

export function SeverityBadge({ s }: { s: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEV[s] ?? SEV.low}`}
    >
      {s}
    </span>
  );
}

export const rwf = (n: number | null) =>
  n == null ? "No data" : `${Math.round(n).toLocaleString()} RWF`;
