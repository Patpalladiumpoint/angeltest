import type { Actor } from "@/db/client";

export type NavKey =
  | "pipeline"
  | "dct"
  | "tasks"
  | "interviews"
  | "candidates"
  | "clients"
  | "merge-queue"
  | "finance"
  | "scorecards"
  | "data-quality"
  | "cadence"
  | "playbooks";

// Sidebar + topbar shell for the internal Palladium OS app (not the client
// portal, which is deliberately lighter -- see src/app/portal/layout.tsx).
// Server component: takes the already-resolved actor and current user's
// display fields so pages don't each re-derive nav state.
export function AppShell({
  actor,
  userName,
  activeNav,
  pageTitle,
  actions,
  mergeQueueCount,
  overdueTaskCount,
  children,
}: {
  actor: Actor;
  userName: string;
  activeNav: NavKey;
  pageTitle: string;
  actions?: React.ReactNode;
  mergeQueueCount?: number;
  overdueTaskCount?: number;
  children: React.ReactNode;
}) {
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="os-shell">
      <aside className="os-sidebar">
        <div className="os-brand">
          Palladium OS
          <small>PALLADIUM POINT</small>
        </div>
        <nav className="os-nav">
          <div className="section-label">Operate</div>
          <NavLink href="/dashboard" active={activeNav === "pipeline"} icon={<IconGrid />} label="Pipeline" />
          <NavLink href="/dct" active={activeNav === "dct"} icon={<IconTower />} label="Deal Control Tower" />
          <NavLink href="/tasks" active={activeNav === "tasks"} icon={<IconCheck />} label="Tasks">
            {typeof overdueTaskCount === "number" && overdueTaskCount > 0 && <Badge tone="rust">{overdueTaskCount}</Badge>}
          </NavLink>
          <NavLink href="/interviews" active={activeNav === "interviews"} icon={<IconCalendar />} label="Interviews" />

          <div className="section-label">Records</div>
          <NavLink href="/candidates" active={activeNav === "candidates"} icon={<IconPerson />} label="Candidates" />
          <NavLink href="/clients" active={activeNav === "clients"} icon={<IconBuilding />} label="Clients" />
          <NavLink href="/merge-queue" active={activeNav === "merge-queue"} icon={<IconMerge />} label="Merge Queue">
            {typeof mergeQueueCount === "number" && mergeQueueCount > 0 && <Badge tone="amber">{mergeQueueCount}</Badge>}
          </NavLink>

          {/* Visible to every internal role -- recruiters see their own commission slice, ops/exec/admin see everything; scoping happens server-side in src/finance/queries.ts, not by hiding this link. */}
          <div className="section-label">Finance</div>
          <NavLink href="/finance" active={activeNav === "finance"} icon={<IconDollar />} label="Finance" />

          <div className="section-label">Insights</div>
          <NavLink href="/scorecards" active={activeNav === "scorecards"} icon={<IconChart />} label="Scorecards" />
          <NavLink href="/data-quality" active={activeNav === "data-quality"} icon={<IconQuality />} label="Data Quality" />
          <NavLink href="/cadence" active={activeNav === "cadence"} icon={<IconClock />} label="Cadence" />

          <div className="section-label">Knowledge</div>
          <NavLink href="/playbooks" active={activeNav === "playbooks"} icon={<IconBook />} label="Playbooks" />
        </nav>
        <div className="os-user">
          <div className="avatar">{initials}</div>
          <div className="who">
            <span className="name">{userName}</span>
            <span className="role">{actor.role}</span>
          </div>
        </div>
      </aside>

      <div className="os-main">
        <div className="os-topbar">
          <h1>{pageTitle}</h1>
          <div className="os-topbar-actions">{actions}</div>
        </div>
        <div className="os-body">{children}</div>
      </div>
    </div>
  );
}

function NavLink({
  href,
  active,
  icon,
  label,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <a href={href} className={active ? "active" : ""}>
      {icon}
      {label}
      {children}
    </a>
  );
}

function Badge({ tone, children }: { tone: "rust" | "amber"; children: React.ReactNode }) {
  return (
    <span className={`pill pill-${tone}`} style={{ marginLeft: "auto", padding: "2px 7px" }}>
      {children}
    </span>
  );
}

// Deliberately minimal geometric icon set -- one visual language across
// every nav item, not a mix of borrowed icon-library styles.
function IconGrid() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8.5h14" />
    </svg>
  );
}
function IconTower() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 2v4M6 6h8l1 11H5z" />
      <path d="M8 10h4" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
      <path d="M6.5 10l2.3 2.3L13.5 7.5" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2v4M13 2v4" />
    </svg>
  );
}
function IconPerson() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c1-3.5 4-5 6-5s5 1.5 6 5" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="3" width="9" height="14" rx="1" />
      <path d="M7 6h3M7 9h3M7 12h3" />
      <path d="M13 8h3v9h-3" />
    </svg>
  );
}
function IconMerge() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="7" r="3" />
      <circle cx="13" cy="13" r="3" />
      <path d="M9 9l2 2" />
    </svg>
  );
}
function IconDollar() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 2v16M13.5 5.5c0-1.5-1.5-2-3.5-2s-3.5 1-3.5 2.5c0 3.5 7 1.5 7 5s-1.5 2.5-3.5 2.5-3.5-.5-3.5-2" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 17V9M10 17V4M16 17v-6" />
    </svg>
  );
}
function IconQuality() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 3l7 4v6l-7 4-7-4V7z" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 4h5a2 2 0 012 2v10a2 2 0 00-2-2H4z" />
      <path d="M16 4h-5a2 2 0 00-2 2v10a2 2 0 012-2h5z" />
    </svg>
  );
}
