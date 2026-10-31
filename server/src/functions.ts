// Cloud Functions entry point (bundled by `npm run build:functions` into deploy/index.js).
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createApp } from "./app";
import { dispatchToQueue, runAgent } from "./agent/agent";
import { sendDueReminders } from "./reminders";

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

/** Runs the agent for each queued input. */
export const agent = onDocumentCreated(
  {
    document: "claims/{claimId}/inbox/{inputId}",
    region: REGION,
    secrets: [anthropicKey],
    timeoutSeconds: 540, // an agent turn with several tool calls can take minutes
    memory: "512MiB",
    // The per-claim agent lock is in memory, so every run must land on the same instance.
    maxInstances: 1,
    concurrency: 20,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    await runAgent(event.params.claimId, JSON.parse(data.content));
    await event.data!.ref.delete();
  },
);

export const reminders = onSchedule({ schedule: "every 60 minutes", region: REGION, timeZone: "Asia/Jerusalem" }, async () => {
  await sendDueReminders();
});
