// Caps the sign-in SMS (each costs money) and tells the admins when today's count reaches a threshold.
// Runs as a Firebase Auth blocking function before every SMS (needs Identity Platform on the project).
import { firestore } from "./firebase";
import { notifyUser } from "./push";
import { list, users, type User } from "./store";

const limit = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const DAILY_LIMIT = limit("SMS_DAILY_LIMIT", 30); // all numbers together
const PER_NUMBER_LIMIT = limit("SMS_PER_NUMBER_DAILY_LIMIT", 5);
const ALERT_AT = limit("SMS_ALERT_AT", 10); // Google bills from the 11th SMS of the day

const israelDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

export type SmsDecision = { allow: true; count: number; alert: boolean } | { allow: false; reason: "daily_limit" | "number_limit" };

/** Counts one SMS for today (and for this number), unless a limit is reached. */
export async function countSms(phone: string): Promise<SmsDecision> {
  const day = israelDay();
  const allRef = firestore.collection("usage").doc(`_sms_${day}`);
  const numberRef = firestore.collection("usage").doc(`_sms_${phone.replace(/\D/g, "")}_${day}`);
  return firestore.runTransaction(async (tx) => {
    const [all, mine] = await Promise.all([tx.get(allRef), tx.get(numberRef)]);
    const count = (all.get("sms") as number | undefined) ?? 0;
    const forNumber = (mine.get("sms") as number | undefined) ?? 0;
    if (count >= DAILY_LIMIT) return { allow: false, reason: "daily_limit" } as const;
    if (forNumber >= PER_NUMBER_LIMIT) return { allow: false, reason: "number_limit" } as const;
    tx.set(allRef, { day, sms: count + 1 }, { merge: true });
    tx.set(numberRef, { day, sms: forNumber + 1 }, { merge: true });
    return { allow: true, count: count + 1, alert: count + 1 === ALERT_AT } as const;
  });
}

/** Tells the admins: an error (Error Reporting emails it) and a phone notification to each admin device. */
export async function alertAdmins(message: string) {
  console.error(`SMS alert: ${message}`);
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (admins.length === 0) return;
  const adminUsers = (await list<User>(users.where("email", "in", admins.slice(0, 10)))).filter((u) => u.push_tokens?.length);
  await Promise.all(
    adminUsers.map((u) => notifyUser(u, { title: "InsurAgent: התראת SMS", body: message, url: "/#/admin" }).catch((err) => console.error("admin alert failed", err))),
  );
}

export async function smsCountToday(): Promise<number> {
  return ((await firestore.collection("usage").doc(`_sms_${israelDay()}`).get()).get("sms") as number | undefined) ?? 0;
}

export const SMS_LIMITS = { daily: DAILY_LIMIT, perNumber: PER_NUMBER_LIMIT, alertAt: ALERT_AT };
