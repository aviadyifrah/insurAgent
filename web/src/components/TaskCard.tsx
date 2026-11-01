import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ClaimView, DocumentRow, EmailDraft, Task, User } from "../types";
import { DocLink } from "./DocLink";
import { SignaturePad } from "./SignaturePad";

interface Props {
  task: Task;
  view: ClaimView;
  /** Runs a request while showing the agent as busy; results arrive through the live view. */
  act: (fn: () => Promise<unknown>) => Promise<void>;
}

const ICON: Record<Task["type"], string> = { upload: "📷", sign: "✍️", send_email: "📧", action: "✔️" };

export function TaskCard({ task, view, act }: Props) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const email = view.emails.find((e) => e.id === task.email_draft_id);
  const claimId = view.claim.id;

  function run(fn: () => Promise<unknown>) {
    setOpen(false);
    return act(fn);
  }

  function uploadAndComplete(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;
    return act(async () => {
      const docs = await Promise.all(files.map((f) => api.upload(f, claimId)));
      await api.completeTask(claimId, task.id, docs.map((d) => d.id));
    });
  }

  const primary = {
    upload: { label: "📷 צילום", run: () => cameraInput.current?.click() },
    sign: { label: "חתום", run: () => setOpen(true) },
    send_email: { label: "פתח מייל", run: () => setOpen(true) },
    action: { label: "סיימתי", run: () => run(() => api.completeTask(claimId, task.id)) },
  }[task.type];

  return (
    <div className="card task">
      <div className="task-head">
        <span className="task-icon">{ICON[task.type]}</span>
        <div className="grow">
          <strong>{task.title}</strong>
          <p className="small">{task.instructions}</p>
        </div>
      </div>
      <div className="task-actions">
        {task.type === "upload" && (
          <>
            <button onClick={() => fileInput.current?.click()}>📎 קובץ</button>
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => uploadAndComplete(e.target)} />
            <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => uploadAndComplete(e.target)} />
          </>
        )}
        <button className="primary" onClick={primary.run}>
          {primary.label}
        </button>
      </div>

      {open && task.type === "sign" && (
        <SignModal view={view} onClose={() => setOpen(false)} onSign={(png) => run(() => api.sign(claimId, task.id, png))} />
      )}
      {open && task.type === "send_email" && email && (
        <EmailModal
          email={email}
          documents={view.documents}
          onClose={() => setOpen(false)}
          onSent={() => run(() => api.emailSent(claimId, email.id))}
        />
      )}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

type FieldKey = "full_name" | "id_number" | "bank_details" | "patient_name" | "patient_id_number" | "treatment" | "provider" | "treatment_date" | "amount" | "policy_number";

/** The details that go on the cover page; all editable, so mistakes are fixed before signing. */
const FIELDS: { key: FieldKey; label: string; owner: "user" | "claim"; ltr?: boolean; patientOnly?: boolean }[] = [
  { key: "full_name", label: "שם המבוטח", owner: "user" },
  { key: "id_number", label: "ת\"ז המבוטח", owner: "user", ltr: true },
  { key: "patient_name", label: "שם המטופל", owner: "claim", patientOnly: true },
  { key: "patient_id_number", label: "ת\"ז המטופל", owner: "claim", ltr: true, patientOnly: true },
  { key: "treatment", label: "הטיפול", owner: "claim" },
  { key: "provider", label: "הגורם המטפל", owner: "claim" },
  { key: "treatment_date", label: "תאריך הטיפול", owner: "claim", ltr: true },
  { key: "amount", label: "סכום ששולם (₪)", owner: "claim", ltr: true },
  { key: "policy_number", label: "מספר פוליסה", owner: "claim", ltr: true },
  { key: "bank_details", label: "חשבון להחזר", owner: "user" },
];

function SignModal({ view, onClose, onSign }: { view: ClaimView; onClose: () => void; onSign: (png: string) => void }) {
  const [png, setPng] = useState<string | null>(null);
  const [values, setValues] = useState<Record<FieldKey, string> | null>(null);
  const [initial, setInitial] = useState<Record<FieldKey, string> | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const c = view.claim;
  const fields = FIELDS.filter((f) => !f.patientOnly || c.patient_name);

  useEffect(() => {
    api.me().then((u: User) => {
      const v = {
        full_name: u.full_name ?? "",
        id_number: u.id_number ?? "",
        bank_details: u.bank_details ?? "",
        patient_name: c.patient_name ?? "",
        patient_id_number: c.patient_id_number ?? "",
        treatment: c.treatment ?? "",
        provider: c.provider ?? "",
        treatment_date: c.treatment_date ?? "",
        amount: c.amount != null ? String(c.amount) : "",
        policy_number: c.policy_number ?? "",
      };
      setValues(v);
      setInitial(v);
    });
  }, []);

  async function confirm() {
    if (!png || !values || !initial) return;
    setSaving(true);
    try {
      const changed = fields.filter((f) => values[f.key] !== initial[f.key]);
      const userPatch = Object.fromEntries(changed.filter((f) => f.owner === "user").map((f) => [f.key, values[f.key]]));
      const claimPatch = Object.fromEntries(
        changed
          .filter((f) => f.owner === "claim")
          .map((f) => [f.key, f.key === "amount" ? (values.amount ? Number(values.amount.replace(/[^\d.]/g, "")) : null) : values[f.key]]),
      );
      if (Object.keys(userPatch).length) await api.updateMe(userPatch);
      if (Object.keys(claimPatch).length) await api.patchClaim(c.id, claimPatch);
      onSign(png);
    } catch {
      alert("לא הצלחנו לשמור את הפרטים. אפשר לנסות שוב.");
      setSaving(false);
    }
  }

  return (
    <Modal title="חתימה על הדף המקדים" onClose={onClose}>
      {!values ? (
        <p className="muted">טוען…</p>
      ) : editing ? (
        <div className="edit-fields">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input value={values[f.key]} dir={f.ltr ? "ltr" : undefined} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            </label>
          ))}
          <button className="wide" onClick={() => setEditing(false)}>
            סיום עריכה
          </button>
        </div>
      ) : (
        <>
          <dl className="summary">
            {fields.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{values[f.key] || "—"}</dd>
              </div>
            ))}
          </dl>
          <button className="link" onClick={() => setEditing(true)}>
            ✏️ משהו לא נכון? עריכת הפרטים
          </button>
        </>
      )}
      <p className="small">
        אני מצהיר/ה כי הפרטים בטופס ובמסמכים המצורפים נכונים ומלאים, וכי ההוצאה שבגינה מוגשת התביעה שולמה על ידי.
      </p>
      <SignaturePad onChange={setPng} />
      <button className="primary wide" disabled={!png || !values || saving || editing} onClick={confirm}>
        {saving ? "שומר…" : "אישור וחתימה"}
      </button>
    </Modal>
  );
}

export function EmailModal({
  email,
  documents,
  onClose,
  onSent,
}: {
  email: EmailDraft;
  documents: DocumentRow[];
  onClose: () => void;
  onSent?: () => void;
}) {
  const mailto = `mailto:${email.to_address ?? ""}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  return (
    <Modal title="מייל מוכן לשליחה" onClose={onClose}>
      <dl className="summary">
        <div>
          <dt>אל</dt>
          <dd dir="ltr">{email.to_address ?? <span className="warn">חסרה כתובת: הוסף אותה במייל</span>}</dd>
        </div>
        <div>
          <dt>נושא</dt>
          <dd>{email.subject}</dd>
        </div>
      </dl>
      <pre className="email-body">{email.body}</pre>
      {email.attachment_ids.length > 0 && (
        <div className="attachments">
          <p className="small">
            <strong>קבצים לצרף:</strong> הורד וצרף אותם למייל.
          </p>
          {documents
            .filter((d) => email.attachment_ids.includes(d.id))
            .map((d) => (
              <span key={d.id} className="chip">
                <DocLink doc={d}>📎 {d.filename}</DocLink>
              </span>
            ))}
        </div>
      )}
      <div className="btn-col">
        <a className="button primary" href={mailto}>
          פתח באפליקציית המייל
        </a>
        <button onClick={() => navigator.clipboard.writeText(email.body)}>העתק את הטקסט</button>
        {onSent && email.status === "draft" && (
          <button className="success" onClick={onSent}>
            ✓ שלחתי
          </button>
        )}
      </div>
    </Modal>
  );
}
