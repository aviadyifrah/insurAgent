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
          {task.reminder_count > 0 && <p className="small muted">נשלחו {task.reminder_count} תזכורות</p>}
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
