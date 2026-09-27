import { callAuditLogFlow } from "../api/flows";
import { LS_CURRENT_USER } from "../constants/storage-keys";
import { lsGet } from "./storage";
import { AUDIT_RECIPIENTS, DEFAULT_NOTIFICATION_TO, resolveEvent, audienceMetaFor } from "../constants/Notifications";
import { sendAuditMail, sendFsdMail } from "./mail";
import { resolveRecipients } from "./recipientResolver";

/* ============================================================
    Every Create/Update/Delete/Approve/Reject across the app calls
    logAudit(screen, action, record, meta, ctx) — same signature as
    before, PLUS a new optional 5th arg `ctx`:

      ctx = {
        projectId, project,              // Project screens
        userId, employeeUserId,          // Resource Allocation / Timesheet
        submittedByUserId, approvedByUserId, requestedByUserId,
      }

    ctx carries whatever real IDs the calling screen already has on
    hand, so recipientResolver.js can look up REAL emails from the
    DB (Users/Roles/UserRoles) instead of the old hardcoded mailboxes.
    Callers that don't pass ctx still work (ctx defaults to {}) —
    those events just won't resolve a "pm"/"deliveryHead"/"resource"
    bucket (finance/management, being role-based, don't need ctx).

    TWO fire-and-forget mails, both through the SAME /auditflow flow
    (see utils/mail.js), each with its own recipients + HTML:
      1) sendAuditMail  -> Audit team, unchanged content/recipients.
      2) sendFsdMail    -> real business-event recipients, only when
         this screen/action is FSD-mapped in constants/Notifications.js.
    Both are now also written to NotificationLog (success/failure) —
    see mail.js. A failure in either never blocks the screen, the
    other mail, or the audit-log SQL write.

    Business-event mail (2) is UNCONDITIONAL per FSD 4.5 ("The system
    shall use Power Automate to send event-based notifications to
    relevant stakeholders") — it is a system obligation, not a
    per-user privilege, so it is never gated behind the acting user's
    own module permissions. There used to be an optional permission
    check here (canSendFsdMail/REQUIRE_MAIL_PERMISSION) — removed
    entirely so a PM without "Mail Notification" access can never
    silently block Finance/Management/PM/Delivery Head from being
    notified again.
    ============================================================ */

/* "<Screen>|<Action>" events that must NEVER go unsent. If recipient
   resolution comes back completely empty for one of these, the mail goes to
   DEFAULT_NOTIFICATION_TO instead of being logged as "Skipped" and dropped.

   Project Create/Update/Delete: the standing CR ("mail Finance whenever
     project details are created/edited/deleted").
   Project Approval|Reject: the PM must always learn that Finance rejected
     their project, even on a project that has no PM assigned yet — in that
     case someone still has to pick it up and chase it, which is exactly
     what the default mailbox is for. */
const FALLBACK_EVENTS = new Set([
  "Project|Create",
  "Project|Update",
  "Project|Delete",
  "Project Approval|Reject",
]);

export function logAudit(screen, action, record, meta, ctx) {
  const session = lsGet(LS_CURRENT_USER, null);
  const currentUsername = typeof session === "string" ? session : session?.username || "Administrator";

  const entry = {
    screen,
    action,
    record: record || "—",
    user: currentUsername,
    timestamp: new Date().toISOString(),
  };

  callAuditLogFlow("CREATE", entry).catch((e) => console.warn("Audit log SQL write failed:", e.message));

  sendAuditMail(entry, AUDIT_RECIPIENTS); // (1) Audit team — unchanged

  const ev = resolveEvent(screen, action, meta || {});
  if (ev) {
    const safeCtx = ctx || {};
    const audience = audienceMetaFor(ev.to);

    // Default-mailbox safety net — see FALLBACK_EVENTS above. Used ONLY as a
    // last resort when recipient resolution comes back completely empty (e.g.
    // no PM/Delivery Head assigned yet, or nobody currently holds the Finance
    // role). An event with real, resolvable recipients never touches this —
    // see the "used to be an optional check" note above for why this never
    // gates on permissions either.
    const fallbackTo = FALLBACK_EVENTS.has(`${screen}|${action}`) ? DEFAULT_NOTIFICATION_TO : undefined;

    resolveRecipients(ev, safeCtx)
      .then(({ to, cc }) => {
        sendFsdMail({
          ...entry,
          event: ev.event,
          recipientLabel: audience.label,
          accent: audience.theme,
          to,
          cc,
          meta: meta || {},
          fallbackTo,
        }); // (2) real, DB-resolved recipients (falls back to the default mailbox above only if none resolved)
      })
      .catch((e) => console.warn("Recipient resolution failed, business-event mail not sent:", e.message));
  }
}