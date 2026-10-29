import { useState } from "react";
import { api } from "../api";
import type { User } from "../types";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api.login(email));
    } catch {
      setError("לא הצלחנו להתחבר. בדוק את כתובת המייל.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <img src="/icon.svg" alt="" className="login-logo" />
      <h1>InsurAgent</h1>
      <p className="lead">ספר לי איזה טיפול עשית. אני אדאג לכל השאר: מסמכים, טפסים ומיילים, עד שהתביעה מוכנה להגשה.</p>
      <form onSubmit={submit} className="card">
        <label>
          אימייל
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" />
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
