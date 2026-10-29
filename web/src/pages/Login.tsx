import { useState } from "react";
import { api, ApiError } from "../api";
import type { User } from "../types";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api.login(email, consent));
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === "consent_required"
          ? "כדי להמשיך יש לאשר את תנאי השימוש ומדיניות הפרטיות."
          : "לא הצלחנו להתחבר. בדוק את כתובת המייל.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <img src="/icon.svg" alt="" className="login-logo" />
      <h1>InsurAgent</h1>
      <p className="lead">
        כלי עזר להכנת תביעות להחזר הוצאות רפואיות. ספר איזה טיפול עשית, ונעזור לך לאסוף את המסמכים, למלא את הטופס ולהכין הכול
        להגשה. את התביעה מגישים בעצמכם.
      </p>
      <form onSubmit={submit} className="card">
        <label>
          אימייל
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" />
        </label>
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            קראתי ואני מסכים/ה ל<a href="#/legal">תנאי השימוש ולמדיניות הפרטיות</a>, כולל עיבוד המסמכים שאעלה באמצעות שירות בינה
            מלאכותית של ספק חיצוני.
          </span>
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "מתחבר…" : "כניסה"}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="hint">כניסת פיתוח. בהמשך: התחברות עם Google או קוד ב-SMS.</p>
      </form>
    </main>
  );
}
