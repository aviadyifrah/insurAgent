import { firestore } from "./firebase";
import { nextReminderAt } from "./claims";
import { getClaim, getUser, now, type Task } from "./store";

/**
 * Delivers a reminder. Console only for now; email / WhatsApp / web push plug in here.
 * Every reminder should link straight to the task in the app.
 */
async function notify(task: Task) {
  const [user, claim] = await Promise.all([getUser(task.user_id), getClaim(task.claim_id)]);
  const link = `${process.env.APP_URL ?? "http://localhost:5173"}/#/claims/${task.claim_id}`;
  console.log(`[reminder #${task.reminder_count + 1}] to ${user?.email}: "${task.title}" (${claim?.title ?? "תביעה"}) ${link}`);
}

export async function sendDueReminders() {
  const due = await firestore
    .collectionGroup("tasks")
    .where("status", "==", "open")
    .where("next_reminder_at", "<=", now())
    .get();
  for (const doc of due.docs) {
    const task = { ...doc.data(), id: doc.id } as Task;
    await notify(task);
    const count = task.reminder_count + 1;
    await doc.ref.update({ reminder_count: count, last_reminded_at: now(), next_reminder_at: nextReminderAt(count) });
  }
}
