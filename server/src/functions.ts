// Cloud Functions entry point (bundled by `npm run build:functions` into deploy/index.js).
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createApp } from "./app";
import { dispatchToQueue, drainInbox, sweepStranded } from "./agent/agent";
import { sendDueReminders } from "./whatsapp";

// Must be compatible with the Firestore location (europe-west1 works with eur3 and europe-west1).
const REGION = "europe-west1";
const anthropicKey = defineSecret("ANTHROPIC_API_KEY");

// Optional sign-up gate: set ACCESS_CODE in .env.functions to require a code from new users.
const app = createApp({ accessCode: () => process.env.ACCESS_CODE ?? "", dispatch: dispatchToQueue });

/** The API. Requests return quickly; agent work is queued for `agent` below. */
export const api = onRequest(
  {
    region: REGION,
    // Uploads are analyzed inline (one model call, well under Hosting's 60s limit).
    secrets: [anthropicKey],
    timeoutSeconds: 60,
    memory: "512MiB",
    concurrency: 40,
  },
  async (req, res) => {
    // The Functions framework has already read the body; rebuild a fetch Request for Hono.
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    }
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const response = await app.fetch(
      new Request(`https://${req.hostname}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: hasBody ? new Uint8Array(req.rawBody) : undefined,
      }),
    );
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await response.arrayBuffer()));
  },
);

/** Runs the agent for queued input. A Firestore lease keeps it to one run per claim across instances. */
export const agent = onDocumentCreated(
  {
    document: "claims/{claimId}/inbox/{inputId}",
    region: REGION,
    secrets: [anthropicKey],
    timeoutSeconds: 540, // an agent turn with several tool calls can take minutes
    memory: "512MiB",
    maxInstances: 10, // a cost ceiling, not a correctness requirement
    concurrency: 20,
  },
  async (event) => {
    await drainInbox(event.params.claimId);
  },
);

// The WhatsApp token is a secret; it's declared only once WhatsApp is set up (WHATSAPP_PHONE_NUMBER_ID in
// .env.functions): the deploy asks for a value for every declared secret, even an unused one.
const sweeperSecrets = process.env.WHATSAPP_PHONE_NUMBER_ID ? [anthropicKey, defineSecret("WHATSAPP_TOKEN")] : [anthropicKey];

/** Recovers agent input stranded by a crash or timeout, and sends WhatsApp reminders that are due. */
export const sweeper = onSchedule(
  { schedule: "every 10 minutes", region: REGION, secrets: sweeperSecrets, timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    await Promise.all([sweepStranded(), sendDueReminders().catch((err) => console.error("WhatsApp reminders failed", err))]);
  },
);
