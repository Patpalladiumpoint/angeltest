import type { Actor } from "@/db/client";

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
  children,
}: {
  actor: Actor;
  userName: string;
  activeNav: "pipeline" | "merge-queue" | "data-quality";
  pageTitle: string;
  actions?: React.ReactNode;
  mergeQueueCount?: number;
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
          <a href="/dashboard" className={activeNav === "pipeline" ? "active" : ""}>
            <NavIconPipeline />
            Pipeline
          </a>
          <a href="/merge-queue" className={activeNav === "merge-queue" ? "active" : ""}>
            <NavIconMerge />
            Merge Queue
            {typeof mergeQueueCount === "number" && mergeQueueCount > 0 && (
              <span className="pill pill-amber" style={{ marginLeft: "auto", padding: "2px 7px" }}>
                {mergeQueueCount}
              </span>
            )}
          </a>
          <a href="/data-quality" className={activeNav === "data-quality" ? "active" : ""}>
            <NavIconQuality />
            Data Quality
          </a>
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

function NavIconPipeline() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8.5h14" />
    </svg>
  );
}
function NavIconMerge() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="7" r="3" />
      <circle cx="13" cy="13" r="3" />
      <path d="M9 9l2 2" />
    </svg>
  );
}
function NavIconQuality() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 3l7 4v6l-7 4-7-4V7z" />
    </svg>
  );
}
