// changeSummary.js — builds the "what actually changed" list that the
// business-event mails render (see meta.changes in utils/mail.js).
//
// An "X was updated" notification that doesn't say WHAT was updated makes the
// recipient open the app to find out — which is the one thing the mail was
// supposed to save them. Finance gets "Project Updated" mails on every edit,
// so without this they're noise and get filtered away.
//
// Pure and dependency-free on purpose: the caller supplies both records and a
// field spec (label + optional formatter, usually an id -> name lookup), so
// this knows nothing about projects, flows or React.

const DASH = "—";

// Everything empty-ish reads as the same "not set" so an id arriving as 0 vs
// "" vs null never shows up as a spurious change.
function defaultFormat(v) {
  if (v === undefined || v === null || v === "") return DASH;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/**
 * @param {object} before  record as it was (use {} for a create)
 * @param {object} after   record as it now is
 * @param {Array<{key: string, label: string, format?: (v:any)=>string}>} fields
 *        fields to compare, in the order they should appear in the mail
 * @returns {Array<{label: string, from: string, to: string}>} only what differs
 *
 * Comparison is on the FORMATTED values, so a change that's invisible to a
 * human (clientId 7 -> "7") is correctly reported as no change, and a real one
 * is described in the words the recipient sees in the UI ("Acme Corp", not "7").
 */
export function diffFields(before, after, fields) {
  const out = [];
  (fields || []).forEach(({ key, label, format }) => {
    const fmt = format || defaultFormat;
    const rawFrom = before ? before[key] : undefined;
    const rawTo = after ? after[key] : undefined;
    // An empty id must stay "—" even when a formatter would map it to
    // something else (findName(list, "") can return a stray first row).
    const from = rawFrom === undefined || rawFrom === null || rawFrom === "" ? DASH : fmt(rawFrom);
    const to = rawTo === undefined || rawTo === null || rawTo === "" ? DASH : fmt(rawTo);
    if (from !== to) out.push({ label, from, to });
  });
  return out;
}
