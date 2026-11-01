import { navigate } from "../App";
import { SUPPORT_PHONE_DISPLAY, whatsappLink } from "../support";

/** Placeholder terms & privacy summary. The final text comes from legal review. */
export function Legal() {
  return (
    <main className="page legal">
      <header className="topbar">
        <button className="icon-btn" onClick={() => history.length > 1 ? history.back() : navigate("/")} aria-label="חזרה">
          →
        </button>
        <h1 className="grow">תנאי שימוש ופרטיות</h1>
      </header>

      <p className="draft-banner">גרסת ניסיון. הנוסח הוא טיוטה לצורך הדגמה, והנוסח הסופי ייקבע לאחר בדיקה משפטית.</p>

      <section className="card">
        <h2>מה השירות עושה</h2>
        <ul>
          <li>InsurAgent הוא כלי עזר להכנת מסמכים לתביעת החזר הוצאות רפואיות, בגרסת ניסיון. בשלב זה כל משתמש יכול לפתוח תיק אחד ללא עלות.</li>
          <li>השירות אינו סוכן ביטוח, אינו משרד עורכי דין ואינו מייצג אותך מול חברת הביטוח או כל גורם אחר.</li>
          <li>השירות אינו מגיש תביעות ואינו שולח מיילים בשמך. ההגשה והשליחה נעשות על ידך בלבד.</li>
          <li>השירות אינו מעריך את סכום ההחזר ואינו קובע אם טיפול מכוסה. ההחלטה היא של חברת הביטוח לפי הפוליסה שלך.</li>
          <li>רשימות המסמכים מבוססות על מידע כללי ועשויות להיות חלקיות. האחריות לבדוק את התיק לפני ההגשה היא שלך.</li>
        </ul>
      </section>

      <section className="card">
        <h2>איפה המידע שלך נשמר</h2>
        <ul>
          <li>
            <strong>המסמכים עצמם</strong> (קבלות, סיכומים, ת"ז, חתימה) נשמרים במכשיר שלך בלבד. מחיקת נתוני הדפדפן או החלפת מכשיר תמחק
            אותם.
          </li>
          <li>
            <strong>בעת העלאה</strong> המסמך נשלח פעם אחת לשרת ולשירות בינה מלאכותית של ספק חיצוני (Anthropic, ארה"ב) לצורך קריאתו.
            הקובץ עצמו אינו נשמר בשרת שלנו.
          </li>
          <li>
            <strong>הקלטה קולית</strong> (כפתור המיקרופון) מתומללת לטקסט על ידי שירות הדיבור של הדפדפן שלך (למשל Google או Apple).
            אנחנו מקבלים רק את הטקסט ששלחת, לא את ההקלטה.
          </li>
          <li>
            <strong>בשרת נשמרים</strong>: פרטי הפרופיל שמסרת, פרטי התביעה, הפרטים שחולצו מהמסמכים (כגון ספק, תאריך וסכום), ההתכתבות
            עם העוזר וסטטוס המשימות.
          </li>
          <li>
            ניתן לבקש מחיקה של כל המידע עליך בוואטסאפ:{" "}
            <a href={whatsappLink("שלום, אבקש למחוק את המידע שלי מ-InsurAgent.")} target="_blank" rel="noreferrer" dir="ltr">
              {SUPPORT_PHONE_DISPLAY}
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
