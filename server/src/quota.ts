// Daily usage limits on what costs model calls: messages to the agent and document uploads.
// Counted per user and across all users (a budget backstop), per calendar day in Israel.
import { HTTPException } from "hono/http-exception";
import { firestore } from "./firebase";

export type QuotaKind = "messages" | "uploads";

const limit = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

const PER_USER: Record<QuotaKind, number> = {
  messages: limit("DAILY_MESSAGE_LIMIT", 30),
  uploads: limit("DAILY_UPLOAD_LIMIT", 20),
};
const ALL_USERS: Record<QuotaKind, number> = {
  messages: limit("GLOBAL_DAILY_MESSAGE_LIMIT", 300),
  uploads: limit("GLOBAL_DAILY_UPLOAD_LIMIT", 200),
};

const israelDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }); // YYYY-MM-DD

/** Counts one use, or throws 429 when today's limit is reached. Server-only collection (no client rules). */
export async function consumeQuota(uid: string, kind: QuotaKind) {
  const day = israelDay();
  const userRef = firestore.collection("usage").doc(`${uid}_${day}`);
  const allRef = firestore.collection("usage").doc(`_all_${day}`);
  await firestore.runTransaction(async (tx) => {
    const [mine, all] = await Promise.all([tx.get(userRef), tx.get(allRef)]);
    const used = (mine.get(kind) as number | undefined) ?? 0;
    const usedByAll = (all.get(kind) as number | undefined) ?? 0;
    if (used >= PER_USER[kind]) throw new HTTPException(429, { message: "daily_limit" });
    if (usedByAll >= ALL_USERS[kind]) {
      console.warn(`global daily ${kind} limit reached (${ALL_USERS[kind]})`);
      throw new HTTPException(429, { message: "service_busy" });
    }
    tx.set(userRef, { user_id: uid, day, [kind]: used + 1 }, { merge: true });
    tx.set(allRef, { day, [kind]: usedByAll + 1 }, { merge: true });
  });
}
