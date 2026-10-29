// Cloud Functions entry point (bundled by `npm run build:functions` into deploy/index.js).
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createApp } from "./app";
import { sendDueReminders } from "./reminders";

const REGION = "europe-west1";
const anthropicKey = defineSecret("ANTHROPIC_API_KEY");
const accessCode = defineSecret("ACCESS_CODE");

const app = createApp({ accessCode: () => accessCode.value() });

export const api = onRequest(
  {
    region: REGION,
    secrets: [anthropicKey, accessCode],
    timeoutSeconds: 540, // an agent turn with several tool calls can take a while
    memory: "1GiB",
    // The per-claim agent lock is in memory, so all requests must reach the same instance.
    maxInstances: 1,
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

export const reminders = onSchedule({ schedule: "every 60 minutes", region: REGION, timeZone: "Asia/Jerusalem" }, async () => {
  await sendDueReminders();
});
