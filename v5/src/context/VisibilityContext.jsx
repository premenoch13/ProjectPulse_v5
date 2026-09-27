// VisibilityContext — resolves WHICH PROJECTS the signed-in user may see
// (rules in utils/projectVisibility.js) once, centrally, and hands every
// screen the same answer.
//
// Mounted inside PermissionProvider (see AppShell) because it needs that
// context's userId / isAdmin. Its data — projects, resources, users, roles,
// user-roles — all comes through the cached LIST wrappers in api/flows.js,
// which warmFlowCache has usually already populated by the time a screen
// mounts, so this costs nothing on a normal navigation.
//
// FAIL CLOSED: until the answer is known, filterProjects returns nothing
// rather than everything. A screen that renders for a moment before this
// resolves shows an empty list, never another team's projects. Screens with
// their own loading flag should OR in `ready` so the user sees a spinner
// instead of a flash of empty.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { callProjectFlow, callProjectResourceFlow } from "../api/flows";
import { loadDirectory } from "../utils/userDirectory";
import { computeVisibleProjectIds, hasManagerRole } from "../utils/projectVisibility";
import { usePermissions } from "./PermissionContext";

const str = (v) => (v === undefined || v === null ? "" : String(v));

const EMPTY = {
  ready: false,
  error: "",
  canSeeAll: false,
  isManager: false,
  visibleProjectIds: new Set(),
  isProjectVisible: () => false,
  filterProjects: () => [],
  filterByProject: () => [],
  refresh: () => Promise.resolve(),
};

const VisibilityContext = createContext(EMPTY);

export function VisibilityProvider({ children }) {
  const { userId, isAdmin, loaded: permsLoaded } = usePermissions();
  // undefined = not resolved yet; null = admin / no restriction; Set = the answer
  const [visibleProjectIds, setVisibleProjectIds] = useState(undefined);
  // Exposed so screens can label the user's scope ("Showing your projects and
  // your project team") from the SAME definition that filters the data —
  // rather than each screen inventing its own idea of who a manager is.
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);

  const refresh = useCallback(() => {
    if (!permsLoaded) return Promise.resolve();

    // Admin short-circuit — no need to fetch anything to decide "everything".
    if (isAdmin) {
      reqId.current += 1;
      setVisibleProjectIds(null);
      setIsManager(false); // irrelevant for an admin — they see everything anyway
      setError("");
      return Promise.resolve();
    }

    const id = ++reqId.current; // ignore out-of-order responses
    return Promise.all([callProjectFlow("LIST"), callProjectResourceFlow("LIST"), loadDirectory()])
      .then(([projRes, resRes, dir]) => {
        if (id !== reqId.current) return;
        setIsManager(hasManagerRole(dir.roles || [], dir.userRoles || [], userId));
        setVisibleProjectIds(
          computeVisibleProjectIds({
            projects: projRes.data || [],
            resources: resRes.data || [],
            users: dir.users || [],
            roles: dir.roles || [],
            userRoles: dir.userRoles || [],
            userId,
            isAdmin: false,
          })
        );
        setError("");
      })
      .catch((e) => {
        if (id !== reqId.current) return;
        // Fail closed: an error must not turn into "show everything".
        setVisibleProjectIds(new Set());
        setError(e.message || "Couldn't work out which projects you can see.");
      });
  }, [userId, isAdmin, permsLoaded]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => {
    const resolved = visibleProjectIds !== undefined;
    const ids = resolved ? visibleProjectIds : new Set();
    const canSeeAll = ids === null;

    const isProjectVisible = (projectId) => canSeeAll || (resolved && ids.has(str(projectId)));

    // Rows that ARE projects (id read off the row itself).
    const filterProjects = (rows, getId = (p) => p.guid ?? p.id) => {
      if (canSeeAll) return rows || [];
      if (!resolved) return [];
      return (rows || []).filter((p) => ids.has(str(getId(p))));
    };

    // Rows that POINT AT a project (resources, billing, invoices, approvals).
    const filterByProject = (rows, getId = (r) => r.projectId) => {
      if (canSeeAll) return rows || [];
      if (!resolved) return [];
      return (rows || []).filter((r) => ids.has(str(getId(r))));
    };

    return {
      ready: resolved,
      error,
      canSeeAll,
      isManager,
      visibleProjectIds: ids,
      isProjectVisible,
      filterProjects,
      filterByProject,
      refresh,
    };
  }, [visibleProjectIds, isManager, error, refresh]);

  return <VisibilityContext.Provider value={value}>{children}</VisibilityContext.Provider>;
}

export function useVisibility() {
  return useContext(VisibilityContext);
}
