import { useState } from "react";
import { signOut } from "firebase/auth";
import { api, errorMessage } from "../api";
import { auth } from "../firebase";
import { navigate } from "../App";
import { Disclaimer } from "../components/Disclaimer";
import type { FamilyMember, User } from "../types";

const FIELDS: { key: "full_name" | "id_number" | "phone" | "bank_details"; label: string; ltr?: boolean }[] = [
  { key: "full_name", label: "שם מלא" },
  { key: "id_number", label: "תעודת זהות", ltr: true },
  { key: "phone", label: "טלפון", ltr: true },
  { key: "bank_details", label: "חשבון בנק להחזרים (בנק, סניף, חשבון)" },
];

const EMPTY_MEMBER: FamilyMember = { name: "", id_number: "", relation: "" };

const HAR_HABITUACH_URL = "https://harb.cma.gov.il";

/** The user's policies from the Har HaBituach report, so the agent knows which insurer and policy to use. */
function Policies({ user, onChange }: { user: User; onChange: (u: User) => void }) {
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const policies = user.policies ?? [];
  const shown = showAll ? policies : policies.filter((p) => p.claimable);

  async function upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    try {
      onChange(await api.uploadPolicies(file));
    } catch (err) {
      alert(errorMessage(err, "קריאת הקובץ נכשלה. אפשר לנסות שוב."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("למחוק את רשימת הביטוחים?")) return;
    onChange(await api.deletePolicies());
  }

  return (
    <section className="card policies">
      <h3>הביטוחים שלי</h3>
      {policies.length === 0 ? (
        <>
          <p className="small">
            כדי שהעוזר ידע אילו ביטוחי בריאות יש לכם ובאיזו חברה, אפשר להעלות את רשימת הפוליסות מ<strong>הר הביטוח</strong>, האתר של משרד האוצר.
          </p>
          <ol className="small policies-steps">
            <li>
              נכנסים ל
              <a href={HAR_HABITUACH_URL} target="_blank" rel="noreferrer">
                אתר הר הביטוח
              </a>{" "}
              ומזדהים.
            </li>
            <li>מורידים את קובץ הפוליסות (אקסל), או מצלמים את המסך עם הרשימה.</li>
            <li>מעלים אותו כאן.</li>
          </ol>
        </>
      ) : (
        <>
          <ul className="policy-list">
            {shown.map((p, i) => (
              <li key={i}>
                <strong>{p.insurer}</strong> · {p.branch}
                {p.policy_number && (
                  <div className="muted small">
                    פוליסה <bdi className="nowrap">{p.policy_number}</bdi>
                  </div>
                )}
              </li>
            ))}
            {shown.length === 0 && <li className="muted small">אין ברשימה ביטוחי בריאות או שיניים.</li>}
          </ul>
          {policies.length > shown.length || showAll ? (
            <button className="link small" onClick={() => setShowAll(!showAll)}>
              {showAll ? "רק ביטוחי בריאות" : `הצג את כל ${policies.length} הפוליסות`}
            </button>
          ) : null}
          <p className="small muted">ביטוח משלים של קופת החולים לא מופיע בהר הביטוח.</p>
        </>
      )}
      <p className="small muted">הקובץ עצמו לא נשמר: נשמרת רק רשימת הפוליסות שנקראה ממנו.</p>
      <div className="btn-row">
        <label className={`button${policies.length === 0 ? " primary" : ""}`}>
          {busy ? "קורא את הקובץ…" : policies.length === 0 ? "העלאת קובץ מהר הביטוח" : "עדכון מקובץ חדש"}
          <input type="file" accept=".xlsx,.xls,.csv,image/*,application/pdf" hidden disabled={busy} onChange={(e) => upload(e.target)} />
        </label>
        {policies.length > 0 && (
          <button className="link small" onClick={remove}>
            מחיקה
          </button>
        )}
      </div>
    </section>
  );
}

export function Profile({ user, onChange }: { user: User; onChange: (u: User) => void }) {
  const [form, setForm] = useState(user);
  const [family, setFamily] = useState<FamilyMember[]>(user.family ?? []);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      onChange(
        await api.updateMe({
          full_name: form.full_name,
          id_number: form.id_number,
          phone: form.phone,
          bank_details: form.bank_details,
          family: family
            .filter((m) => m.name.trim())
            .map((m) => ({ name: m.name.trim(), id_number: m.id_number?.trim() || null, relation: m.relation?.trim() || null })),
        }),
      );
      setSaved(true);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  function editMember(i: number, patch: Partial<FamilyMember>) {
    setSaved(false);
    setFamily(family.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  async function deleteAccount() {
    if (!confirm("למחוק את החשבון, כל התיקים וכל המסמכים? אי אפשר לבטל את זה.")) return;
    setDeleting(true);
    try {
      await api.deleteAccount();
      await signOut(auth);
      navigate("/");
    } catch (err) {
      alert(errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <button className="icon-btn" onClick={() => navigate("/")} aria-label="חזרה">
          →
        </button>
        <h1 className="grow">הפרטים שלי</h1>
      </header>
      <form className="card" onSubmit={save}>
        <p className="muted small">הפרטים משמשים למילוי הדף המקדים לתביעה. הסוכן יבקש מה שחסר כשצריך.</p>
        <label>
          אימייל
          <input value={user.email} disabled dir="ltr" />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              value={form[f.key] ?? ""}
              dir={f.ltr ? "ltr" : undefined}
              onChange={(e) => {
                setSaved(false);
                setForm({ ...form, [f.key]: e.target.value });
              }}
            />
          </label>
        ))}

        <h3>בני משפחה</h3>
        <p className="muted small">לתביעות על טיפולים של ילדים או בן/בת זוג. הסוכן ישמור כאן גם בני משפחה שתספרו לו עליהם.</p>
        {family.map((m, i) => (
          <div key={i} className="family-row">
            <input placeholder="שם" value={m.name} onChange={(e) => editMember(i, { name: e.target.value })} />
            <input placeholder="ת״ז" dir="ltr" value={m.id_number ?? ""} onChange={(e) => editMember(i, { id_number: e.target.value })} />
            <input placeholder="קרבה" value={m.relation ?? ""} onChange={(e) => editMember(i, { relation: e.target.value })} />
            <button type="button" className="icon-btn" aria-label="הסר" onClick={() => (setSaved(false), setFamily(family.filter((_, j) => j !== i)))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setFamily([...family, { ...EMPTY_MEMBER }])}>
          + הוספת בן/בת משפחה
        </button>

        <button className="primary wide">{saved ? "נשמר ✓" : "שמירה"}</button>
      </form>

      <Policies user={user} onChange={onChange} />

      {user.is_admin && (
        <button className="link" onClick={() => navigate("/admin")}>
          📊 מסך ניהול
        </button>
      )}
      <button className="link" onClick={() => signOut(auth)}>
        התנתקות
      </button>

      <section className="danger-zone">
        <h3>מחיקת החשבון</h3>
        <p className="small muted">מוחק את החשבון, כל התיקים, הפרטים ששמרת והמסמכים השמורים במכשיר הזה.</p>
        <button onClick={deleteAccount} disabled={deleting}>
          {deleting ? "מוחק…" : "מחיקת החשבון וכל המידע"}
        </button>
      </section>
      <Disclaimer />
    </main>
  );
}
