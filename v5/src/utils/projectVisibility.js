// projectVisibility.js — WHO CAN SEE WHICH PROJECTS.
//
// The rule (agreed with the client, Sept 2026):
//
//   * Admin ............ every project, no filtering at all.
//   * Anyone ........... projects they're allocated to (a ProjectResource row
//                        for them), plus projects where they are named as
//                        Project Manager or Delivery Head.
//   * Manager .......... all of the above, PLUS the same three things for each
//                        of their DIRECT reports (Users.ReportingManagerId).
//                        "Manager" = holds a role whose NAME matches /manager/i
//                        — "Project Manager", "Finance Manager", "Delivery
//                        Manager" all qualify. Role names are admin-editable
//                        master data, so this matches by name the same way
//                        userDirectory.getFinanceEmails already does.
//
// Reporting depth is ONE level on purpose: a manager sees their direct
// reports' projects, not their reports' reports'. If that ever needs to become
// the full sub-tree, collectReportIds is the only function that changes.
//
// Resources follow their project: if you can see the project, you can see
// everyone allocated to it. That's what lets a manager see "the employees who
// come under their project", and it stops an employee seeing a project with a
// mysteriously empty team.
//
// IMPORTANT — this is a UI filter, exactly like the rest of this app's
// permission model (see components/common/AccessGuard.jsx). The Power Automate
// flows still return every row to anyone who can call them, so this hides
// data, it does not secure it. Real enforcement has to happen server-side, in
// the flow's SQL (a WHERE on the caller's user id) or in an authenticating
// proxy in front of the flows.

const MANAGER_ROLE_RE = /manager/i;

const s = (v) => (v === undefined || v === null ? "" : String(v));

/** Does this role row count as a "manager" role? Matches on name, falls back to code. */
export const isManagerRole = (role) => MANAGER_ROLE_RE.test(role?.name || role?.code || "");

/**
 * True when `userId` holds at least one active manager role.
 * @param {Array} roles      Roles master rows ({ guid|id, name, code, active })
 * @param {Array} userRoles  UserRoles junction rows ({ userId, roleId, active })
 */
export function hasManagerRole(roles, userRoles, userId) {
  if (!userId) return false;
  const managerRoleIds = new Set(
    (roles || []).filter((r) => r.active !== false && isManagerRole(r)).map((r) => s(r.guid ?? r.id))
  );
  if (managerRoleIds.size === 0) return false;
  return (userRoles || []).some(
    (ur) => ur.active !== false && s(ur.userId) === s(userId) && managerRoleIds.has(s(ur.roleId))
  );
}

/** Ids of the users who report DIRECTLY to `userId`. */
export function collectReportIds(users, userId) {
  if (!userId) return new Set();
  return new Set(
    (users || []).filter((u) => s(u.reportingManagerId) === s(userId)).map((u) => s(u.guid ?? u.id))
  );
}

/**
 * The set of project ids `userId` may see.
 *
 * @returns {Set<string>|null} null means "no restriction" (admin) — callers
 *          must treat null as SHOW EVERYTHING, never as "show nothing". An
 *          empty Set is a real answer: this user sees no projects.
 */
export function computeVisibleProjectIds({ projects, resources, users, roles, userRoles, userId, isAdmin }) {
  if (isAdmin) return null;

  const me = s(userId);
  if (!me) return new Set(); // not signed in / unknown user — fail closed

  // Whose projects count as "mine": me, plus my direct reports if I'm a manager.
  const owners = new Set([me]);
  if (hasManagerRole(roles, userRoles, me)) {
    collectReportIds(users, me).forEach((id) => owners.add(id));
  }

  const visible = new Set();

  // 1. Projects an owner is named on (PM or Delivery Head).
  (projects || []).forEach((p) => {
    if (owners.has(s(p.projectManagerUserId)) || owners.has(s(p.deliveryHeadUserId))) {
      visible.add(s(p.guid ?? p.id));
    }
  });

  // 2. Projects an owner is allocated to. `resources` is the flat
  //    ProjectResource list; a project may also carry its own nested
  //    `resources` array (useProjectsWithResources merges them client-side),
  //    so both shapes are honoured.
  (resources || []).forEach((r) => {
    if (owners.has(s(r.userId))) visible.add(s(r.projectId));
  });
  (projects || []).forEach((p) => {
    if ((p.resources || []).some((r) => owners.has(s(r.userId)))) visible.add(s(p.guid ?? p.id));
  });

  visible.delete(""); // never let a row with a blank id widen the set
  return visible;
}

/** Convenience: filter any list of rows that carry a project id. */
export function filterByProjectId(rows, visibleIds, getId = (r) => r.projectId) {
  if (visibleIds === null) return rows || [];
  return (rows || []).filter((r) => visibleIds.has(s(getId(r))));
}
