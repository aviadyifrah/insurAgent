import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { enablePush, PushError, pushState, type PushState } from "../push";
import type { Reminder } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
/** UTC timestamp in the compact form calendar links and .ics files use: 20261105T070000Z */
const compact = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

function span(r: Reminder) {
  const start = new Date(r.due_at);
  return [compact(start), compact(new Date(start.getTime() + 30 * 60 * 1000))] as const;
}

function description(r: Reminder) {
  return [r.details, `התביעה באפליקציה: ${window.location.origin}/#/claims/${r.claim_id}`].filter(Boolean).join("\n");
}

function googleCalendarUrl(r: Reminder) {
  const [start, end] = span(r);
  const params = new URLSearchParams({ action: "TEMPLATE", text: r.title, dates: `${start}/${end}`, details: description(r) });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** An .ics file, which iPhone (and most calendar apps) open as "add event". */
function downloadIcs(r: Reminder) {
  const [start, end] = span(r);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//InsurAgent//HE",
    "BEGIN:VEVENT",
    `UID:${r.id}@insuragent`,
    `DTSTAMP:${compact(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(r.title)}`,
    `DESCRIPTION:${esc(description(r))}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(r.title)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "reminder.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const reminderDay = (r: Reminder) =>
  new Date(r.due_at).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });

// Whether the server offers WhatsApp reminders; asked once per visit.
let whatsappOffered: Promise<boolean> | null = null;
function useWhatsappOffered() {
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    whatsappOffered ??= api
      .config()
      .then((c) => !!c.whatsapp_reminders)
      .catch(() => false);
    whatsappOffered.then(setOffered);
  }, []);
  return offered;
}

interface Props {
  reminder: Reminder;
  /** The user's saved phone, to fill in the WhatsApp number. */
  phone: string | null;
  onChoice: (status: "added" | "dismissed") => void;
}

/** A suggested reminder: one tap adds it to the phone's calendar, or schedules it on WhatsApp. */
export function ReminderCard({ reminder: r, phone, onChoice }: Props) {
  const whatsapp = useWhatsappOffered();
  const [push, setPush] = useState<PushState>("off");
  const [pushHelp, setPushHelp] = useState<"ios" | "blocked" | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    pushState().then(setPush);
  }, []);

  async function scheduleNotification() {
    if (push === "ios_add_to_home") return setPushHelp("ios");
    if (push === "blocked") return setPushHelp("blocked");
    setSaving(true);
    setError("");
    try {
      await enablePush();
      await api.pushReminder(r.claim_id, r.id);
    } catch (err) {
      setError(err instanceof PushError ? err.message : errorMessage(err, "לא הצלחנו לקבוע את ההתראה. אפשר לנסות שוב."));
      setSaving(false);
    }
  }
  const [number, setNumber] = useState(phone ?? "");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function scheduleWhatsapp() {
    setSaving(true);
    setError("");
    try {
      await api.whatsappReminder(r.claim_id, r.id, number);
      // The card disappears once the reminder is no longer "suggested" (live update).
    } catch (err) {
      setError(errorMessage(err, "לא הצלחנו לקבוע את התזכורת. אפשר לנסות שוב."));
      setSaving(false);
    }
  }

  return (
    <div className="card reminder">
      <div className="task-head">
        <span className="task-icon">⏰</span>
        <div className="grow">
          <strong>{r.title}</strong>
          <p className="small">{reminderDay(r)}, 9:00 · {whatsapp || push !== "off" ? "להזכיר לך?" : "להוסיף ליומן?"}</p>
        </div>
      </div>
      {pushHelp && (
        <div className="push-help small">
          {pushHelp === "ios" ? (
            <>
              <strong>באייפון, התראות עובדות מהאפליקציה במסך הבית:</strong>
              <ol>
                <li>
                  בספארי לוחצים על כפתור השיתוף <span aria-hidden="true">⬆️</span>
                </li>
                <li>בוחרים "הוספה למסך הבית"</li>
                <li>פותחים את InsurAgent מהמסך הבית, וחוזרים לתזכורת הזו</li>
              </ol>
            </>
          ) : (
            <p>ההתראות חסומות לאתר הזה. אפשר לאשר אותן בהגדרות האתר בדפדפן (סמל המנעול ליד הכתובת), ואז לנסות שוב.</p>
          )}
          <button className="link small" onClick={() => setPushHelp(null)}>
            הבנתי
          </button>
        </div>
      )}
      {error && !asking && <p className="small error">{error}</p>}
      {asking ? (
        <div className="whatsapp-form">
          <label>
            מספר הנייד לוואטסאפ
            <input value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" inputMode="tel" placeholder="050-1234567" />
          </label>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>אני רוצה לקבל מ-InsurAgent תזכורת בוואטסאפ למספר הזה. בהודעה יופיעו רק כותרת התזכורת וקישור לתיק.</span>
          </label>
          {error && <p className="small error">{error}</p>}
          <div className="task-actions">
            <button className="link" onClick={() => setAsking(false)}>
              חזרה
            </button>
            <button className="whatsapp-btn" disabled={!consent || !number.trim() || saving} onClick={scheduleWhatsapp}>
              {saving ? "קובע…" : "קבע תזכורת"}
            </button>
          </div>
        </div>
      ) : (
      <div className="task-actions reminder-actions">
        {push !== "off" && push !== "unsupported" && (
          <button className="primary" onClick={scheduleNotification} disabled={saving}>
            {saving ? "מפעיל…" : "🔔 התראה בטלפון"}
          </button>
        )}
        {whatsapp && (
          <button className="whatsapp-btn" onClick={() => setAsking(true)}>
            📲 בוואטסאפ
          </button>
        )}
        <button className="link" onClick={() => onChoice("dismissed")}>
          לא תודה
        </button>
        <button
          onClick={() => {
            downloadIcs(r);
            onChoice("added");
          }}
        >
          יומן אחר / iPhone
        </button>
        <a
          className={push === "off" || push === "unsupported" ? "button primary" : "button"}
          href={googleCalendarUrl(r)}
          target="_blank"
          rel="noreferrer"
          onClick={() => onChoice("added")}
        >
          Google יומן
        </a>
      </div>
      )}
    </div>
  );
}
