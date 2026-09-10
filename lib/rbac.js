/* =========================================================
   lib/rbac.js — what each role may do

   The single source of truth for permissions. Every admin API route
   asks this module; the browser is never consulted. A request from
   ashba claiming role=SUPER_ADMIN is simply ignored, because the role
   is read from the database session, not from the request.

   Two roles only, per the brief. The shape below allows more later
   without touching call sites.
   ========================================================= */

const PERMISSIONS = {
  SUPER_ADMIN: [
    "dashboard:view",
    "orders:view", "orders:update", "orders:note", "orders:tracking", "orders:delete",
    "products:view", "products:create", "products:update", "products:delete", "products:import",
    "categories:manage", "collections:manage",
    "inventory:view", "inventory:update",
    "customers:view",
    "analytics:view",
    "homepage:manage", "hero:manage",
    "users:view", "users:manage",
    "settings:manage",
    "audit:view",
  ],

  /* Operational partner: runs orders day to day, reads the catalogue,
     and cannot touch credentials, roles, settings or other admins. */
  ADMIN: [
    "dashboard:view",
    "orders:view", "orders:update", "orders:note", "orders:tracking",
    "products:view",
    "inventory:view",
    "customers:view",
    "analytics:view",
  ],
};

/* Permissions nobody but a SUPER_ADMIN may ever hold, listed explicitly
   so a careless edit above cannot quietly widen the ADMIN role. */
const SUPER_ADMIN_ONLY = [
  "users:view", "users:manage", "settings:manage", "audit:view",
  "products:create", "products:update", "products:delete", "products:import",
  "categories:manage", "collections:manage", "inventory:update",
  "homepage:manage", "hero:manage", "orders:delete",
];

(function assertNoLeakage() {
  const leaked = (PERMISSIONS.ADMIN || []).filter((p) => SUPER_ADMIN_ONLY.includes(p));
  if (leaked.length) {
    throw new Error(`rbac: ADMIN must not hold super-admin permissions: ${leaked.join(", ")}`);
  }
})();

const ROLES = Object.keys(PERMISSIONS);

function can(role, permission) {
  const list = PERMISSIONS[role];
  if (!list) return false;                       // unknown role gets nothing
  if (SUPER_ADMIN_ONLY.includes(permission) && role !== "SUPER_ADMIN") return false;
  return list.includes(permission);
}

const permissionsFor = (role) => (PERMISSIONS[role] || []).slice();

/* Navigation the UI should render. The server still checks every call —
   hiding a link is presentation, not security. */
function navFor(role) {
  const nav = [
    { label: "Dashboard", href: "/admin", perm: "dashboard:view" },
    { label: "Orders", href: "/admin/orders", perm: "orders:view" },
    { label: "Products", href: "/admin/products", perm: "products:view" },
    { label: "Inventory", href: "/admin/inventory", perm: "inventory:view" },
    { label: "Customers", href: "/admin/customers", perm: "customers:view" },
    { label: "Analytics", href: "/admin/analytics", perm: "analytics:view" },
    { label: "Homepage", href: "/admin/homepage", perm: "homepage:manage" },
    { label: "Admin Account", href: "/admin/users", perm: "users:view" },
    { label: "Audit Log", href: "/admin/audit", perm: "audit:view" },
    { label: "Settings", href: "/admin/settings", perm: "settings:manage" },
  ];
  return nav.filter((i) => can(role, i.perm));
}

/* Guard for API handlers. Throws a tagged error the router turns into
   401 or 403 — and records the denial for the audit trail. */
class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function requirePermission(session, permission) {
  if (!session || !session.user) throw new AuthError(401, "Not signed in");
  if (!can(session.user.role, permission)) {
    throw new AuthError(403, "You do not have permission to do that");
  }
  return session.user;
}

/* A user may never act on their own account through the user-management
   API — that is how self-promotion and self-password-reset are blocked. */
function requireNotSelf(session, targetUserId) {
  if (session && session.user && String(session.user.id) === String(targetUserId)) {
    throw new AuthError(403, "You cannot perform this action on your own account");
  }
}

module.exports = {
  PERMISSIONS, SUPER_ADMIN_ONLY, ROLES,
  can, permissionsFor, navFor,
  requirePermission, requireNotSelf, AuthError,
};
