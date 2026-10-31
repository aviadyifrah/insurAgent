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

interface Props {
  reminder: Reminder;
  onChoice: (status: "added" | "dismissed") => void;
}

/** A suggested reminder: one tap adds it to the phone's calendar. */
export function ReminderCard({ reminder: r, onChoice }: Props) {
  return (
    <div className="card reminder">
      <div className="task-head">
        <span className="task-icon">⏰</span>
        <div className="grow">
          <strong>{r.title}</strong>
          <p className="small">{reminderDay(r)}, 9:00 · להוסיף ליומן?</p>
        </div>
      </div>
      <div className="task-actions reminder-actions">
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
          className="button primary"
          href={googleCalendarUrl(r)}
          target="_blank"
          rel="noreferrer"
          onClick={() => onChoice("added")}
        >
          Google יומן
        </a>
      </div>
    </div>
  );
}
