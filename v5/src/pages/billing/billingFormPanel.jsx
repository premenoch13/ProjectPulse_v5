import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileCheck,
  UploadCloud,
  Trash2,
  FileText,
} from "lucide-react";
import { COLORS, inputStyle, labelStyle } from "../../constants/theme";
import { callProjectResourceFlow, callDesignationFlow, callProjectDocumentFlow } from "../../api/flows";
import { getCurrentUserId } from "../../utils/session";
import { activeOptions } from "../../utils/validation";

// The Timesheet table has no attachment column, so an "Approved Timesheet"
// file for a given resource + billing period is stored as a ProjectDocument
// row (same workaround used for Billing's own Supporting Documents), tagged
// docType "Timesheet Approval" and identified by this docName convention so
// it can be looked up per resource/period without a real foreign key.
const timesheetDocName = (userId, periodId) => `Timesheet_${userId}_${periodId || "NA"}`;

// Replaces the earlier NewBillingTMPanel + BillingPanel split. One page,
// one code path, per FSD 4.6 (both T&M and Fixed Bid billing types) —
// the split was the likely source of the submit error, since Add always
// opened the T&M-only panel first and silently swapped components under
// the same form state. Layout follows the exact convention ProjectPanel
// already uses for its full-screen Add/Edit: "pp-project-page" shell +
// "pp-form-grid" (auto-fit 200px columns -> 3-4 per row on a normal
// screen) instead of a narrow centered column.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function BillingFormPanel({
  mode,
  data,
  projects,
  clients,
  billingTypes,
  billingPeriods,
  currencies,
  users,
  approvalStatuses,
  existingBillingRows,
  saving,
  error,
  onCancel,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState(data);
  useEffect(() => setForm(data), [data]);

  const [resources, setResources] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [docs, setDocs] = useState([]);
  const [docError, setDocError] = useState("");

  // Billable Hours is read-only here, straight off ProjectResource.weeklyHours
  // (the same figure shown as "Weekly Hrs" on the Resource Allocation grid) —
  // no Timesheet write from this screen, so no CHECK-constraint risk.
  // Approved Timesheet file is still staged locally and uploaded as a
  // ProjectDocument alongside Supporting Documents when Billing is submitted.
  const [hoursError, setHoursError] = useState("");
  const [timesheetDocs, setTimesheetDocs] = useState([]); // ProjectDocument rows, docType "Timesheet Approval"
  const [stagedTsFiles, setStagedTsFiles] = useState({}); // { [userId]: { fileName, fileData } }

  useEffect(() => { callDesignationFlow("LIST").then((res) => setDesignations(res.data)).catch(() => {}); }, []);

  const project = projects.find((p) => String(p.guid ?? p.id) === String(form.projectId));
  const client = project ? clients.find((c) => String(c.id ?? c.guid) === String(project.clientId)) : null;
  const billingTypeName = (id) => billingTypes.find((b) => String(b.id ?? b.guid) === String(id))?.name || "";
  const currencyCode = (id) => currencies.find((c) => String(c.id ?? c.guid) === String(id))?.code || "";
  const period = billingPeriods.find((p) => String(p.id ?? p.guid) === String(form.billingPeriodId));

  const typeName = project ? billingTypeName(project.billingTypeId) : billingTypeName(form.billingTypeId);
  const isTM = /time\s*&?\s*material|t\s*&\s*m/i.test(typeName);
  const isFixedBid = /fixed\s*bid/i.test(typeName);

  // Billable Resources reference grid is shown for every billing type now
  // (not just T&M) — fetch runs for any project, regardless of billing type.
  useEffect(() => {
    if (!form.projectId) { setResources([]); setTimesheetDocs([]); return; }
    setLoadingResources(true);
    Promise.all([
      callProjectResourceFlow("LIST"),
      callProjectDocumentFlow("LIST").catch(() => ({ data: [] })),
    ]).then(([resRes, docRes]) => {
      setResources((resRes.data || []).filter((r) => String(r.projectId) === String(form.projectId)));
      setTimesheetDocs((docRes.data || []).filter((d) => String(d.projectId) === String(form.projectId) && d.docType === "Timesheet Approval"));
      setLoadingResources(false);
    }).catch(() => setLoadingResources(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.projectId]);

  const onProjectChange = (projectId) => {
    const p = projects.find((x) => String(x.guid ?? x.id) === String(projectId));
    setForm((f) => ({
      ...f,
      projectId,
      billingTypeId: p ? p.billingTypeId : "",
      currencyId: p ? p.currencyId : "",
      billingPeriodId: "",
    }));
  };

  const duplicatePeriod = useMemo(() => {
    if (!form.projectId || !form.billingPeriodId) return false;
    return (existingBillingRows || []).some((r) =>
      String(r.projectId) === String(form.projectId) &&
      String(r.billingPeriodId) === String(form.billingPeriodId) &&
      String(r.guid) !== String(form.guid || "")
    );
  }, [form.projectId, form.billingPeriodId, form.guid, existingBillingRows]);

  const activePeriods = billingPeriods.filter((p) => p.active !== false);
  const activeProjects = projects.filter((p) => p.active !== false);

  const resourceRows = resources.map((r) => {
    const u = users.find((x) => String(x.guid ?? x.id) === String(r.userId));
    const designationName = designations.find((d) => String(d.guid ?? d.id) === String(r.designationId))?.name || "—";
    const docName = timesheetDocName(r.userId, form.billingPeriodId);
    const savedDoc = timesheetDocs.find((d) => d.docName === docName);
    const staged = stagedTsFiles[r.userId];
    return {
      key: r.id,
      userId: r.userId,
      name: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.empId : "—",
      designation: designationName,
      allocationPct: r.allocationPct,
      weeklyHours: r.weeklyHours,
      savedDoc,
      staged,
    };
  });

  const totalBillableHours = resourceRows.reduce((sum, r) => sum + (Number(r.weeklyHours) || 0), 0);

  const addTimesheetFile = (userId, fileList) => {
    const file = (fileList || [])[0];
    if (!file) return;
    setHoursError("");
    if (file.size > MAX_FILE_BYTES) {
      setHoursError(`"${file.name}" is too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      setStagedTsFiles((s) => ({ ...s, [userId]: { fileName: file.name, fileData: base64 } }));
    };
    reader.readAsDataURL(file);
  };

  const uploadStagedTimesheetDocs = () => {
    const uploaderId = getCurrentUserId();
    return Promise.all(Object.entries(stagedTsFiles).map(([userId, d]) =>
      callProjectDocumentFlow("CREATE", {
        projectId: form.projectId,
        docName: timesheetDocName(userId, form.billingPeriodId),
        docType: "Timesheet Approval",
        uploadedByUserId: uploaderId,
        uploadDate: new Date().toISOString().slice(0, 10),
        fileName: d.fileName,
        fileData: d.fileData,
      }).catch(() => {})
    ));
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    setDocError("");
    files.forEach((file) => {
      if (file.size > MAX_FILE_BYTES) {
        setDocError(`"${file.name}" is too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB).`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(",")[1] || "";
        setDocs((d) => [...d, { fileName: file.name, sizeLabel: `${(file.size / 1024).toFixed(0)} KB`, fileData: base64 }]);
      };
      reader.readAsDataURL(file);
    });
  };
  const removeDoc = (fileName) => setDocs((d) => d.filter((x) => x.fileName !== fileName));

  const uploadStagedDocs = () => {
    const uploaderId = getCurrentUserId();
    return Promise.all(docs.map((d) =>
      callProjectDocumentFlow("CREATE", {
        projectId: form.projectId,
        docName: d.fileName,
        docType: "Billing Support",
        uploadedByUserId: uploaderId,
        uploadDate: new Date().toISOString().slice(0, 10),
        fileName: d.fileName,
        fileData: d.fileData,
      }).catch(() => {})
    ));
  };

  const submittedByLabel = () => {
    const id = form.submittedByUserId || getCurrentUserId();
    const u = users.find((x) => String(x.guid ?? x.id) === String(id));
    return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.empId : "—";
  };

  const handleSubmit = () => {
    onSubmit(
      { ...form, submittedByUserId: form.submittedByUserId || getCurrentUserId() },
      () => Promise.all([uploadStagedDocs(), uploadStagedTimesheetDocs()])
    );
  };

  return (
    <div className="pp-project-page" style={{ flex: 1, background: COLORS.bg, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ padding: "22px 28px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: COLORS.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onClose} title="Back to Billing" aria-label="Back to Billing" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: COLORS.text }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: COLORS.text, fontFamily: "Sora, sans-serif" }}>
              {mode === "add" ? "Submit Billing" : "Edit Billing"}{typeName ? ` — ${typeName}` : ""}
            </div>
            <div style={{ fontSize: 12, color: COLORS.accent, marginTop: 2 }}>
              {isFixedBid ? "Milestone billing against the milestones defined on the project" : "Monthly billing from approved timesheets of billable resources"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 28px 40px", flex: 1, maxWidth: 860, width: "100%", margin: "0 auto" }}>
        <SectionHeader n={1} label="Billing Details" />
        <div className="pp-form-grid">
          <div>
            <label style={labelStyle}>Project*</label>
            <select value={form.projectId || ""} onChange={(e) => onProjectChange(e.target.value)} style={inputStyle}>
              <option value="">Select project</option>
              {activeProjects.map((p) => <option key={p.guid ?? p.id} value={p.guid ?? p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
            <div style={hint}>Only Active projects are listed</div>
          </div>
          <div>
            <label style={labelStyle}>Customer</label>
            <input value={client ? client.name : ""} disabled style={{ ...inputStyle, opacity: 0.7 }} placeholder="Auto" />
          </div>
          <div>
            <label style={labelStyle}>Billing Type</label>
            <input value={typeName || "—"} disabled style={{ ...inputStyle, opacity: 0.7 }} />
            <div style={hint}>From project</div>
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <input value={project ? currencyCode(project.currencyId) : ""} disabled style={{ ...inputStyle, opacity: 0.7 }} placeholder="Auto" />
            <div style={hint}>From project</div>
          </div>
          <div>
            <label style={labelStyle}>Billing Period*</label>
            <select value={form.billingPeriodId || ""} onChange={(e) => setForm({ ...form, billingPeriodId: e.target.value })} style={inputStyle} disabled={!form.projectId}>
              <option value="">Select period</option>
              {activePeriods.map((p) => <option key={p.guid ?? p.id} value={p.guid ?? p.id}>{p.periodName}</option>)}
            </select>
            {duplicatePeriod ? (
              <div style={{ ...hint, color: COLORS.danger, display: "flex", alignItems: "center", gap: 6 }}><AlertCircle size={12} /> Already billed for this period.</div>
            ) : <div style={hint}>One billing per project + period</div>}
          </div>
          {isFixedBid && (
            <div>
              <label style={labelStyle}>Milestone Name{isFixedBid ? "*" : ""}</label>
              <input value={form.milestoneName || ""} onChange={(e) => setForm({ ...form, milestoneName: e.target.value })} placeholder="e.g. M2 - UAT Sign-off" style={inputStyle} />
              <div style={hint}>Fixed Bid only — matched against the project's milestone list by name</div>
            </div>
          )}
          <div>
            <label style={labelStyle}>Amount*</label>
            <input type="number" min="0" step="0.01" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 420000" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Submitted By</label>
            <select value={form.submittedByUserId || ""} onChange={(e) => setForm({ ...form, submittedByUserId: e.target.value })} style={inputStyle}>
              <option value="">{submittedByLabel()}</option>
              {activeOptions(users, form.submittedByUserId).map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          </div>
          {mode === "edit" && (
            <div>
              <label style={labelStyle}>Approval Status</label>
              <select value={form.approvalStatusId || ""} onChange={(e) => setForm({ ...form, approvalStatusId: e.target.value })} style={inputStyle}>
                <option value="">Select status</option>
                {activeOptions(approvalStatuses, form.approvalStatusId).map((s) => <option key={s.guid} value={s.guid}>{s.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <SectionHeader n={2} label="Billable Resources" sub="Auto-loaded · billable only" />
        <div className="pp-field-full" style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: COLORS.bg }}>
                {["Resource", "Designation", "Alloc %", "Billable Hours", "Approved Timesheet"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: COLORS.textMuted, fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!form.projectId ? (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: COLORS.textMuted }}>Select a project first.</td></tr>
              ) : loadingResources ? (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: COLORS.textMuted }}><Loader2 size={14} className="spin" style={{ verticalAlign: "middle", marginRight: 6 }} />Loading…</td></tr>
              ) : resourceRows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: COLORS.textMuted }}>No billable resources allocated to this project.</td></tr>
              ) : resourceRows.map((r) => (
                <tr key={r.key} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, color: COLORS.text }}>{r.name}</td>
                  <td style={{ padding: "8px 10px", color: COLORS.text }}>{r.designation}</td>
                  <td style={{ padding: "8px 10px", color: COLORS.text }}>{r.allocationPct}%</td>
                  <td style={{ padding: "8px 10px", color: COLORS.text }}>{r.weeklyHours || 0} hrs</td>
                  <td style={{ padding: "8px 10px" }}>
                    {r.staged ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: COLORS.accent, fontWeight: 600 }}><FileCheck size={12} /> {r.staged.fileName} <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>(pending save)</span></span>
                    ) : r.savedDoc ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: COLORS.text }}><FileText size={12} /> {r.savedDoc.fileName || r.savedDoc.docName}</span>
                    ) : (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", color: COLORS.accent, fontWeight: 600, fontSize: 12, border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: "4px 9px" }}>
                        <UploadCloud size={12} /> Upload timesheet
                        <input type="file" style={{ display: "none" }} onChange={(e) => addTimesheetFile(r.userId, e.target.files)} />
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resourceRows.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 20, padding: "8px 12px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.bg, fontSize: 12, color: COLORS.textMuted }}>
              <span>Billable resources <strong style={{ color: COLORS.text }}>{resourceRows.length}</strong></span>
              <span>Total Billable Hours <strong style={{ color: COLORS.text }}>{totalBillableHours.toFixed(1)}</strong></span>
            </div>
          )}
          {hoursError && <div style={{ ...hint, color: COLORS.danger, padding: "0 10px 8px" }}>{hoursError}</div>}
        </div>

        <SectionHeader n={3} label="Supporting Documents" />
        <div className="pp-field-full">
          <label
            htmlFor="billing-doc-input"
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, border: `1.5px dashed ${COLORS.border}`, borderRadius: 10, padding: "18px 12px", cursor: "pointer", color: COLORS.textMuted, textAlign: "center" }}
          >
            <UploadCloud size={20} />
            <span style={{ fontSize: 12.5 }}>Drop files or <span style={{ color: COLORS.accent, fontWeight: 600 }}>browse</span></span>
            <span style={{ fontSize: 11 }}>PDF, DOCX, XLSX, JPG, PNG</span>
            <input id="billing-doc-input" type="file" multiple onChange={(e) => addFiles(e.target.files)} style={{ display: "none" }} />
          </label>
          {docError && <div style={{ ...hint, color: COLORS.danger, marginTop: 6 }}>{docError}</div>}
          {docs.map((d) => (
            <div key={d.fileName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, padding: "8px 12px", background: COLORS.accentSoft, borderRadius: 8, fontSize: 12.5 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.accent, fontWeight: 600 }}><FileCheck size={13} /> {d.fileName} <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>({d.sizeLabel})</span></span>
              <button type="button" onClick={() => removeDoc(d.fileName)} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        <SectionHeader n={4} label="Remarks" />
        <div className="pp-field-full">
          <textarea value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={3} placeholder="Optional notes for Finance" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {error && <div style={{ display: "flex", gap: 8, alignItems: "center", color: COLORS.danger, fontSize: 12.5, marginTop: 16 }}><AlertCircle size={14} /> {error}</div>}
      </div>

      <div style={{ padding: "16px 28px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.card, display: "flex", gap: 10, justifyContent: "flex-end", position: "sticky", bottom: 0 }}>
        <button onClick={onCancel} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: COLORS.text }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving || duplicatePeriod} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: COLORS.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: (saving || duplicatePeriod) ? "default" : "pointer", opacity: (saving || duplicatePeriod) ? 0.6 : 1, display: "flex", alignItems: "center", gap: 7 }}>
          {saving && <Loader2 size={13} className="spin" />}
          {saving ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

const hint = { fontSize: 11, color: COLORS.textMuted, marginTop: 4 };

function SectionHeader({ n, label, sub }) {
  return (
    <div className="pp-field-full" style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 22, marginBottom: 10 }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, background: COLORS.accentSoft, color: COLORS.accent, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
      <span style={{ fontWeight: 700, fontSize: 13.5, color: COLORS.text }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: COLORS.textMuted }}>· {sub}</span>}
    </div>
  );
}