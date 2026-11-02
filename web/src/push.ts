/**
 * Phone notifications (web push). The browser asks the user once; its Firebase Cloud Messaging token
 * is saved on their account so reminders reach this device. On iPhone this only works from the app
 * added to the home screen (iOS 16.4+), so there we explain how to add it instead.
 */
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { api } from "./api";
import { app } from "./firebase";

export type PushState =
  | "off" // not set up on the server
  | "unsupported" // this browser can't receive notifications
  | "ios_add_to_home" // iPhone/iPad in Safari: needs to be added to the home screen first
  | "blocked" // the user blocked notifications for this site
  | "ready"; // can ask (or already allowed)

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

let vapidKey: Promise<string> | null = null;
const serverKey = () => (vapidKey ??= api.config().then((c) => c.push_vapid_key ?? "").catch(() => ""));

export async function pushState(): Promise<PushState> {
  if (!(await serverKey())) return "off";
  if (isIos() && !isStandalone()) return "ios_add_to_home";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !(await isSupported().catch(() => false))) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return "ready";
}

export class PushError extends Error {}

/** Asks for permission (from a click) and registers this device. */
export async function enablePush(): Promise<void> {
  const key = await serverKey();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushError("ההתראות לא אושרו. אפשר לאשר אותן בהגדרות האתר בדפדפן.");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let token: string;
  try {
    token = await getToken(getMessaging(app), { vapidKey: key, serviceWorkerRegistration: registration });
  } catch {
    throw new PushError("לא הצלחנו להפעיל התראות במכשיר הזה. אפשר לנסות שוב.");
  }
  await api.addPushToken(token, navigator.userAgent.slice(0, 200));
}
