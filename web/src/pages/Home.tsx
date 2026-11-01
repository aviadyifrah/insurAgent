import { useEffect, useState } from "react";
import { api, ApiError, errorMessage, pendingFirstMessage } from "../api";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { navigate } from "../App";
import { Disclaimer } from "../components/Disclaimer";
import { Composer } from "../components/Composer";
import type { ClaimSummary, User } from "../types";

const STATUS_LABEL: Record<ClaimSummary["status"], string> = {
  collecting: "אוסף מסמכים",
  ready: "מוכן להגשה",
  submitted: "הוגש",
};

const OUTCOME_LABEL: Record<NonNullable<ClaimSummary["outcome"]>, string> = {
  approved: "✅ אושרה",
  partial: "🟡 אושרה חלקית",
  rejected: "❌ נדחתה",
  docs_requested: "📄 ביקשו עוד מסמכים",
};

export function Home({ user }: { user: User }) {
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const tasks = (claims ?? []).flatMap((c) => c.open_task_list.map((t) => ({ ...t, claim_title: c.title })));
  const atLimit = limitHit || (claims !== null && claims.length >= user.claim_limit);

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
    } catch (err) {
      if (err instanceof ApiError && err.message === "claim_limit") setLimitHit(true);
      else alert(errorMessage(err));
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

      {claims === null ? null : atLimit ? (
        <section className="card limit-card">
          <h2>רוצים לפתוח תיק נוסף?</h2>
          <p className="muted">
            זו גרסת ניסיון, ואפשר לפתוח בה {user.claim_limit === 1 ? "תיק אחד" : `${user.claim_limit} תיקים`}. לתיקים נוספים, לעזרה מעבר
            למה שהאפליקציה עושה או לכל שאלה, דברו איתנו.
          </p>
          <WhatsAppButton message="שלום, אשמח לפתוח תיק נוסף ב-InsurAgent." />
        </section>
      ) : (
        <section className="card new-claim">
          <h2>תביעה חדשה</h2>
          <p className="muted">ספרו איזה טיפול עשיתם ואיזה ביטוח יש לכם, בכתב או בהקלטה 🎤. למשל: "היה לי טיפול שורש בכללית סמייל, יש לי ביטוח שיניים בהראל".</p>
          {busy ? (
            <p className="working">הסוכן מתחיל לעבוד על התביעה…</p>
          ) : (
            <Composer placeholder="מה היה הטיפול?" busy={busy} onSend={startClaim} />
          )}
        </section>
      )}

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

      {claims && claims.length > 0 && (
        <section>
          <h2>התביעות שלי</h2>
          <ul className="list">
            {claims.map((c) => (
              <li key={c.id} className="card row" onClick={() => navigate(`/claims/${c.id}`)}>
                <div className="grow">
                  <strong>{c.title ?? "תביעה"}</strong>
                  <div className="muted small">
                    {c.outcome
                      ? OUTCOME_LABEL[c.outcome] + (c.outcome_amount != null ? ` · ${c.outcome_amount.toLocaleString("he-IL")} ₪` : "")
                      : STATUS_LABEL[c.status]}
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
