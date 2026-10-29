import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { api, ApiError } from "../api";
import { auth } from "../firebase";
import type { User } from "../types";

/** First sign-in (or new terms version): accept the terms, and enter the access code if required. */
export function Consent({ email, onDone }: { email: string; onDone: (u: User) => void }) {
  const [consent, setConsent] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.config().then((c) => setCodeRequired(c.access_code_required)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) return setError("כדי להמשיך יש לאשר את תנאי השימוש ומדיניות הפרטיות.");
    setBusy(true);
    setError("");
    try {
      onDone(await api.consent(accessCode));
    } catch (err) {
      setError(err instanceof ApiError && err.message === "bad_access_code" ? "קוד הגישה שגוי." : "משהו השתבש. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <img src="/icon.svg" alt="" className="login-logo" />
      <h1>כמעט סיימנו</h1>
      <p className="lead">מחובר/ת כ-{email}</p>
      <form onSubmit={submit} className="card">
        {codeRequired && (
          <label>
            קוד גישה
            <input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} dir="ltr" autoComplete="off" required />
          </label>
        )}
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            קראתי ואני מסכים/ה ל<a href="#/legal">תנאי השימוש ולמדיניות הפרטיות</a>, כולל עיבוד המסמכים שאעלה באמצעות שירות בינה
            מלאכותית של ספק חיצוני.
          </span>
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "רגע…" : "המשך"}
        </button>
        {error && <p className="error">{error}</p>}
        <button type="button" className="link" onClick={() => signOut(auth)}>
          התחברות עם חשבון אחר
        </button>
      </form>
    </main>
  );
}
