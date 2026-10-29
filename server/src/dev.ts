// Local development server, against the Firebase emulators (see README).
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { dispatchInBackground } from "./agent/agent";
import { sendDueReminders } from "./reminders";

const app = createApp({ accessCode: () => process.env.ACCESS_CODE ?? "", dispatch: dispatchInBackground });

// Serve a built web app too, so `npm run build` + this server is enough for a quick check.
const WEB_DIST = path.resolve("../web/dist");
if (fs.existsSync(WEB_DIST)) app.use("/*", serveStatic({ root: path.relative(process.cwd(), WEB_DIST) }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`InsurAgent server on http://localhost:${port}`));

// In production Cloud Scheduler triggers reminders; locally a timer does.
const tick = () => sendDueReminders().catch((err) => console.error("reminders failed", err));
tick();
setInterval(tick, 60_000);
