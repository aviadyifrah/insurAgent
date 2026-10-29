import { all, update, type Task } from "./db";
import { nextReminderAt } from "./claims";

interface DueTask extends Task {
  email: string;
  claim_title: string | null;
}

/**
 * Delivers a reminder. Console only for now; email / WhatsApp / web push plug in here.
 * Every reminder should link straight to the task in the app.
 */
function notify(task: DueTask) {
  const link = `${process.env.APP_URL ?? "http://localhost:5173"}/#/claims/${task.claim_id}`;
  console.log(`[reminder #${task.reminder_count + 1}] to ${task.email}: "${task.title}" (${task.claim_title ?? "תביעה"}) ${link}`);
}

export function sendDueReminders() {
  const due = all<DueTask>(
    `SELECT tasks.*, users.email, claims.title AS claim_title
     FROM tasks JOIN claims ON claims.id = tasks.claim_id JOIN users ON users.id = claims.user_id
     WHERE tasks.status = 'open' AND tasks.next_reminder_at <= ?`,
    new Date().toISOString(),
  );
  for (const task of due) {
    notify(task);
    const count = task.reminder_count + 1;
    update("tasks", task.id, {
      reminder_count: count,
      last_reminded_at: new Date().toISOString(),
      next_reminder_at: nextReminderAt(count),
    });
  }
}

export function startReminderLoop(intervalMs = 60_000) {
  sendDueReminders();
  return setInterval(sendDueReminders, intervalMs);
}
