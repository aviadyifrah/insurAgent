import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate } from "../App";
import { Composer } from "../components/Composer";
import { EmailModal, TaskCard } from "../components/TaskCard";
import type { ClaimView, EmailDraft, Requirement } from "../types";
import { Progress } from "./Home";

const REQ_STATUS: Record<Requirement["status"], { icon: string; label: string }> = {
  missing: { icon: "⬜", label: "חסר" },
  pending_user: { icon: "⚠️", label: "ממתין לך" },
  pending_third_party: { icon: "⏳", label: "ממתין למרפאה" },
  done: { icon: "✅", label: "הושלם" },
  not_needed: { icon: "➖", label: "לא נדרש" },
};

export function ClaimPage({ claimId }: { claimId: number }) {
  const [view, setView] = useState<ClaimView | null>(null);
  const [tab, setTab] = useState<"chat" | "file">("chat");
  const [busy, setBusy] = useState(false);
  const [openEmail, setOpenEmail] = useState<EmailDraft | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.claim(claimId).then(setView).catch(() => navigate("/"));
  }, [claimId]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [view?.chat.length, busy, tab]);

  if (!view) return <div className="splash">טוען…</div>;

  const { claim, requirements, tasks, emails, documents, chat } = view;
  const required = requirements.filter((r) => r.required);
  const done = required.filter((r) => r.status === "done" || r.status === "not_needed").length;
  const openTasks = tasks.filter((t) => t.status === "open");

  async function send(text: string, documentIds: number[]) {
    setBusy(true);
    try {
      setView(await api.sendMessage(claimId, text, documentIds));
    } finally {
      setBusy(false);
    }
  }

  async function markSubmitted() {
    setBusy(true);
    try {
      setView(await api.markSubmitted(claimId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page claim-page">
      <header className="topbar">
        <button className="icon-btn" onClick={() => navigate("/")} aria-label="חזרה">
          →
        </button>
        <div className="grow">
          <h1>{claim.title ?? "תביעה חדשה"}</h1>
          {required.length > 0 && <Progress done={done} total={required.length} />}
        </div>
      </header>

      {claim.package_document_id && claim.status !== "submitted" && (
        <section className="card package">
          <strong>📦 חבילת ההגשה מוכנה</strong>
          <p className="small">הורד את הקובץ והגש אותו לפי ההנחיות בצ'אט. אחרי ההגשה סמן כאן.</p>
          <div className="btn-row">
            <a className="button primary" href={api.fileUrl(claim.package_document_id)} target="_blank" rel="noreferrer">
              הורד PDF
            </a>
            <button onClick={markSubmitted} disabled={busy}>
              הגשתי ✓
            </button>
          </div>
        </section>
      )}

      {openTasks.length > 0 && (
        <section className="tasks">
          {openTasks.map((t) => (
            <TaskCard key={t.id} task={t} view={view} onUpdate={setView} setBusy={setBusy} />
          ))}
        </section>
      )}

      <nav className="tabs">
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          💬 צ'אט
        </button>
        <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>
          📁 התיק ({done}/{required.length})
        </button>
      </nav>

      {tab === "chat" ? (
        <section className="chat">
          {chat.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.text}
            </div>
          ))}
          {busy && <div className="bubble assistant typing">הסוכן עובד…</div>}
          <div ref={chatEnd} />
        </section>
      ) : (
        <section className="file">
          <h3>מסמכים נדרשים</h3>
          <ul className="checklist">
            {requirements.map((r) => (
              <li key={r.id} className={r.status}>
                <span>{REQ_STATUS[r.status].icon}</span>
                <div className="grow">
                  <div>
                    {r.title}
                    {!r.required && <span className="muted small"> (לפי הצורך)</span>}
                  </div>
                  <div className="small muted">{r.note ?? REQ_STATUS[r.status].label}</div>
                </div>
                {r.document_id && (
                  <a className="small" href={api.fileUrl(r.document_id)} target="_blank" rel="noreferrer">
                    צפה
                  </a>
                )}
              </li>
            ))}
          </ul>

          {emails.length > 0 && (
            <>
              <h3>מיילים</h3>
              <ul className="list">
                {emails.map((e) => (
                  <li key={e.id} className="card row" onClick={() => setOpenEmail(e)}>
                    <div className="grow">
                      <strong>{e.subject}</strong>
                      <div className="small muted">{e.status === "sent" ? "נשלח" : "טיוטה"}</div>
                    </div>
                    <span className="chevron">‹</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>כל המסמכים</h3>
          <ul className="list">
            {documents
              .filter((d) => d.kind !== "signature")
              .map((d) => (
                <li key={d.id}>
                  <a href={api.fileUrl(d.id)} target="_blank" rel="noreferrer">
                    📎 {d.filename}
                  </a>
                  {d.claim_id !== claim.id && <span className="muted small"> (מתביעה קודמת)</span>}
                </li>
              ))}
          </ul>
        </section>
      )}

      {claim.status !== "submitted" && (
        <div className="composer-dock">
          <Composer claimId={claimId} placeholder="כתוב לסוכן…" busy={busy} onSend={send} />
        </div>
      )}

      {openEmail && <EmailModal email={openEmail} onClose={() => setOpenEmail(null)} />}
    </main>
  );
}
