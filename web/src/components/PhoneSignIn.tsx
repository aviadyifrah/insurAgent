import { useEffect, useRef, useState } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";
import { auth } from "../firebase";
import { Modal } from "./TaskCard";

/** 050-1234567 / 0501234567 / +972 50 123 4567 → +972501234567, or null if it isn't an Israeli mobile. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("972") ? digits.slice(3) : digits.replace(/^0/, "");
  return /^5\d{8}$/.test(local) ? `+972${local}` : null;
}

function errorText(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  const message = String((err as { message?: string }).message ?? "");
  // Our daily SMS caps (server/src/smsGuard.ts) reject the request before the SMS goes out.
  if (message.includes("number_limit")) return "נשלחו היום יותר מדי קודים למספר הזה. אפשר לנסות שוב מחר, או להיכנס עם Google.";
  if (message.includes("daily_limit") || message.includes("BLOCKING_FUNCTION")) return "הכניסה עם SMS עמוסה כרגע. אפשר להיכנס עם Google, או לנסות שוב מחר.";
  if (code === "auth/invalid-phone-number") return "המספר לא תקין. צריך מספר נייד ישראלי, למשל 050-1234567.";
  if (code === "auth/invalid-verification-code") return "הקוד לא נכון. אפשר לבדוק ולנסות שוב.";
  if (code === "auth/code-expired") return "הקוד פג תוקף. אפשר לשלוח קוד חדש.";
  if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") return "יותר מדי ניסיונות. אפשר לנסות שוב מאוחר יותר.";
  if (code === "auth/operation-not-allowed") return "הכניסה עם טלפון עוד לא פעילה. בינתיים אפשר להיכנס עם Google.";
  // Google's SMS service declined to send (anti-abuse limits or the region); not something the user can fix.
  if (code.includes("-39") || message.includes("-39"))
    return "לא הצלחנו לשלוח SMS כרגע. אפשר להיכנס עם Google, או לנסות שוב מאוחר יותר.";
  if (code === "auth/unauthorized-domain") return "האתר הזה עוד לא מורשה לכניסה עם טלפון. בינתיים אפשר להיכנס עם Google.";
  if (code === "auth/invalid-app-credential" || code === "auth/captcha-check-failed")
    return "בדיקת האבטחה של Google לא עברה. אפשר לרענן את הדף ולנסות שוב.";
  if (code === "auth/billing-not-enabled") return "שליחת SMS עוד לא הופעלה בחשבון. בינתיים אפשר להיכנס עם Google.";
  if (code === "auth/missing-phone-number" || code === "auth/invalid-phone-number") return "המספר לא תקין.";
  console.error("phone sign-in failed", err);
  // The code helps us tell what went wrong when someone reports it.
  return `הכניסה לא הצליחה. אפשר לנסות שוב. (קוד: ${code || "לא ידוע"})`;
}

/** Sign-in with an Israeli mobile number and a one-time SMS code. */
export function PhoneSignIn({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => verifier.current?.clear(), []);
  useEffect(() => {
    if (sent) codeInput.current?.focus();
  }, [sent]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const number = toE164(phone);
    if (!number) return setError("צריך מספר נייד ישראלי, למשל 050-1234567.");
    setBusy(true);
    setError("");
    try {
      // Invisible bot check; Google shows a challenge only when it's unsure.
      verifier.current ??= new RecaptchaVerifier(auth, "phone-recaptcha", { size: "invisible" });
      auth.languageCode = "he";
      setSent(await signInWithPhoneNumber(auth, number, verifier.current));
    } catch (err) {
      setError(errorText(err));
      verifier.current?.clear();
      verifier.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!sent) return;
    setBusy(true);
    setError("");
    try {
      await sent.confirm(code.trim());
      // Signed in: the app moves on by itself.
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="כניסה עם מספר טלפון" onClose={onClose}>
      {!sent ? (
        <form onSubmit={sendCode} className="phone-signin">
          <p className="small muted">נשלח אליך קוד חד-פעמי ב-SMS.</p>
          <label>
            מספר נייד
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="050-1234567"
              autoFocus
            />
          </label>
          {error && <p className="small error">{error}</p>}
          <button className="primary wide" disabled={busy || !phone.trim()}>
            {busy ? "שולח…" : "שליחת קוד"}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="phone-signin">
          <p className="small muted">
            שלחנו קוד ל-<bdi className="nowrap" dir="ltr">{phone}</bdi>{" "}
            <button type="button" className="link small" onClick={() => (setSent(null), setCode(""), setError(""))}>
              שינוי מספר
            </button>
          </p>
          <label>
            הקוד מה-SMS
            <input
              ref={codeInput}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
            />
          </label>
          {error && <p className="small error">{error}</p>}
          <button className="primary wide" disabled={busy || code.length < 6}>
            {busy ? "בודק…" : "כניסה"}
          </button>
        </form>
      )}
      <div id="phone-recaptcha" />
    </Modal>
  );
}
