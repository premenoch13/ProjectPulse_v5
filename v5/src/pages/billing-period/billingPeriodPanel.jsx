import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { COLORS, inputStyle, labelStyle } from "../../constants/theme";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Full-screen page, same convention as Project Panel / Billing Form Panel —
// no side-drawer variant here, this form is short enough that it doesn't
// need one, but the app should look consistent everywhere in PM + Finance.
export function BillingPeriodPanel({ mode, data, saving, error, onCancel, onClose, onSubmit }) {
  const [form, setForm] = useState(data);
  useEffect(() => setForm(data), [data]);

  const applyMonthYear = (billingMonth, billingYear) => {
    const m = Number(billingMonth), y = Number(billingYear);
    let periodName = form.periodName, periodStartDate = form.periodStartDate, periodEndDate = form.periodEndDate;
    if (m && y) {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      periodStartDate = start.toISOString().slice(0, 10);
      periodEndDate = end.toISOString().slice(0, 10);
      if (!form.periodName || form._autoName) periodName = `${MONTHS[m - 1]} ${y} (${String(m).padStart(2, "0")}/${y})`;
    }
    setForm((f) => ({ ...f, billingMonth, billingYear, periodName, periodStartDate, periodEndDate, _autoName: true }));
  };

  return (
    <div className="pp-project-page" style={{ flex: 1, background: COLORS.bg, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ padding: "22px 28px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: COLORS.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onClose} title="Back to Billing Periods" aria-label="Back to Billing Periods" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: COLORS.text }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: COLORS.text, fontFamily: "Sora, sans-serif" }}>{mode === "add" ? "Add Billing Period" : "Edit Billing Period"}</div>
            <div style={{ fontSize: 12, color: COLORS.accent, marginTop: 2 }}>One period per calendar month, used by Billing and Invoicing</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 28px 40px", flex: 1, maxWidth: 860, width: "100%", margin: "0 auto" }}>
        <div className="pp-form-grid">
          <div>
            <label style={labelStyle}>Month*</label>
            <select value={form.billingMonth || ""} onChange={(e) => applyMonthYear(e.target.value, form.billingYear)} style={inputStyle}>
              <option value="">Select month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Year*</label>
            <input type="number" value={form.billingYear || ""} onChange={(e) => applyMonthYear(form.billingMonth, e.target.value)} placeholder="e.g. 2026" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Period Name*</label>
            <input value={form.periodName || ""} onChange={(e) => setForm({ ...form, periodName: e.target.value, _autoName: false })} placeholder="e.g. Aug 2026 (01–31 Aug)" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Start Date*</label>
            <input type="date" value={form.periodStartDate || ""} onChange={(e) => setForm({ ...form, periodStartDate: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End Date*</label>
            <input type="date" value={form.periodEndDate || ""} onChange={(e) => setForm({ ...form, periodEndDate: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Closed</label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: `1px solid ${COLORS.border}`, borderRadius: 10, height: 40, boxSizing: "border-box" }}>
              <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>Closed periods can still be viewed but shouldn't take new billing</span>
              <div onClick={() => setForm({ ...form, isClosed: !form.isClosed })} style={{ width: 40, height: 22, borderRadius: 999, background: form.isClosed ? COLORS.accent : "COLORS.toggleOff", position: "relative", cursor: "pointer", flexShrink: 0, marginLeft: 10 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: form.isClosed ? 20 : 2, transition: "left 0.15s" }} />
              </div>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Active</label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: `1px solid ${COLORS.border}`, borderRadius: 10, height: 40, boxSizing: "border-box" }}>
              <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>Visible in dropdowns and reports</span>
              <div onClick={() => setForm({ ...form, active: !form.active })} style={{ width: 40, height: 22, borderRadius: 999, background: form.active ? COLORS.accent : "COLORS.toggleOff", position: "relative", cursor: "pointer", flexShrink: 0, marginLeft: 10 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: form.active ? 20 : 2, transition: "left 0.15s" }} />
              </div>
            </div>
          </div>
        </div>

        {error && <div style={{ display: "flex", gap: 8, alignItems: "center", color: COLORS.danger, fontSize: 12.5, marginTop: 16 }}><AlertCircle size={14} /> {error}</div>}
      </div>

      <div style={{ padding: "16px 28px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.card, display: "flex", gap: 10, justifyContent: "flex-end", position: "sticky", bottom: 0 }}>
        <button onClick={onCancel} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: COLORS.text }}>Cancel</button>
        <button onClick={() => onSubmit(form)} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: COLORS.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.75 : 1, display: "flex", alignItems: "center", gap: 7 }}>
          {saving && <Loader2 size={13} className="spin" />}
          {saving ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}