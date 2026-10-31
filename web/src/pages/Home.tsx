import { useEffect, useState } from "react";
import { api, pendingFirstMessage } from "../api";
import { navigate } from "../App";
import { Disclaimer } from "../components/Disclaimer";
import { Composer } from "../components/Composer";
import type { ClaimSummary, User } from "../types";

const STATUS_LABEL: Record<ClaimSummary["status"], string> = {
  collecting: "אוסף מסמכים",
  ready: "מוכן להגשה",
  submitted: "הוגש",
};

export function Home({ user }: { user: User }) {
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const tasks = claims.flatMap((c) => c.open_task_list.map((t) => ({ ...t, claim_title: c.title })));

  useEffect(() => {
    api.claims().then(setClaims);
  }, []);

  async function startClaim(text: string, documentIds: string[]) {
    setBusy(true);
    try {
      const claim = await api.createClaim();
      // The claim screen sends this message and shows the agent working on it live.
      pendingFirstMessage.set(claim.id, { text, documentIds });
      navigate(`/claims/${claim.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>שלום{user.full_name ? `, ${user.full_name.split(" ")[0]}` : ""} 👋</h1>
        <button className="link" onClick={() => navigate("/profile")}>
          הפרטים שלי
        </button>
      </header>

      <section className="card new-claim">
        <h2>תביעה חדשה</h2>
        <p className="muted">ספרו איזה טיפול עשיתם ואיזה ביטוח יש לכם, בכתב או בהקלטה 🎤. למשל: "היה לי טיפול שורש בכללית סמייל, יש לי ביטוח שיניים בהראל".</p>
        {busy ? (
          <p className="working">הסוכן מתחיל לעבוד על התביעה…</p>
        ) : (
          <Composer placeholder="מה היה הטיפול?" busy={busy} onSend={startClaim} />
        )}
      </section>

      {tasks.length > 0 && (
        <section>
          <h2>📋 מחכה לך ({tasks.length})</h2>
          <ul className="list">
            {tasks.map((t) => (
              <li key={t.id} className="card row" onClick={() => navigate(`/claims/${t.claim_id}`)}>
                <div>
                  <strong>{t.title}</strong>
                  <div className="muted small">{t.claim_title}</div>
                </div>
                <span className="chevron">‹</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {claims.length > 0 && (
        <section>
          <h2>התביעות שלי</h2>
          <ul className="list">
            {claims.map((c) => (
              <li key={c.id} className="card row" onClick={() => navigate(`/claims/${c.id}`)}>
                <div className="grow">
                  <strong>{c.title ?? "תביעה"}</strong>
                  <div className="muted small">
                    {STATUS_LABEL[c.status]}
                    {c.open_tasks > 0 && ` · ⚠️ ממתין לך: ${c.open_tasks}`}
                  </div>
                  {c.total > 0 && <Progress done={c.done} total={c.total} />}
                </div>
                <span className="chevron">‹</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Disclaimer />
    </main>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="progress" aria-label={`${done} מתוך ${total}`}>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
      </div>
      <span className="small muted">
        {done}/{total}
      </span>
    </div>
  );
}
