// Reminders as phone notifications (web push through Firebase Cloud Messaging). Free, and needs no
// phone number: each browser that allows notifications registers a token on the user. Shown in the
// app only once WEB_PUSH_VAPID_KEY (the Web Push certificate's public key) is set in .env.functions.
import { FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { firestore } from "./firebase";
import { now, users, type Reminder, type User } from "./store";

export const MAX_PUSH_TOKENS = 5;

/** The public key the browser needs to subscribe; empty means notifications are off. */
export const pushVapidKey = () => process.env.WEB_PUSH_VAPID_KEY ?? "";

// Tokens FCM says are gone (the browser unsubscribed or the app was removed).
const GONE = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

/** Sends one notification to every device the user registered; forgets devices that are gone. */
export async function notifyUser(user: User, n: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  const tokens = (user.push_tokens ?? []).map((t) => t.token);
  if (tokens.length === 0) return 0;
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    // Data only: the service worker (web/public/sw.js) shows it, in Hebrew and right-to-left.
    webpush: { data: { title: n.title, body: n.body, url: n.url, tag: n.tag ?? "" }, headers: { Urgency: "high", TTL: String(24 * 3600) } },
  });
  const gone = res.responses.flatMap((r, i) => (!r.success && GONE.has(r.error?.code ?? "") ? [tokens[i]] : []));
  if (gone.length > 0) {
    await users.doc(user.id).update({ push_tokens: (user.push_tokens ?? []).filter((t) => !gone.includes(t.token)) });
  }
  return res.successCount;
}

/** Sends the phone-notification reminders that are due. Runs from the scheduled sweeper. */
export async function sendDuePushReminders(): Promise<void> {
  const due = await firestore.collectionGroup("reminders").where("push_status", "==", "scheduled").where("due_at", "<=", now()).limit(100).get();
  for (const doc of due.docs) {
    const r = doc.data() as Reminder;
    try {
      const user = (await users.doc(r.user_id).get()).data() as User | undefined;
      // Only the reminder's short title appears, since notifications show on the lock screen.
      const sent = user
        ? await notifyUser({ ...user, id: r.user_id }, { title: "תזכורת מ-InsurAgent", body: r.title, url: `/#/claims/${r.claim_id}`, tag: doc.id })
        : 0;
      await doc.ref.update(sent > 0 ? { push_status: "sent", push_sent_at: now() } : { push_status: "failed", push_error: user?.push_tokens?.length ? "not delivered to any device" : "no device to notify" });
    } catch (err) {
      console.error("push reminder failed", doc.ref.path, err);
      await doc.ref.update({ push_status: "failed", push_error: String(err).slice(0, 300) });
    }
  }
}

/** Adds this browser's token to the user (most recent devices kept). */
export async function addPushToken(user: User, token: string, device: string) {
  const others = (user.push_tokens ?? []).filter((t) => t.token !== token);
  await users.doc(user.id).update({ push_tokens: [...others, { token, device, added_at: now() }].slice(-MAX_PUSH_TOKENS) });
}

export async function removePushToken(user: User, token: string) {
  const tokens = (user.push_tokens ?? []).filter((t) => t.token !== token);
  await users.doc(user.id).update({ push_tokens: tokens.length ? tokens : FieldValue.delete() });
}
