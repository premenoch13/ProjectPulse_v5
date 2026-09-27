// mail.js — builds the two HTML mails (Audit team / business-event) and
// sends them through the SAME /auditflow flow via callAuditEmailFlow.
//
// CHANGED: every send now (a) uses REAL resolved recipients (built by
// recipientResolver.js, no more hardcoded mailboxes) and (b) writes a
// NotificationLog row for every attempt — success or failure — per FSD 4.5
// ("Notification logs shall capture email type, recipient email, CC email,
// subject line, related project, sent date, delivery status, and error
// message if delivery fails") and the "log every send" decision.
//
// FLOW EDIT REQUIRED (one-time, on the existing /auditflow flow — unchanged
// from before, still just relays {to, cc, subject, body}):
//   1. Trigger schema -> { "to": "string", "cc": "string", "subject": "string", "body": "string" }
//   2. Send an email (V2) -> To/Cc/Subject/Body = triggerBody()?['to' | 'cc' | 'subject' | 'body']
//
// SEPARATE, NEW flow-side change needed for logging (see flows.js's
// callNotificationLogFlow comment) — flow2 needs a "NotificationLog" Switch
// branch that inserts into dbo.NotificationLog, the same way it already has
// one for "AuditLog".
import { callAuditEmailFlow, callNotificationLogFlow } from "../api/flows";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function row(label, value) {
  return `<tr>
      <td style="padding: 12px 14px; background-color: #f5f7fa; border-bottom: 1px solid #d9dee7; font-weight: bold; color: #374151;">${esc(label)}</td>
      <td style="padding: 12px 14px; border-bottom: 1px solid #d9dee7; color: #111827; word-break: break-word;">${esc(value)}</td>
    </tr>`;
}

// Shared shell — only the header color/title/footer line change per audience.
function shell({ accent, title, rows, footer }) {
  return `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333; background-color: #ffffff;">
  <h2 style="margin: 0 0 4px 0; font-size: 20px; color: ${accent};">${esc(title)}</h2>
  <div style="height:3px;width:56px;background:${accent};border-radius:2px;margin-bottom:18px;"></div>
  <table cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; border: 1px solid #d9dee7; font-size: 14px;">
    <tbody>${rows}</tbody>
  </table>
  <p style="margin: 20px 0 0 0; font-size: 13px; color: #6b7280;">${esc(footer)}</p>
  <p style="margin: 8px 0 0 0; font-size: 13px; color: #6b7280;">Regards,<br><strong>Project Pulse Bot</strong></p>
</div>`;
}

// 1) AUDIT TEAM mail — same content/layout as the original flow template
// (Operation/Entity/Record Details/Performed By/Date & Time), neutral grey.
function auditTemplate({ screen, action, record, user, when }) {
  const rows = [row("Operation", action), row("Entity", screen), row("Record Details", record), row("Performed By", user), row("Date & Time", when)].join("");
  return shell({ accent: "#374151", title: "Audit Log Details", rows, footer: "This is an automated audit notification." });
}

/* ============================================================
  2) BUSINESS-EVENT mail — the one a real person (PM, Delivery Head,
  Finance, a resource) actually receives and has to act on.

  This is deliberately NOT the audit layout. "Screen", "Action" and
  "Record" are internal audit concepts and are gone from this mail:
  a Project Manager reading "Screen: Project Approval / Action:
  Reject" learns nothing. What they need is, in order:
      1. what happened, in a sentence, naming their project
      2. WHY — the approver's comment, as a callout, not a table row
      3. the project's particulars, for context
      4. what they're expected to do next
  ============================================================ */

// Per-event copy. `intro(projectRef, info)` receives the ALREADY-ESCAPED
// project reference (so it may safely contain markup of its own) plus
// { event, hasChanges } — hasChanges lets the wording avoid promising a
// "what changed" list on a save where nothing comparable actually changed
// (e.g. only resources were edited). An event with no entry here falls back
// to GENERIC_COPY: every existing notification keeps working, it just reads
// better.
const EVENT_COPY = {
  "Project Rejected": {
    subjectPrefix: "Action required — project rejected",
    intro: (p) => `Finance has reviewed ${p} and <strong>rejected</strong> it. The project can't move forward until the points below are addressed.`,
    reasonLabel: "Reason for rejection",
    nextStep: "Please review the reason above, make the necessary corrections to the project, and resubmit it for approval. Reply to Finance directly if anything needs clarification.",
  },
  "Project Approved": {
    subjectPrefix: "Project approved",
    intro: (p) => `Finance has reviewed ${p} and <strong>approved</strong> it. The project is cleared to proceed.`,
    reasonLabel: "Approver's note",
    nextStep: "No action is needed from you unless the note above says otherwise.",
  },

  /* --- the Project edit family (all four come from one Save on the
     Project screen; resolveEvent picks between them on the status change) --- */
  "Project Updated": {
    subjectPrefix: "Project updated",
    intro: (p, { hasChanges }) =>
      hasChanges
        ? `The details of ${p} have been updated. What changed is listed below.`
        : `${p} has been saved. No project details changed — the update was to its resources or documents.`,
    nextStep: "No action is needed unless these changes affect commercials or billing already in flight.",
  },
  "Project Submitted for Finance Approval": {
    subjectPrefix: "Approval needed — project submitted",
    intro: (p) => `${p} has been submitted for <strong>Finance approval</strong> and is waiting on a decision.`,
    nextStep: "Please review the project under Project Approval in Project Pulse and record your decision.",
  },
  "Active Project Modified - Finance Review Required": {
    subjectPrefix: "Finance review required — active project changed",
    intro: (p) => `${p} is an <strong>active</strong> project and its details have just been changed, so Finance review is required.`,
    nextStep: "Please confirm these changes don't affect approved commercials or invoices already raised, and follow up with the Project Manager if they do.",
  },
  "Project Archived": {
    subjectPrefix: "Project archived",
    intro: (p) => `${p} has been <strong>archived</strong> and is no longer an active project.`,
    nextStep: "No action is needed. The project stays available in Project Pulse for reporting.",
  },
};

const GENERIC_COPY = {
  intro: (p, { event }) => `This is an automated update on ${p}: <strong>${esc(event)}</strong>.`,
  reasonLabel: "Comment",
  nextStep: "",
};

// Left-bordered callout — used for the reason/comment, so the single most
// important line in the mail doesn't read as just another table row.
function callout({ accent, label, text }) {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 22px 0;">
    <tr>
      <td style="background-color:#f8fafc;border-left:4px solid ${accent};padding:14px 16px;">
        <div style="font-size:12px;font-weight:bold;color:${accent};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">${esc(label)}</div>
        <div style="font-size:14px;color:#111827;line-height:1.55;word-break:break-word;white-space:pre-wrap;">${esc(text)}</div>
      </td>
    </tr>
  </table>`;
}

// "What changed" table — Field / Before / After, built from meta.changes
// (see utils/changeSummary.js). Rendered only when the calling screen worked
// out a diff; an event without one simply doesn't get this section.
function changesTable({ accent, changes }) {
  const head = ["Field", "Before", "After"]
    .map((h, i) => `<th style="text-align:left;padding:9px 14px;background-color:#f5f7fa;border-bottom:1px solid #d9dee7;font-size:11.5px;font-weight:bold;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;${i ? "" : "width:34%;"}">${esc(h)}</th>`)
    .join("");
  const body = changes
    .map(
      (c) => `<tr>
      <td style="padding:11px 14px;border-bottom:1px solid #eef1f5;font-weight:bold;color:#374151;word-break:break-word;">${esc(c.label)}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #eef1f5;color:#9ca3af;word-break:break-word;">${esc(c.from)}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #eef1f5;color:#111827;font-weight:bold;word-break:break-word;">${esc(c.to)}</td>
    </tr>`
    )
    .join("");
  return `<div style="font-size:12px;font-weight:bold;color:${accent};text-transform:uppercase;letter-spacing:0.4px;margin:0 0 8px 0;">What changed (${changes.length})</div>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #d9dee7;font-size:14px;margin-bottom:22px;">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function fsdTemplate({ event, recipientLabel, accent, record, user, when, meta }) {
  const copy = EVENT_COPY[event] || GENERIC_COPY;

  // "PRJ-014 — Alpha Migration" when the screen passed the code, else
  // whatever `record` already was (project name, billing ref, ...).
  const label = meta.projectCode && meta.projectName
    ? `${meta.projectCode} — ${meta.projectName}`
    : (record || meta.projectName || "this record");
  const projectRef = `<span style="color:#111827;font-weight:bold;">${esc(label)}</span>`;

  const hasChanges = Array.isArray(meta.changes) && meta.changes.length > 0;
  const intro = copy.intro(projectRef, { event, hasChanges });

  // Only rows we actually have — an empty Client or Value is left out
  // rather than printed as a dash.
  const details = [
    row("Project", label),
    meta.clientName ? row("Client", meta.clientName) : "",
    meta.projectValue ? row("Project value", meta.projectValue) : "",
    meta.duration ? row("Duration", meta.duration) : "",
    meta.fromStatus || meta.toStatus ? row("Status", `${meta.fromStatus || "—"} → ${meta.toStatus || "—"}`) : "",
    row(event.includes("Reject") || event.includes("Approve") ? "Decision by" : "Actioned by", user),
    row("Date & time", when),
  ].join("");

  return `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333; background-color: #ffffff;">
  <div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;color:#9ca3af;text-transform:uppercase;margin-bottom:10px;">Project Pulse</div>
  <h2 style="margin: 0 0 4px 0; font-size: 20px; color: ${accent};">${esc(event)}</h2>
  <div style="height:3px;width:56px;background:${accent};border-radius:2px;margin-bottom:18px;"></div>

  <p style="margin:0 0 20px 0;font-size:14.5px;line-height:1.6;color:#374151;">${intro}</p>

  ${meta.comment ? callout({ accent, label: copy.reasonLabel || "Comment", text: meta.comment }) : ""}

  ${hasChanges ? changesTable({ accent, changes: meta.changes }) : ""}

  <div style="font-size:12px;font-weight:bold;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">Project details</div>
  <table cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; border: 1px solid #d9dee7; font-size: 14px;">
    <tbody>${details}</tbody>
  </table>

  ${copy.nextStep ? `<p style="margin:22px 0 0 0;font-size:14px;line-height:1.6;color:#374151;"><strong style="color:${accent};">Next step:</strong> ${esc(copy.nextStep)}</p>` : ""}

  <p style="margin: 24px 0 0 0; font-size: 12.5px; color: #6b7280; border-top:1px solid #e5e7eb; padding-top:14px;">
    You're receiving this as the ${esc(recipientLabel)} for this project. This is an automated message from Project Pulse — please don't reply to it.
  </p>
  <p style="margin: 10px 0 0 0; font-size: 13px; color: #6b7280;">Regards,<br><strong>Project Pulse Bot</strong></p>
</div>`;
}

// Subject line — an event with its own copy gets a purposeful subject
// ("Action required — project rejected: PRJ-014 — Alpha"); everything else
// keeps the original "[Project Pulse] <event> — <record>" shape.
function buildSubject(event, record, meta) {
  const ref = meta.projectCode && meta.projectName ? `${meta.projectCode} — ${meta.projectName}` : (record || "");
  const prefix = EVENT_COPY[event]?.subjectPrefix;
  if (prefix) return ref ? `${prefix}: ${ref}` : prefix;
  return `[Project Pulse] ${event} — ${ref || event}`;
}

// App-wide date standard: yyyy-MM-dd (date part), with HH:mm alongside since
// this is a "Date & Time" audit field, not a plain date.
function fmtWhen(timestamp) {
  const dt = new Date(timestamp || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const hm = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return `${ymd} ${hm}`;
}

// Sends one mail through /auditflow AND writes the NotificationLog row for
// it (success or failure) — the single choke point both sendAuditMail and
// sendFsdMail go through, so neither has to duplicate the logging.
//
// `fallbackTo` (optional): used ONLY when recipient resolution came back
// completely empty (e.g. a project with no PM/Delivery Head assigned yet,
// or nobody currently holds the Finance role) — i.e. only when nothing
// would otherwise be sent at all. A caller that already has a real "to"
// never touches this path. Currently passed by logAudit() for Project
// Create/Update/Delete only, per the explicit "use this only when there is
// no mail sent for these" requirement — not a general override.
function sendAndLog({ emailType, to, cc, subject, body, sentBy, fallbackTo }) {
  const effectiveTo = to || fallbackTo || "";
  const usedFallback = !to && !!fallbackTo;

  if (!effectiveTo) {
    // Nothing resolvable to send to and no fallback configured for this
    // event — still logged, so gaps in master data show up in the
    // Notification log instead of silently vanishing.
    return callNotificationLogFlow("CREATE", {
      emailType,
      recipientEmail: "",
      ccEmail: cc || "",
      subjectLine: subject,
      deliveryStatus: "Skipped",
      errorMessage: "No recipient could be resolved for this event.",
      sentBy,
    }).catch((e) => console.warn("NotificationLog write failed:", e.message));
  }

  return callAuditEmailFlow({ to: effectiveTo, cc, subject, body })
    .then((result) => {
      const failed = result && result.success === false;
      return callNotificationLogFlow("CREATE", {
        emailType,
        recipientEmail: effectiveTo,
        ccEmail: cc || "",
        subjectLine: subject,
        deliveryStatus: failed ? "Failed" : "Sent",
        errorMessage: failed ? result.error : (usedFallback ? "Sent to default mailbox — no PM/Delivery Head/Finance recipient could be resolved." : ""),
        sentBy,
      });
    })
    .catch((e) => console.warn("NotificationLog write failed:", e.message));
}

// Kept as the ORIGINAL audit mail — same recipients, same content, unchanged
// — now also logged to NotificationLog like every other send.
export function sendAuditMail({ screen, action, record, user, timestamp }, recipients) {
  const when = fmtWhen(timestamp);
  const subject = `[${action}] ${screen} — Audit Alert`;
  const body = auditTemplate({ screen, action, record, user, when });
  sendAndLog({ emailType: "Audit", to: recipients.to, cc: recipients.cc, subject, body, sentBy: user });
}

// Business-event mail — `to`/`cc` are already-resolved, semicolon-joined
// real email strings (see recipientResolver.js), not bucket names.
// `relatedProjectId` is accepted here for backward compatibility with older
// call sites but is deliberately NOT forwarded to sendAndLog/NotificationLog
// any more — that SQL column (and its FK to Project, which was blocking
// Project deletes) has been removed.
// `screen`/`action` still arrive from logAudit's spread of the audit entry;
// only `screen` is read here (as a last-resort label), since the recipient-
// facing mail deliberately no longer prints the raw screen/action pair.
export function sendFsdMail({ event, recipientLabel, accent, to, cc, screen, record, user, timestamp, meta, fallbackTo }) {
  const when = fmtWhen(timestamp);
  const safeMeta = meta || {};
  const subject = buildSubject(event, record || screen, safeMeta);
  const body = fsdTemplate({ event, recipientLabel, accent, record: record || screen, user, when, meta: safeMeta });
  sendAndLog({ emailType: event, to, cc, subject, body, sentBy: user, fallbackTo });
}