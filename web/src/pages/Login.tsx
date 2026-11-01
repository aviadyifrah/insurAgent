import { useRef, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase";
import { SUPPORTED } from "@insuragent/shared/supported";
import { WhatsAppButton } from "../components/WhatsAppButton";

const STEPS = [
  { icon: "💬", title: "מספרים מה היה", text: "איזה טיפול עשיתם, איפה ואיזה ביטוח יש לכם. במילים שלכם, כמו בצ'אט." },
  { icon: "📎", title: "מעלים מה שיש", text: "קבלה, סיכום טיפול או צילום מהטלפון. העוזר בודק שהמסמך מתאים ומשייך אותו לתיק." },
  { icon: "✍️", title: "העוזר משלים את החסר", text: "טופס תביעה ממולא לחתימה באצבע, ומייל מוכן למרפאה כשחסר מהם מסמך." },
  { icon: "📦", title: "מגישים בעצמכם", text: "מורידים קובץ PDF אחד עם כל המסמכים, ומגישים באזור האישי של חברת הביטוח." },
];

const VS_GENERIC_CHAT = [
  { icon: "🗂️", title: "כל התביעות במקום אחד", text: "רואים בכל רגע מה הוגש, מה מוכן ומה עוד חסר, בכל תביעה." },
  { icon: "👤", title: "זוכר את הפרטים שלכם", text: "שם, תעודת זהות וחשבון בנק נשמרים פעם אחת, וכל טופס חדש ממולא לבד." },
  { icon: "📁", title: "המסמכים מסודרים", text: "כל קבלה משויכת לתביעה הנכונה, ותעודת זהות ואישור בנק נשמרים לפעם הבאה." },
  { icon: "🔍", title: "בודק כל מסמך", text: "יודע מה בדרך כלל נדרש לכל סוג טיפול, ובודק שהמסמך על השם הנכון, מהמרפאה הנכונה ועם הסכום." },
  { icon: "📦", title: "תוצר מוכן, לא רק עצות", text: "טופס ממולא לחתימה, מיילים מוכנים למרפאה וקובץ PDF אחד מוכן להגשה." },
  { icon: "⏰", title: "לא שוכחים כלום", text: "משימות פתוחות ותזכורות ליומן, עד שהתיק סגור." },
];

// Must stay consistent with the privacy section of the terms (Legal.tsx): files live on the device,
// and are sent once to the AI provider to be read, without being kept on our server.
const PRIVACY = [
  { icon: "📱", title: "נשמרים רק בטלפון שלכם", text: "הקבלות, הסיכומים והחתימה נשמרים במכשיר שלכם בלבד, לא בשרת שלנו ולא בענן." },
  { icon: "🚫", title: "לא נמסרים לאחרים", text: "לא לחברות ביטוח, לא למפרסמים ולא לשום גורם אחר. לא מוכרים מידע ולא משתמשים בו לפרסום." },
  { icon: "🔍", title: "נקראים רק כדי לבדוק אותם", text: "בהעלאה המסמך נשלח פעם אחת לקריאה אוטומטית במודל AI, ולא נשמר אצלנו." },
];

const PRINCIPLES = [
  { icon: "📋", title: "רק מה שצריך", text: "לא מבקשים מסמכים מיותרים: רק מה שחברת הביטוח שלכם דורשת." },
  { icon: "🙋", title: "אתם מגישים", text: "אנחנו כלי עזר בלבד: לא מגישים, לא שולחים ולא מייצגים בשמכם." },
  { icon: "🤝", title: "בלי הבטחות", text: "לא מעריכים סכומים ולא קובעים מה מכוסה. את זה מחליטה חברת הביטוח." },
];

function SignInButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button className="primary google cta" onClick={onClick} disabled={busy}>
      <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? "מתחבר…" : "התחברות עם Google"}
    </button>
  );
}

// Example claims for the landing carousel. Items follow the real templates in server/knowledge.
const EXAMPLES: { title: string; done: number; items: { text: string; state?: "pending" | "action" }[] }[] = [
  {
    title: "🦷 טיפול שורש · מנורה מבטחים",
    done: 1,
    items: [
      { text: "✅ קבלה מהמרפאה" },
      { text: "⏳ צילומים אבחנתיים: נשלחה בקשה למרפאה", state: "pending" },
      { text: "✍️ טופס התביעה: נשאר למלא באתר מנורה", state: "action" },
    ],
  },
  {
    title: "🦷 כתר · מגדל",
    done: 2,
    items: [
      { text: "✅ העתק קבלות" },
      { text: "✅ טופס 167, חלק המבוטח" },
      { text: "✉️ חלק הרופא: מייל מוכן לשליחה למרפאה", state: "action" },
    ],
  },
  {
    title: "🩺 ייעוץ אורתופד לבת · מכבי שלי",
    done: 3,
    items: [
      { text: "✅ קבלה" },
      { text: "✅ סיכום ביקור" },
      { text: "📦 התיק מוכן: מורידים PDF ומגישים", state: "action" },
    ],
  },
];

/** Static previews of claims in progress, swiped sideways, so visitors see what they get before signing in. */
function ClaimExamples() {
  const [current, setCurrent] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  function onScroll() {
    const el = track.current;
    if (!el) return;
    // RTL scrollLeft runs from 0 to negative; the absolute value works either way.
    const step = (el.scrollWidth - el.clientWidth) / (EXAMPLES.length - 1);
    setCurrent(step > 0 ? Math.round(Math.abs(el.scrollLeft) / step) : 0);
  }

  function go(i: number) {
    const card = track.current?.children[i] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  return (
    <div className="examples">
      <div className="examples-track" ref={track} onScroll={onScroll}>
        {EXAMPLES.map((ex) => {
          const total = ex.items.length;
          return (
            <div key={ex.title} className="preview" aria-label={ex.title}>
              <div className="preview-head">
                <strong>{ex.title}</strong>
                <span className="preview-badge">{ex.done === total ? "מוכן להגשה" : `${ex.done} מתוך ${total}`}</span>
              </div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${(ex.done / total) * 100}%` }} />
              </div>
              <ul>
                {ex.items.map((it) => (
                  <li key={it.text} className={it.state}>
                    {it.text}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="examples-dots">
        {EXAMPLES.map((ex, i) => (
          <button key={ex.title} className={i === current ? "active" : ""} onClick={() => go(i)} aria-label={`דוגמה ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

export function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      setError("ההתחברות לא הושלמה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="landing">
      <section className="hero">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>InsurAgent</span>
        </div>
        <p className="trial-badge">גרסת ניסיון · תיק אחד ללא עלות</p>
        <h1>
          החזרי ביטוח בריאות,
          <br />
          <span className="accent">בלי הבירוקרטיה</span>
        </h1>
        <p className="hero-text">
          ספרו איזה טיפול עשיתם. העוזר יבנה את רשימת המסמכים, ימלא את הטופס ויכין מיילים למרפאה, עד שהתיק מוכן להגשה.
        </p>
        <SignInButton onClick={signIn} busy={busy} />
        {error && <p className="error">{error}</p>}
        <p className="hero-note">כניסה עם חשבון Google, בלי סיסמה חדשה</p>
        <p className="hero-privacy">🔒 המסמכים שלכם נשמרים רק בטלפון שלכם</p>
        <ClaimExamples />
      </section>

      <section className="landing-section privacy">
        <h2>🔒 המסמכים שלכם נשארים שלכם</h2>
        <div className="privacy-points">
          {PRIVACY.map((p) => (
            <div key={p.title} className="privacy-point">
              <span className="benefit-icon">{p.icon}</span>
              <div>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="fits">
          כל הפרטים ב<a href="#/legal">תנאי השימוש והפרטיות</a>.
        </p>
      </section>

      <section className="landing-section">
        <h2>איך זה עובד</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-icon">{s.icon}</span>
              <div>
                <h3>
                  <span className="step-num">{i + 1}</span> {s.title}
                </h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <h2>מה העוזר מכיר</h2>
        <p className="section-lead">תביעות שיש לעוזר רשימת מסמכים מוכנה עבורן, לפי הטפסים של חברות הביטוח.</p>
        <div className="supported">
          {SUPPORTED.map((g) => (
            <div key={g.title} className="supported-group">
              <h3>{g.title}</h3>
              <ul>
                {g.insurers.map((i) => (
                  <li key={i.key}>{i.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="fits">
          חסרה החברה או סוג התביעה שלכם? העוזר יגיד שהוא עוד לא מכיר, ונוסיף אותם. תמיד הפוליסה שלכם היא הקובעת.
        </p>
      </section>

      <section className="landing-section">
        <h2>למה לא פשוט לשאול צ'אט AI?</h2>
        <p className="section-lead">צ'אט כללי יכול להסביר מה לעשות. כאן העבודה נעשית, ונשמרת לפעם הבאה.</p>
        <div className="benefits">
          {VS_GENERIC_CHAT.map((b) => (
            <div key={b.title} className="benefit">
              <span className="benefit-icon">{b.icon}</span>
              <div>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>מה חשוב לדעת</h2>
        <div className="principles">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="principle">
              <span className="principle-icon">{p.icon}</span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section final-cta">
        <h2>יש לכם קבלה שמחכה במגירה?</h2>
        <SignInButton onClick={signIn} busy={busy} />
      </section>

      <section className="landing-section trial-section">
        <h2>גרסת ניסיון</h2>
        <p>
          בשלב הזה כל משתמש יכול לפתוח תיק אחד ללא עלות. צריכים יותר תיקים, עזרה מעבר למה שהאפליקציה עושה, או שיש לכם שאלה? דברו
          איתנו.
        </p>
        <WhatsAppButton message="שלום, ראיתי את InsurAgent ויש לי שאלה:" />
      </section>

      <footer className="landing-footer">
        <p>גרסת ניסיון. InsurAgent הוא כלי עזר להכנת מסמכים. אינו סוכן ביטוח, אינו מייעץ ואינו מגיש תביעות בשמכם.</p>
        <a href="#/legal">תנאי שימוש ופרטיות</a>
      </footer>
    </main>
  );
}
