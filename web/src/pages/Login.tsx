import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase";

export function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      setError("ההתחברות לא הושלמה. נסה שוב.");
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
      <div className="card">
        <button className="primary google" onClick={signIn} disabled={busy}>
          {busy ? "מתחבר…" : "התחברות עם Google"}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          <a href="#/legal">תנאי שימוש ופרטיות</a>
        </p>
      </div>
    </main>
  );
}
