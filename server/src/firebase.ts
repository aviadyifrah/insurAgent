import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// On Cloud Functions the project and credentials come from the environment. Locally, the
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST variables point the SDK at the emulators.
if (getApps().length === 0) initializeApp();

export const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth();
