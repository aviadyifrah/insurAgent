import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { all, get, run, update, type Claim, type DocumentRow, type EmailDraft, type Task, type User } from "./db";
import { addChat, claimView, closeTask, getClaim } from "./claims";
import { documentBlocks, runAgent } from "./agent/agent";
import { ANALYZABLE_MIME, analyzeDocument } from "./agent/extract";
import { startReminderLoop } from "./reminders";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-secret-change-me";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Bump when the terms / privacy text changes; users are asked to accept again.
const CONSENT_VERSION = "draft-2026-10";

type Env = { Variables: { user: User } };
const app = new Hono<Env>();
const api = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) return c.json({ error: "invalid input", details: err.issues }, 400);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

// --- Auth (development login: email only; Google sign-in replaces this) ---

api.post("/login", async (c) => {
  const { email, consent } = z.object({ email: z.email(), consent: z.boolean().default(false) }).parse(await c.req.json());
  const normalized = email.trim().toLowerCase();
  let user = get<User>("SELECT * FROM users WHERE email = ?", normalized);
  // Nobody uses the app without accepting the current terms; the acceptance is recorded with its version.
  if (user?.consent_version !== CONSENT_VERSION) {
    if (!consent) return c.json({ error: "consent_required" }, 400);
    if (!user) run("INSERT INTO users (email) VALUES (?)", normalized);
    run("UPDATE users SET consent_version = ?, consent_at = ? WHERE email = ?", CONSENT_VERSION, new Date().toISOString(), normalized);
    user = get<User>("SELECT * FROM users WHERE email = ?", normalized)!;
  }
  await setSignedCookie(c, "uid", String(user.id), SESSION_SECRET, { httpOnly: true, sameSite: "Lax", path: "/" });
  return c.json(user);
});

api.post("/logout", (c) => {
  deleteCookie(c, "uid", { path: "/" });
  return c.json({ ok: true });
});

api.use("*", async (c, next) => {
  const uid = await getSignedCookie(c, SESSION_SECRET, "uid");
  const user = uid ? get<User>("SELECT * FROM users WHERE id = ?", Number(uid)) : undefined;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

function claimOr404(c: Context<Env>): Claim {
  const claim = getClaim(Number(c.req.param("id")), c.get("user").id);
  if (!claim) throw new HTTPException(404, { message: "claim not found" });
  return claim;
}

function claimOr404Id(claimId: number, userId: number): number {
  if (!getClaim(claimId, userId)) throw new HTTPException(404, { message: "claim not found" });
  return claimId;
}

function ownedDocuments(userId: number, ids: number[]): DocumentRow[] {
  return ids.map((id) => {
    const doc = get<DocumentRow>("SELECT * FROM documents WHERE id = ? AND user_id = ?", id, userId);
    if (!doc) throw new HTTPException(404, { message: `document ${id} not found` });
    return doc;
  });
}

function attachToClaim(docs: DocumentRow[], claimId: number) {
  for (const d of docs) if (d.claim_id == null) update("documents", d.id, { claim_id: claimId });
}

function refreshed(claimId: number, userId: number) {
  return claimView(getClaim(claimId, userId)!);
}

// --- Profile ---

api.get("/me", (c) => c.json(c.get("user")));

api.put("/me", async (c) => {
  const patch = z
    .object({
      full_name: z.string().optional(),
      id_number: z.string().optional(),
      phone: z.string().optional(),
      bank_details: z.string().optional(),
    })
    .parse(await c.req.json());
  update("users", c.get("user").id, patch);
  return c.json(get<User>("SELECT * FROM users WHERE id = ?", c.get("user").id));
});

// --- Claims ---

api.get("/claims", (c) => {
  const claims = all<Claim & { total: number; done: number; open_tasks: number }>(
    `SELECT claims.*,
       (SELECT COUNT(*) FROM requirements r WHERE r.claim_id = claims.id AND r.required = 1) AS total,
       (SELECT COUNT(*) FROM requirements r WHERE r.claim_id = claims.id AND r.required = 1 AND r.status IN ('done','not_needed')) AS done,
       (SELECT COUNT(*) FROM tasks t WHERE t.claim_id = claims.id AND t.status = 'open') AS open_tasks
     FROM claims WHERE user_id = ? ORDER BY updated_at DESC`,
    c.get("user").id,
  );
  return c.json(claims);
});

api.get("/tasks", (c) => {
  const tasks = all<Task & { claim_title: string | null }>(
    `SELECT tasks.*, claims.title AS claim_title FROM tasks JOIN claims ON claims.id = tasks.claim_id
     WHERE claims.user_id = ? AND tasks.status = 'open' ORDER BY tasks.id`,
    c.get("user").id,
  );
  return c.json(tasks);
});

const messageInput = z.object({ text: z.string().default(""), document_ids: z.array(z.number().int()).default([]) });

api.post("/claims", async (c) => {
  const user = c.get("user");
  const { text, document_ids } = messageInput.parse(await c.req.json());
  const docs = ownedDocuments(user.id, document_ids);
  const claimId = run("INSERT INTO claims (user_id, title) VALUES (?, ?)", user.id, "תביעה חדשה");
  attachToClaim(docs, claimId);
  addChat(claimId, "user", text || "(צירפתי מסמכים)");
  await runAgent(claimId, [...documentBlocks(docs), { type: "text", text: text || "(the user attached documents)" }]);
  return c.json(refreshed(claimId, user.id));
});

api.get("/claims/:id", (c) => c.json(claimView(claimOr404(c))));

api.post("/claims/:id/messages", async (c) => {
  const user = c.get("user");
  const claim = claimOr404(c);
  const { text, document_ids } = messageInput.parse(await c.req.json());
  const docs = ownedDocuments(user.id, document_ids);
  attachToClaim(docs, claim.id);
  addChat(claim.id, "user", text || "(צירפתי מסמכים)");
  await runAgent(claim.id, [...documentBlocks(docs), { type: "text", text: text || "(the user attached documents)" }]);
  return c.json(refreshed(claim.id, user.id));
});

api.post("/claims/:id/submitted", (c) => {
  const claim = claimOr404(c);
  update("claims", claim.id, { status: "submitted", updated_at: new Date().toISOString() });
  for (const t of all<Task>("SELECT * FROM tasks WHERE claim_id = ? AND status = 'open'", claim.id)) closeTask(t.id, "done");
  addChat(claim.id, "event", "🎉 סימנת שהתביעה הוגשה");
  return c.json(refreshed(claim.id, c.get("user").id));
});

// --- Documents ---

function insertDocument(d: {
  userId: number;
  claimId: number | null;
  filename: string;
  mime: string;
  storage: DocumentRow["storage"];
  storageRef: string;
  kind?: string;
  analysis?: unknown;
}): DocumentRow {
  const id = run(
    "INSERT INTO documents (user_id, claim_id, kind, filename, mime, storage, storage_ref, analysis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    d.userId,
    d.claimId,
    d.kind ?? null,
    d.filename,
    d.mime,
    d.storage,
    d.storageRef,
    d.analysis == null ? null : JSON.stringify(d.analysis),
  );
  return get<DocumentRow>("SELECT * FROM documents WHERE id = ?", id)!;
}

const storageInput = z.object({ storage: z.enum(["device"]), storage_ref: z.string().min(1).max(100) });

// The client stores the file itself; we only read it once to extract its details.
api.post("/documents", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new HTTPException(400, { message: "file is required" });
  if (!ANALYZABLE_MIME.has(file.type)) throw new HTTPException(400, { message: "unsupported file type" });
  if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(400, { message: "file too large" });
  const { storage, storage_ref } = storageInput.parse(body);
  const claimId = body.claim_id ? claimOr404Id(Number(body.claim_id), user.id) : null;

  let analysis = null;
  try {
    analysis = await analyzeDocument(Buffer.from(await file.arrayBuffer()), file.type);
  } catch (err) {
    console.error("document analysis failed", err instanceof Error ? err.message : err);
  }
  const doc = insertDocument({
    userId: user.id,
    claimId,
    filename: path.basename(file.name || "upload"),
    mime: file.type,
    storage,
    storageRef: storage_ref,
    analysis,
  });
  return c.json({ ...doc, analysis });
});

// --- Tasks ---

function taskOr404(c: Context<Env>): { task: Task; claim: Claim } {
  const task = get<Task>("SELECT * FROM tasks WHERE id = ?", Number(c.req.param("id")));
  const claim = task && getClaim(task.claim_id, c.get("user").id);
  if (!task || !claim) throw new HTTPException(404, { message: "task not found" });
  if (task.status !== "open") throw new HTTPException(409, { message: "task is not open" });
  return { task, claim };
}

api.post("/tasks/:id/complete", async (c) => {
  const user = c.get("user");
  const { task, claim } = taskOr404(c);
  const { document_ids, note } = z
    .object({ document_ids: z.array(z.number().int()).default([]), note: z.string().optional() })
    .parse(await c.req.json());
  const docs = ownedDocuments(user.id, document_ids);
  attachToClaim(docs, claim.id);
  closeTask(task.id, "done");
  addChat(claim.id, "event", `✅ הושלם: ${task.title}`);
  await runAgent(claim.id, [
    ...documentBlocks(docs),
    {
      type: "text",
      text: `<app_event type="task_completed" task_id="${task.id}">The user completed the task "${task.title}".${
        docs.length ? " The attached documents are above." : ""
      }${note ? ` User note: ${note}` : ""}</app_event>`,
    },
  ]);
  return c.json(refreshed(claim.id, user.id));
});

api.post("/tasks/:id/signature", async (c) => {
  const user = c.get("user");
  const { task, claim } = taskOr404(c);
  // The signature image stays in the client's storage, like every other document.
  const { storage, storage_ref } = storageInput.parse(await c.req.json());
  const doc = insertDocument({
    userId: user.id,
    claimId: claim.id,
    filename: "signature.png",
    mime: "image/png",
    storage,
    storageRef: storage_ref,
    kind: "signature",
  });
  closeTask(task.id, "done");
  if (task.requirement_id) update("requirements", task.requirement_id, { status: "done", document_id: doc.id });
  addChat(claim.id, "event", "✍️ חתמת על טופס התביעה");
  await runAgent(claim.id, [
    {
      type: "text",
      text: `<app_event type="signature_added" task_id="${task.id}" document_id="${doc.id}">The user signed. The linked requirement is now done.</app_event>`,
    },
  ]);
  return c.json(refreshed(claim.id, user.id));
});

// --- Email drafts ---

api.post("/emails/:id/sent", async (c) => {
  const user = c.get("user");
  const draft = get<EmailDraft>("SELECT * FROM email_drafts WHERE id = ?", Number(c.req.param("id")));
  const claim = draft && getClaim(draft.claim_id, user.id);
  if (!draft || !claim) throw new HTTPException(404, { message: "email not found" });
  update("email_drafts", draft.id, { status: "sent" });
  for (const t of all<Task>("SELECT * FROM tasks WHERE email_draft_id = ? AND status = 'open'", draft.id)) {
    closeTask(t.id, "done");
    if (t.requirement_id) update("requirements", t.requirement_id, { status: "pending_third_party" });
  }
  addChat(claim.id, "event", `📧 נשלח: ${draft.subject}`);
  await runAgent(claim.id, [
    {
      type: "text",
      text: `<app_event type="email_sent" email_draft_id="${draft.id}" purpose="${draft.purpose}">The user sent the email "${draft.subject}".</app_event>`,
    },
  ]);
  return c.json(refreshed(claim.id, user.id));
});

app.route("/api", api);

// Serve the built web app in production.
const WEB_DIST = path.resolve("../web/dist");
if (fs.existsSync(WEB_DIST)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), WEB_DIST) }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`InsurAgent server on http://localhost:${port}`));
startReminderLoop();
