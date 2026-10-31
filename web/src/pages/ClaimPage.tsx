import { useEffect, useRef, useState } from "react";
import { api, errorMessage, pendingFirstMessage } from "../api";
import { navigate } from "../App";
import { useClaimLive } from "../useClaimLive";
import { Composer } from "../components/Composer";
import { Disclaimer } from "../components/Disclaimer";
import { DocLink } from "../components/DocLink";
import { EmailModal, TaskCard } from "../components/TaskCard";
import { ReminderCard, reminderDay } from "../components/ReminderCard";
import { downloadClaimPackage } from "../claimPackage";
import type { EmailDraft, Requirement, User } from "../types";
import { Progress } from "./Home";

const REQ_STATUS: Record<Requirement["status"], { icon: string; label: string }> = {
  missing: { icon: "⬜", label: "חסר" },
  pending_user: { icon: "⚠️", label: "ממתין לך" },
  pending_third_party: { icon: "⏳", label: "ממתין למרפאה" },
  done: { icon: "✅", label: "הושלם" },
  not_needed: { icon: "➖", label: "לא נדרש" },
};

/** The agent writes plain text with occasional **bold**; render just that. */
function withBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function ClaimPage({ claimId, user }: { claimId: string; user: User }) {
  const live = useClaimLive(claimId, user.id);
  const [tab, setTab] = useState<"chat" | "file">("chat");
  const [busy, setBusy] = useState(false);
  const [openEmail, setOpenEmail] = useState<EmailDraft | null>(null);
  const [missingLocal, setMissingLocal] = useState<string[]>([]);
  const chatEnd = useRef<HTMLDivElement>(null);
  const view = live === "not_found" ? null : live;

  // Runs a request that makes the agent work; its progress arrives live, so the response is ignored.
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (live === "not_found") navigate("/");
  }, [live]);

  // A claim just created on the home screen: send its first message now that we're watching.
  useEffect(() => {
    const first = pendingFirstMessage.get(claimId);
    if (!first) return;
    pendingFirstMessage.delete(claimId);
    act(() => api.sendMessage(claimId, first.text, first.documentIds));
  }, [claimId]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [view?.chat.length, view?.reminders.length, view?.claim.agent_status, busy, tab]);

  if (!view) return <div className="splash">טוען…</div>;

  const { claim, requirements, tasks, emails, documents, chat, reminders } = view;
  const suggestedReminders = reminders.filter((r) => r.status === "suggested");
  // A suggestion is created mid-turn, before the agent's message is saved; order it after the
  // message that was written in the same run so the card follows the text that introduces it.
  const timeline = [
    ...chat.map((m) => ({ kind: "message" as const, at: m.created_at, m })),
    ...suggestedReminders.map((r) => ({ kind: "reminder" as const, at: chat.find((m) => m.role === "assistant" && m.created_at > r.created_at)?.created_at ?? r.created_at, r })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "message" ? -1 : 1));
  const addedReminders = reminders.filter((r) => r.status === "added");
  const required = requirements.filter((r) => r.required);
  const done = required.filter((r) => r.status === "done" || r.status === "not_needed").length;
  const openTasks = tasks.filter((t) => t.status === "open");
  const docById = new Map(documents.map((d) => [d.id, d]));
  // The agent runs in the background; its status comes from Firestore. A run that died without
  // resetting the status stops counting as "working" after 10 minutes.
  const agentWorking =
    claim.agent_status === "working" && Date.now() - Date.parse(claim.agent_started_at ?? "") < 10 * 60 * 1000;

  const send = (text: string, documentIds: string[]) => act(() => api.sendMessage(claimId, text, documentIds));
  const markSubmitted = () => act(() => api.markSubmitted(claimId));

  async function downloadPackage() {
    setBusy(true);
    try {
      const { missing } = await downloadClaimPackage(view!, await api.me());
      setMissingLocal(missing);
    } catch {
      alert("לא הצלחנו לבנות את הקובץ. נסה שוב.");
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
      <Disclaimer />

      {claim.status === "ready" && (
        <section className="card package">
          <strong>📦 התיק מוכן להגשה</strong>
          <p className="small">הקובץ נבנה כאן במכשיר. הורד אותו והגש בעצמך לפי ההנחיות בצ'אט, ואחרי ההגשה סמן כאן.</p>
          {missingLocal.length > 0 && (
            <p className="small warn">לא נמצאו במכשיר הזה: {missingLocal.join(", ")}. העלה אותם שוב דרך הצ'אט.</p>
          )}
          <div className="btn-row">
            <button className="primary" onClick={downloadPackage} disabled={busy}>
              הורד PDF
            </button>
            <button onClick={markSubmitted} disabled={busy}>
              הגשתי ✓
            </button>
          </div>
        </section>
      )}

      {openTasks.length > 0 && (
        <section className="tasks">
          {openTasks.map((t) => (
            <TaskCard key={t.id} task={t} view={view} act={act} />
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
          {timeline.map((item) =>
            item.kind === "message" ? (
              <div key={item.m.id} className={`bubble ${item.m.role}`}>
                {withBold(item.m.text)}
              </div>
            ) : (
              // Reminder suggestions sit in the conversation, where the agent mentions them.
              <ReminderCard key={item.r.id} reminder={item.r} onChoice={(status) => api.setReminder(claimId, item.r.id, status).catch(() => {})} />
            ),
          )}
          {(busy || agentWorking) && <div className="bubble assistant typing">הסוכן עובד…</div>}
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
                {docById.get(r.document_id ?? "") && (
                  <span className="small">
                    <DocLink doc={docById.get(r.document_id!)!}>צפה</DocLink>
                  </span>
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

          {addedReminders.length > 0 && (
            <>
              <h3>תזכורות ביומן</h3>
              <ul className="list">
                {addedReminders.map((r) => (
                  <li key={r.id}>
                    ⏰ {r.title} <span className="small muted">· {reminderDay(r)}</span>
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
                  <DocLink doc={d}>📎 {d.filename}</DocLink>
                  {d.claim_id !== claim.id && <span className="muted small"> (מתביעה קודמת)</span>}
                  {d.analysis?.summary_he && <div className="small muted">{d.analysis.summary_he}</div>}
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

      {openEmail && <EmailModal email={openEmail} documents={documents} onClose={() => setOpenEmail(null)} />}
    </main>
  );
}
