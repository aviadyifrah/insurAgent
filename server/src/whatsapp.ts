// Reminders over WhatsApp, through Meta's WhatsApp Cloud API. Off until WHATSAPP_PHONE_NUMBER_ID
// (in .env.functions) and the WHATSAPP_TOKEN secret are set. A message outside a conversation the
// user started must use a template Meta approved; ours carries the reminder title and a link.
import { firestore } from "./firebase";
import { now, type Reminder } from "./store";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
// Overridable for local testing against a stand-in server.
const GRAPH_BASE = process.env.WHATSAPP_GRAPH_BASE ?? "https://graph.facebook.com";
const TEMPLATE = process.env.WHATSAPP_TEMPLATE ?? "claim_reminder";

/** Whether the app offers WhatsApp reminders (the sender also needs the token). */
export const whatsappEnabled = () => !!process.env.WHATSAPP_PHONE_NUMBER_ID;

/** An Israeli mobile number in the international form WhatsApp uses (9725XXXXXXXX), or null. */
export function israeliMobile(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("972") ? digits.slice(3) : digits.replace(/^0/, "");
  return /^5\d{8}$/.test(local) ? `972${local}` : null;
}

async function sendTemplate(to: string, params: string[]): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN is not set");
  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: "he" },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Sends the WhatsApp reminders that are due. Runs from the scheduled sweeper. */
export async function sendDueReminders(): Promise<void> {
  if (!whatsappEnabled()) return;
  const due = await firestore
    .collectionGroup("reminders")
    .where("whatsapp_status", "==", "scheduled")
    .where("due_at", "<=", now())
    .limit(100)
    .get();
  for (const doc of due.docs) {
    const r = doc.data() as Reminder;
    try {
      // Only the reminder's short title goes in the message; no medical or claim details.
      await sendTemplate(r.whatsapp_to!, [r.title, `${process.env.APP_URL}/#/claims/${r.claim_id}`]);
      await doc.ref.update({ whatsapp_status: "sent", whatsapp_sent_at: now() });
    } catch (err) {
      console.error("WhatsApp reminder failed", doc.ref.path, err);
      await doc.ref.update({ whatsapp_status: "failed", whatsapp_error: String(err).slice(0, 300) });
    }
  }
}
