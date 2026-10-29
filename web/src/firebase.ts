import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

export let auth: Auth;
export let db: Firestore;

/**
 * In development the app talks to the local emulators. On Firebase Hosting the project's config
 * is served at /__/firebase/init.json, so nothing is hard-coded.
 */
export async function initFirebase() {
  const useEmulators = import.meta.env.DEV;
  const options: FirebaseOptions = useEmulators
    ? { apiKey: "demo-key", authDomain: "demo-insuragent.firebaseapp.com", projectId: "demo-insuragent" }
    : await (await fetch("/__/firebase/init.json")).json();
  const app = initializeApp(options);
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    // Same host as the page, so a phone on the local network reaches the emulators too.
    const host = window.location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
  }
}
