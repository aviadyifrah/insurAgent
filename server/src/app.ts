import crypto from "node:crypto";
import path from "node:path";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { auth } from "./firebase";
import { addChat, claimView, closeTask } from "./claims";
import { documentBlocks, runAgent } from "./agent/agent";
import { ANALYZABLE_MIME, analyzeDocument } from "./agent/extract";
import {
  add,
  child,
  claims,
  documents,
  getClaim,
  getDoc,
  getUser,
  list,
  now,
  requirementsOf,
  updateClaim,
  users,
  type Claim,
  type DocumentRow,
  type EmailDraft,
  type Task,
  type User,
} from "./store";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Bump when the terms / privacy text changes; users are asked to accept again.
const CONSENT_VERSION = "draft-2026-10";

export interface AppConfig {
  /** Until the product opens up, new users need this code (anyone can sign in with Google). */
  accessCode: () => string;
}

type Env = { Variables: { uid: string; email: string; user: User } };

export function createApp(config: AppConfig) {
  const api = new Hono<Env>();

  api.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: "invalid input", details: err.issues }, 400);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  api.get("/health", (c) => c.json({ ok: true }));
  api.get("/config", (c) => c.json({ access_code_required: config.accessCode() !== "" }));

  // --- Auth: Firebase ID token on every request ---

  api.use("*", async (c, next) => {
    const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return c.json({ error: "unauthorized" }, 401);
    try {
      const decoded = await auth.verifyIdToken(token);
      c.set("uid", decoded.uid);
      c.set("email", decoded.email ?? "");
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // Signed in but not yet accepted the current terms: only these two routes work.
  api.get("/me", async (c) => {
    const user = await getUser(c.get("uid"));
    if (user?.consent_version !== CONSENT_VERSION) return c.json({ error: "consent_required" }, 403);
    return c.json(user);
  });

  api.post("/consent", async (c) => {
    const { consent, access_code } = z
      .object({ consent: z.literal(true), access_code: z.string().default("") })
      .parse(await c.req.json());
    const uid = c.get("uid");
    const existing = await getUser(uid);
    const code = config.accessCode();
    if (!existing && code && !safeEqual(access_code.trim(), code)) return c.json({ error: "bad_access_code" }, 403);
    const record = { consent_version: CONSENT_VERSION, consent_at: now(), consent_given: consent };
    if (existing) await users.doc(uid).update(record);
    else
      await users.doc(uid).set({
        email: c.get("email"),
        full_name: null,
        id_number: null,
        phone: null,
        bank_details: null,
        created_at: now(),
        ...record,
      });
    return c.json(await getUser(uid));
  });

  api.use("*", async (c, next) => {
    const user = await getUser(c.get("uid"));
    if (user?.consent_version !== CONSENT_VERSION) return c.json({ error: "consent_required" }, 403);
    c.set("user", user);
    await next();
  });

  // --- Profile ---

  api.put("/me", async (c) => {
    const patch = z
      .object({
        full_name: z.string().optional(),
        id_number: z.string().optional(),
        phone: z.string().optional(),
        bank_details: z.string().optional(),
      })
      .parse(await c.req.json());
    await users.doc(c.get("user").id).update(patch);
    return c.json(await getUser(c.get("user").id));
  });

  // --- Claims ---

  api.get("/claims", async (c) => {
    const mine = await list<Claim>(claims.where("user_id", "==", c.get("user").id));
    const summaries = await Promise.all(
      mine.map(async (claim) => {
        const [reqs, open] = await Promise.all([
          requirementsOf(claim.id),
          list<Task>(child(claim.id, "tasks").where("status", "==", "open")),
        ]);
        const required = reqs.filter((r) => r.required);
        return {
          ...claim,
          total: required.length,
          done: required.filter((r) => r.status === "done" || r.status === "not_needed").length,
          open_tasks: open.length,
          open_task_list: open,
        };
      }),
    );
    summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return c.json(summaries);
  });

  const messageInput = z.object({ text: z.string().default(""), document_ids: z.array(z.string()).default([]) });

  // Creates an empty claim. The client then opens the claim screen and posts the first message
  // there, so the user watches the agent work live instead of waiting on this request.
  api.post("/claims", async (c) => {
    const user = c.get("user");
    const claim = await add<Claim>(claims, {
      user_id: user.id,
      title: "תביעה חדשה",
      treatment: null,
      provider: null,
      provider_email: null,
      treatment_date: null,
      insurer: null,
      insurer_key: null,
      policy_number: null,
      claim_type: null,
      amount: null,
      template_id: null,
      status: "collecting",
      created_at: now(),
      updated_at: now(),
    });
    return c.json(claim);
  });

  api.get("/claims/:id", async (c) => c.json(await claimView(await claimOr404(c))));

  api.post("/claims/:id/messages", async (c) => {
    const user = c.get("user");
    const claim = await claimOr404(c);
    const { text, document_ids } = messageInput.parse(await c.req.json());
    const docs = await ownedDocuments(user.id, document_ids);
    await attachToClaim(docs, claim.id);
    await addChat(claim, "user", text || "(צירפתי מסמכים)");
    await runAgent(claim.id, [...documentBlocks(docs), { type: "text", text: text || "(the user attached documents)" }]);
    return c.json(await claimView((await getClaim(claim.id))!));
  });

  api.post("/claims/:id/submitted", async (c) => {
    const claim = await claimOr404(c);
    await updateClaim(claim.id, { status: "submitted" });
    const open = await list<Task>(child(claim.id, "tasks").where("status", "==", "open"));
    await Promise.all(open.map((t) => closeTask(claim.id, t.id, "done")));
    await addChat(claim, "event", "🎉 סימנת שהתביעה הוגשה");
    return c.json(await claimView((await getClaim(claim.id))!));
  });

  // --- Documents (metadata only; the client keeps the file) ---

  const storageInput = z.object({ storage: z.enum(["device"]), storage_ref: z.string().min(1).max(100) });

  api.post("/documents", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: "file is required" });
    if (!ANALYZABLE_MIME.has(file.type)) throw new HTTPException(400, { message: "unsupported file type" });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(400, { message: "file too large" });
    const { storage, storage_ref } = storageInput.parse(body);
    const claimId = typeof body.claim_id === "string" && body.claim_id ? (await claimOr404Id(body.claim_id, user.id)) : null;

    // We read the file once to extract its details; it is never stored on the server.
    let analysis = null;
    try {
      analysis = await analyzeDocument(Buffer.from(await file.arrayBuffer()), file.type);
    } catch (err) {
      console.error("document analysis failed", err instanceof Error ? err.message : err);
    }
    const doc = await add<DocumentRow>(documents, {
      user_id: user.id,
      claim_id: claimId,
      kind: null,
      reusable: false,
      filename: path.basename(file.name || "upload"),
      mime: file.type,
      storage,
      storage_ref,
      analysis,
      created_at: now(),
    });
    return c.json(doc);
  });

  // --- Tasks ---

  api.post("/claims/:id/tasks/:taskId/complete", async (c) => {
    const user = c.get("user");
    const { task, claim } = await taskOr404(c);
    const { document_ids, note } = z
      .object({ document_ids: z.array(z.string()).default([]), note: z.string().optional() })
      .parse(await c.req.json());
    const docs = await ownedDocuments(user.id, document_ids);
    await attachToClaim(docs, claim.id);
    await closeTask(claim.id, task.id, "done");
    await addChat(claim, "event", `✅ הושלם: ${task.title}`);
    await runAgent(claim.id, [
      ...documentBlocks(docs),
      {
        type: "text",
        text: `<app_event type="task_completed" task_id="${task.id}">The user completed the task "${task.title}".${
          docs.length ? " The attached documents are above." : ""
        }${note ? ` User note: ${note}` : ""}</app_event>`,
      },
    ]);
    return c.json(await claimView((await getClaim(claim.id))!));
  });

  api.post("/claims/:id/tasks/:taskId/signature", async (c) => {
    const user = c.get("user");
    const { task, claim } = await taskOr404(c);
    // The signature image stays in the client's storage, like every other document.
    const { storage, storage_ref } = storageInput.parse(await c.req.json());
    const doc = await add<DocumentRow>(documents, {
      user_id: user.id,
      claim_id: claim.id,
      kind: "signature",
      reusable: false,
      filename: "signature.png",
      mime: "image/png",
      storage,
      storage_ref,
      analysis: null,
      created_at: now(),
    });
    await closeTask(claim.id, task.id, "done");
    if (task.requirement_id) {
      await child(claim.id, "requirements").doc(task.requirement_id).update({ status: "done", document_id: doc.id });
    }
    await addChat(claim, "event", "✍️ חתמת על טופס התביעה");
    await runAgent(claim.id, [
      {
        type: "text",
        text: `<app_event type="signature_added" task_id="${task.id}" document_id="${doc.id}">The user signed. The linked requirement is now done.</app_event>`,
      },
    ]);
    return c.json(await claimView((await getClaim(claim.id))!));
  });

  // --- Email drafts ---

  api.post("/claims/:id/emails/:emailId/sent", async (c) => {
    const claim = await claimOr404(c);
    const draft = await getDoc<EmailDraft>(child(claim.id, "emails").doc(c.req.param("emailId")));
    if (!draft) throw new HTTPException(404, { message: "email not found" });
    await child(claim.id, "emails").doc(draft.id).update({ status: "sent" });
    const tasks = await list<Task>(child(claim.id, "tasks").where("email_draft_id", "==", draft.id).where("status", "==", "open"));
    for (const t of tasks) {
      await closeTask(claim.id, t.id, "done");
      if (t.requirement_id) await child(claim.id, "requirements").doc(t.requirement_id).update({ status: "pending_third_party" });
    }
    await addChat(claim, "event", `📧 נשלח: ${draft.subject}`);
    await runAgent(claim.id, [
      {
        type: "text",
        text: `<app_event type="email_sent" email_draft_id="${draft.id}" purpose="${draft.purpose}">The user sent the email "${draft.subject}".</app_event>`,
      },
    ]);
    return c.json(await claimView((await getClaim(claim.id))!));
  });

  const app = new Hono();
  app.route("/api", api);
  return app;
}

function safeEqual(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function claimOr404(c: Context<Env>): Promise<Claim> {
  const claim = await getClaim(c.req.param("id")!, c.get("user").id);
  if (!claim) throw new HTTPException(404, { message: "claim not found" });
  return claim;
}

async function claimOr404Id(claimId: string, userId: string): Promise<string> {
  if (!(await getClaim(claimId, userId))) throw new HTTPException(404, { message: "claim not found" });
  return claimId;
}

async function taskOr404(c: Context<Env>): Promise<{ task: Task; claim: Claim }> {
  const claim = await claimOr404(c);
  const task = await getDoc<Task>(child(claim.id, "tasks").doc(c.req.param("taskId")!));
  if (!task) throw new HTTPException(404, { message: "task not found" });
  if (task.status !== "open") throw new HTTPException(409, { message: "task is not open" });
  return { task, claim };
}

async function ownedDocuments(userId: string, ids: string[]): Promise<DocumentRow[]> {
  return Promise.all(
    ids.map(async (id) => {
      const doc = await getDoc<DocumentRow>(documents.doc(id));
      if (!doc || doc.user_id !== userId) throw new HTTPException(404, { message: `document ${id} not found` });
      return doc;
    }),
  );
}

async function attachToClaim(docs: DocumentRow[], claimId: string) {
  await Promise.all(docs.filter((d) => d.claim_id == null).map((d) => documents.doc(d.id).update({ claim_id: claimId })));
}
