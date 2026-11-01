import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { navigate } from "../App";
import type { AdminOverview } from "../types";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("he-IL") : "—");

/** For the team: usage, cost and outcomes, and raising a user's claim limit. */
export function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  const load = () => api.adminOverview().then(setData).catch((err) => setError(errorMessage(err, "אין הרשאה למסך הזה.")));
  useEffect(() => {
    load();
  }, []);

  async function setLimit(uid: string, current: number) {
    const answer = prompt("כמה תיקים מותר למשתמש לפתוח?", String(current));
    if (answer === null) return;
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 0) return alert("צריך מספר שלם");
    await api.adminSetLimit(uid, n);
    load();
  }

  return (
    <main className="page admin">
      <header className="topbar">
        <button className="icon-btn" onClick={() => navigate("/profile")} aria-label="חזרה">
          →
        </button>
        <h1 className="grow">מסך ניהול</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <section className="tiles">
            <Tile label="משתמשים" value={data.totals.users} />
            <Tile label="תיקים" value={data.totals.claims} />
            <Tile label="הוגשו" value={data.totals.submitted} />
            <Tile label="עם תשובה" value={data.totals.with_outcome} />
            <Tile label="עלות מודל כוללת" value={usd(data.totals.cost_usd)} />
            <Tile label="עלות ממוצעת לתיק" value={usd(data.totals.avg_cost_per_claim)} />
            <Tile label="הודעות היום" value={data.totals.today_messages} />
            <Tile label="העלאות היום" value={data.totals.today_uploads} />
          </section>

          <h2>בקשות להוספה</h2>
          {data.requests.length === 0 ? (
            <p className="muted small">אין בקשות.</p>
          ) : (
            <ul className="list">
              {data.requests.map((r) => (
                <li key={r.id} className="card">
                  <strong>{r.kind === "missing_template" ? "חסרה רשימה" : "מסמך שמשתמש הוסיף"}</strong>
                  <span className="muted small">
                    {" "}
                    · {r.insurer ?? "חברה לא ידועה"} · {r.claim_type ?? "—"}
                  </span>
                  <div>{r.details}</div>
                  <div className="small muted">
                    <span dir="ltr">{r.user_email}</span> · {day(r.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>משתמשים</h2>
          <ul className="list">
            {data.users.map((u) => (
              <li key={u.id} className="card admin-user">
                <div className="grow">
                  <strong dir="ltr">{u.email}</strong>
                  {u.full_name && <span className="muted small"> · {u.full_name}</span>}
                  <div className="small muted">
                    {u.claims} תיקים · {u.submitted} הוגשו
                    {u.approved_total > 0 && ` · אושר ${u.approved_total.toLocaleString("he-IL")} ₪`} · עלות {usd(u.cost_usd)}
                  </div>
                  <div className="small muted">
                    נרשם {day(u.created_at)} · פעילות אחרונה {day(u.last_activity)}
                  </div>
                </div>
                <button onClick={() => setLimit(u.id, u.claim_limit)}>מגבלה: {u.claim_limit}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
