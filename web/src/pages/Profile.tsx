import { useState } from "react";
import { api } from "../api";
import { navigate } from "../App";
import type { User } from "../types";

const FIELDS: { key: keyof User; label: string; ltr?: boolean }[] = [
  { key: "full_name", label: "שם מלא" },
  { key: "id_number", label: "תעודת זהות", ltr: true },
  { key: "phone", label: "טלפון", ltr: true },
  { key: "bank_details", label: "חשבון בנק להחזרים (בנק, סניף, חשבון)" },
];

export function Profile({ user, onChange, onLogout }: { user: User; onChange: (u: User) => void; onLogout: () => void }) {
  const [form, setForm] = useState(user);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onChange(
      await api.updateMe({
        full_name: form.full_name,
        id_number: form.id_number,
        phone: form.phone,
        bank_details: form.bank_details,
      }),
    );
    setSaved(true);
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
        <p className="muted small">הפרטים משמשים למילוי טופסי התביעה. הסוכן יבקש מה שחסר כשצריך.</p>
        <label>
          אימייל
          <input value={user.email} disabled dir="ltr" />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              value={(form[f.key] as string | null) ?? ""}
              dir={f.ltr ? "ltr" : undefined}
              onChange={(e) => {
                setSaved(false);
                setForm({ ...form, [f.key]: e.target.value });
              }}
            />
          </label>
        ))}
        <button className="primary">{saved ? "נשמר ✓" : "שמירה"}</button>
      </form>
      <button
        className="link"
        onClick={async () => {
          await api.logout();
          onLogout();
        }}
      >
        התנתקות
      </button>
    </main>
  );
}
