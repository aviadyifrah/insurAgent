/**
 * Creates email drafts in the user's Gmail, straight from the browser: attachments go from this
 * device to their mailbox and never through our server. The access token comes from re-confirming
 * the Google sign-in with the extra Gmail permission; it lives in memory for under an hour and is
 * never stored. The user opens the draft and sends it themselves.
 *
 * Reading mail (finding receipts) can be added the same way later, with a read scope.
 */
import { GoogleAuthProvider, reauthenticateWithPopup } from "firebase/auth";
import { buildMime, type MimeAttachment } from "@insuragent/shared/mime";
import { auth } from "./firebase";

const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const TOKEN_TTL_MS = 50 * 60 * 1000; // Google tokens last an hour

let cached: { token: string; expires: number } | null = null;

export class GmailError extends Error {}

/** Must be called straight from a click, or the browser blocks the Google popup. */
export async function gmailToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  const user = auth.currentUser;
  if (!user) throw new GmailError("צריך להתחבר מחדש.");
  const provider = new GoogleAuthProvider();
  provider.addScope(COMPOSE_SCOPE);
  provider.setCustomParameters({ login_hint: user.email ?? "" });
  try {
    const result = await reauthenticateWithPopup(user, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new GmailError("לא התקבל אישור מ-Google.");
    cached = { token, expires: Date.now() + TOKEN_TTL_MS };
    return token;
  } catch (err) {
    if (err instanceof GmailError) throw err;
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/user-mismatch") throw new GmailError("צריך לבחור את אותו חשבון Google שאיתו נכנסתם לאפליקציה.");
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") throw new GmailError("החיבור ל-Gmail בוטל.");
    if (code === "auth/popup-blocked") throw new GmailError("הדפדפן חסם את החלון של Google. אפשר לאשר חלונות קופצים ולנסות שוב.");
    throw new GmailError("החיבור ל-Gmail לא הצליח. אפשר לנסות שוב.");
  }
}

export interface DraftInput {
  to: string | null;
  subject: string;
  body: string;
  attachments: MimeAttachment[];
}

/** Creates the draft and returns a link that opens Gmail's drafts. */
export async function createGmailDraft(token: string, draft: DraftInput): Promise<string> {
  // The upload endpoint takes the raw message, which allows attachments up to Gmail's 25MB limit.
  const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
    body: buildMime(draft),
  });
  if (res.status === 401 || res.status === 403) {
    cached = null;
    throw new GmailError("אין הרשאה ליצור טיוטה ב-Gmail. אפשר לנסות שוב ולאשר את ההרשאה.");
  }
  if (res.status === 413) throw new GmailError("הקבצים גדולים מדי למייל אחד ב-Gmail.");
  if (!res.ok) throw new GmailError("יצירת הטיוטה ב-Gmail נכשלה. אפשר לנסות שוב.");
  const email = auth.currentUser?.email ?? "";
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#drafts`;
}
