import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ClaimView, EmailDraft, Task, User } from "../types";
import { SignaturePad } from "./SignaturePad";

interface Props {
  task: Task;
  view: ClaimView;
  onUpdate: (v: ClaimView) => void;
  setBusy: (b: boolean) => void;
}

const ICON: Record<Task["type"], string> = { upload: "📷", sign: "✍️", send_email: "📧", action: "✔️" };

export function TaskCard({ task, view, onUpdate, setBusy }: Props) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const email = view.emails.find((e) => e.id === task.email_draft_id);

  async function act(fn: () => Promise<ClaimView>) {
    setBusy(true);
    try {
      onUpdate(await fn());
      setOpen(false);
    } catch {
      alert("משהו השתבש. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndComplete(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const docs = await Promise.all([...files].map((f) => api.upload(f, view.claim.id)));
      onUpdate(await api.completeTask(task.id, docs.map((d) => d.id)));
    } catch {
      alert("ההעלאה נכשלה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  const primary = {
    upload: { label: "צלם / העלה", run: () => fileInput.current?.click() },
    sign: { label: "חתום", run: () => setOpen(true) },
    send_email: { label: "פתח מייל", run: () => setOpen(true) },
    action: { label: "סיימתי", run: () => act(() => api.completeTask(task.id)) },
  }[task.type];

  return (
    <div className="card task">
      <div className="task-head">
        <span className="task-icon">{ICON[task.type]}</span>
        <div className="grow">
          <strong>{task.title}</strong>
          <p className="small">{task.instructions}</p>
          {task.reminder_count > 0 && <p className="small muted">נשלחו {task.reminder_count} תזכורות</p>}
        </div>
      </div>
      <div className="task-actions">
        <button className="primary" onClick={primary.run}>
          {primary.label}
        </button>
        {task.type === "upload" && (
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => uploadAndComplete(e.target.files)} />
        )}
      </div>

      {open && task.type === "sign" && (
        <SignModal view={view} onClose={() => setOpen(false)} onSign={(png) => act(() => api.sign(task.id, png))} />
      )}
      {open && task.type === "send_email" && email && (
        <EmailModal email={email} onClose={() => setOpen(false)} onSent={() => act(() => api.emailSent(email.id))} />
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

function SignModal({ view, onClose, onSign }: { view: ClaimView; onClose: () => void; onSign: (png: string) => void }) {
  const [png, setPng] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    api.me().then(setUser);
  }, []);
  const c = view.claim;
  const rows: [string, string | number | null | undefined][] = [
    ["שם המבוטח", user?.full_name],
    ["ת\"ז", user?.id_number],
    ["חברת ביטוח", c.insurer],
    ["הטיפול", c.treatment],
    ["הגורם המטפל", c.provider],
    ["תאריך", c.treatment_date],
    ["סכום", c.amount != null ? `${c.amount} ₪` : null],
    ["חשבון להחזר", user?.bank_details],
  ];
  return (
    <Modal title="חתימה על טופס התביעה" onClose={onClose}>
      <dl className="summary">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="small">
        אני מצהיר/ה כי הפרטים בטופס ובמסמכים המצורפים נכונים ומלאים, וכי ההוצאה שבגינה מוגשת התביעה שולמה על ידי.
      </p>
      <SignaturePad onChange={setPng} />
      <button className="primary wide" disabled={!png} onClick={() => png && onSign(png)}>
        אישור וחתימה
      </button>
    </Modal>
  );
}

export function EmailModal({ email, onClose, onSent }: { email: EmailDraft; onClose: () => void; onSent?: () => void }) {
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
          {email.attachment_ids.map((id) => (
            <a key={id} href={api.fileUrl(id)} target="_blank" rel="noreferrer" className="chip">
              📎 מסמך #{id}
            </a>
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
