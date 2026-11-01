import crypto from "node:crypto";
import path from "node:path";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { auth, firestore } from "./firebase";
import { addChat, claimView, closeTask } from "./claims";
import { documentBlocks, type Dispatch } from "./agent/agent";
import { ANALYZABLE_MIME, readDocument } from "./agent/extract";
import { recordUsage } from "./costs";
import { consumeQuota } from "./quota";
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
  israelDayPlus,
  israelMorning,
  type Reminder,
  type Claim,
  type DocumentRow,
  type EmailDraft,
  type Requirement,
  type Task,
  type User,
} from "./store";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Bump when the terms / privacy text changes; users are asked to accept again.
const CONSENT_VERSION = "draft-2026-10";

export interface AppConfig {
  /** Until the product opens up, new users need this code (anyone can sign in with Google). */
  accessCode: () => string;
  /** Hands work to the agent without waiting for it (see Dispatch). */
  dispatch: Dispatch;
}

type Env = { Variables: { uid: string; email: string; user: User } };

const familyMember = z.object({
  name: z.string().min(1).max(100),
  id_number: z.string().max(20).nullable().default(null),
  relation: z.string().max(40).nullable().default(null),
});

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
    return c.json(profileOf(user));
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
    if (existing) await users.doc(uid).set({ email: c.get("email"), ...record }, { merge: true });
    else
      await users.doc(uid).set({
        email: c.get("email"),
        full_name: null,
        id_number: null,
        phone: null,
        bank_details: null,
        family: [],
        created_at: now(),
        ...record,
      });
    return c.json(profileOf((await getUser(uid))!));
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
        // Fields the user hasn't filled in yet come back as null.
        full_name: z.string().max(100).nullish(),
        id_number: z.string().max(20).nullish(),
        phone: z.string().max(30).nullish(),
        bank_details: z.string().max(200).nullish(),
        family: z.array(familyMember).max(12).optional(),
      })
      .parse(await c.req.json());
    await users.doc(c.get("user").id).update(patch);
    return c.json(profileOf((await getUser(c.get("user").id))!));
  });

  /** Deletes the account and everything stored about it. Returns the device files to remove. */
  api.delete("/me", async (c) => {
    const user = c.get("user");
    const mine = await list<Claim>(claims.where("user_id", "==", user.id));
    for (const claim of mine) await firestore.recursiveDelete(claims.doc(claim.id));
    const docs = await list<DocumentRow>(documents.where("user_id", "==", user.id));
    await Promise.all(docs.map((d) => documents.doc(d.id).delete()));
    const usage = await firestore.collection("usage").where("user_id", "==", user.id).get();
    await Promise.all(usage.docs.map((d) => d.ref.delete()));
    await users.doc(user.id).delete();
    await auth.deleteUser(user.id).catch((err) => console.error("deleting auth user failed", err));
    return c.json({ ok: true, storage_refs: docs.map((d) => d.storage_ref) });
  });

  // --- Claims ---

  api.get("/claims", async (c) => {
    const mine = (await list<Claim>(claims.where("user_id", "==", c.get("user").id))).filter((cl) => cl.engaged !== false);
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

  // Hands back an empty claim (reusing one the user opened but never wrote in). The client then
  // opens the claim screen and posts the first message there, so the user watches the agent work.
  api.post("/claims", async (c) => {
    const user = c.get("user");
    const empty = await list<Claim>(claims.where("user_id", "==", user.id).where("engaged", "==", false).limit(1));
    if (empty[0]) return c.json(empty[0]);
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
      engaged: false,
      agent_status: "idle",
      agent_started_at: null,
      created_at: now(),
      updated_at: now(),
    });
    return c.json(claim);
  });

  api.get("/claims/:id", async (c) => c.json(await claimView(await claimOr404(c))));

  /** Corrections the user makes before signing (the agent records these otherwise). */
  api.patch("/claims/:id", async (c) => {
    const claim = await claimOr404(c);
    const patch = z
      .object({
        treatment: z.string().max(200).optional(),
        provider: z.string().max(200).optional(),
        treatment_date: z.string().max(20).optional(),
        policy_number: z.string().max(50).optional(),
        amount: z.number().nonnegative().nullable().optional(),
        patient_name: z.string().max(100).nullable().optional(),
        patient_id_number: z.string().max(20).nullable().optional(),
      })
      .parse(await c.req.json());
    await updateClaim(claim.id, patch);
    return c.json({ ok: true });
  });

  /** Deletes a claim and everything under it. Returns the device files to remove. */
  api.delete("/claims/:id", async (c) => {
    const claim = await claimOr404(c);
    const docs = await list<DocumentRow>(documents.where("user_id", "==", claim.user_id).where("claim_id", "==", claim.id));
    // Reusable documents (ID copy, bank confirmation) belong to the user, not the claim; keep them.
    const owned = docs.filter((d) => !d.reusable);
    await Promise.all([
      ...owned.map((d) => documents.doc(d.id).delete()),
      ...docs.filter((d) => d.reusable).map((d) => documents.doc(d.id).update({ claim_id: null })),
    ]);
    await firestore.recursiveDelete(claims.doc(claim.id));
    return c.json({ ok: true, storage_refs: owned.map((d) => d.storage_ref) });
  });

  api.post("/claims/:id/messages", async (c) => {
    const user = c.get("user");
    const claim = await claimOr404(c);
    const { text, document_ids } = messageInput.parse(await c.req.json());
    const docs = await ownedDocuments(user.id, document_ids);
    if (claim.engaged === false) {
      // The first message is what makes a claim count toward the trial limit.
      if ((await engagedClaimCount(user.id)) >= claimLimit(user)) return c.json({ error: "claim_limit" }, 403);
      await updateClaim(claim.id, { engaged: true });
    }
    await consumeQuota(user.id, "messages");
    await attachToClaim(docs, claim.id);
    const attached = docs.map((d) => `📎 ${d.filename}`).join("\n");
    await addChat(claim, "user", [text, attached].filter(Boolean).join("\n"));
    await config.dispatch(claim.id, [...documentBlocks(docs), { type: "text", text: text || "(the user attached documents)" }]);
    return c.json({ ok: true });
  });

  api.post("/claims/:id/submitted", async (c) => {
    const claim = await claimOr404(c);
    await updateClaim(claim.id, { status: "submitted" });
    const open = await list<Task>(child(claim.id, "tasks").where("status", "==", "open"));
    await Promise.all(open.map((t) => closeTask(claim.id, t.id, "done")));
    await addChat(claim, "event", "🎉 סימנת שהתביעה הוגשה");
    // Insurers take a few weeks; offer a calendar reminder to check the claim's status.
    await add<Reminder>(child(claim.id, "reminders"), {
      user_id: claim.user_id,
      claim_id: claim.id,
      title: `לבדוק סטטוס תביעה: ${claim.title ?? "תביעה"}`,
      details: "לבדוק באזור האישי של חברת הביטוח אם התביעה טופלה או אם נדרשים מסמכים נוספים.",
      due_at: israelMorning(israelDayPlus(21)),
      status: "suggested",
      created_at: now(),
    });
    return c.json({ ok: true });
  });

  /** What the insurer answered. Asking for more documents reopens the claim for the agent. */
  api.post("/claims/:id/outcome", async (c) => {
    const claim = await claimOr404(c);
    const { outcome, amount, note } = z
      .object({
        outcome: z.enum(["approved", "partial", "rejected", "docs_requested"]),
        amount: z.number().nonnegative().nullable().default(null),
        note: z.string().max(1000).default(""),
      })
      .parse(await c.req.json());
    await updateClaim(claim.id, { outcome, outcome_amount: amount, outcome_at: now() });
    const label = {
      approved: `✅ התביעה אושרה${amount != null ? `: ${amount} ₪` : ""}`,
      partial: `🟡 התביעה אושרה חלקית${amount != null ? `: ${amount} ₪` : ""}`,
      rejected: "❌ התביעה נדחתה",
      docs_requested: "📄 חברת הביטוח ביקשה מסמכים נוספים",
    }[outcome];
    await addChat(claim, "event", note ? `${label}\n${note}` : label);
    if (outcome === "docs_requested") {
      await updateClaim(claim.id, { status: "collecting" });
      await config.dispatch(claim.id, [
        {
          type: "text",
          text: `<app_event type="insurer_requested_documents">The insurer asked for more documents after submission. What the user says they asked for: ${note || "(not specified; ask the user)"}. Add the needed requirements, create tasks, and help the user complete and resubmit.</app_event>`,
        },
      ]);
    }
    return c.json({ ok: true });
  });

  // The user added a suggested reminder to their calendar, or declined it.
  api.post("/claims/:id/reminders/:reminderId", async (c) => {
    const claim = await claimOr404(c);
    const { status } = z.object({ status: z.enum(["added", "dismissed"]) }).parse(await c.req.json());
    const ref = child(claim.id, "reminders").doc(c.req.param("reminderId"));
    if (!(await ref.get()).exists) throw new HTTPException(404, { message: "reminder not found" });
    await ref.update({ status });
    return c.json({ ok: true });
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
    await consumeQuota(user.id, "uploads");
    const { storage, storage_ref } = storageInput.parse(body);
    const claimId = typeof body.claim_id === "string" && body.claim_id ? await claimOr404Id(body.claim_id, user.id) : null;

    // We read the file once to extract its details; it is never stored on the server.
    let analysis = null;
    try {
      const reads = await readDocument(Buffer.from(await file.arrayBuffer()), file.type);
      analysis = reads.at(-1)!.analysis;
      await Promise.all(reads.map((r) => recordUsage({ userId: user.id, claimId, model: r.model, usage: r.usage })));
    } catch (err) {
      console.error("document analysis failed", err);
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

  /** Removes a document; requirements it satisfied go back to missing. Returns the device file to remove. */
  api.delete("/documents/:id", async (c) => {
    const user = c.get("user");
    const [doc] = await ownedDocuments(user.id, [c.req.param("id")]);
    if (doc.claim_id) {
      const claim = (await getClaim(doc.claim_id, user.id))!;
      const linked = await list<Requirement>(child(claim.id, "requirements").where("document_id", "==", doc.id));
      await Promise.all(linked.map((r) => child(claim.id, "requirements").doc(r.id).update({ status: "missing", document_id: null })));
      await addChat(claim, "event", `🗑 הוסר מסמך: ${doc.filename}`);
      if (linked.length > 0) {
        await config.dispatch(claim.id, [
          {
            type: "text",
            text: `<app_event type="document_removed" document_id="${doc.id}">The user removed the document "${doc.filename}". These requirements are missing again: ${linked.map((r) => r.title).join(", ")}.</app_event>`,
          },
        ]);
      }
    }
    await documents.doc(doc.id).delete();
    return c.json({ ok: true, storage_ref: doc.storage_ref });
  });

  /** The user swapped the document behind a requirement; the agent checks the new one. */
  api.post("/claims/:id/requirements/:requirementId/replace", async (c) => {
    const user = c.get("user");
    const claim = await claimOr404(c);
    const requirement = await getDoc<Requirement>(child(claim.id, "requirements").doc(c.req.param("requirementId")));
    if (!requirement) throw new HTTPException(404, { message: "requirement not found" });
    const { document_id } = z.object({ document_id: z.string() }).parse(await c.req.json());
    const docs = await ownedDocuments(user.id, [document_id]);
    await attachToClaim(docs, claim.id);
    await child(claim.id, "requirements").doc(requirement.id).update({ status: "missing", document_id: null });
    await addChat(claim, "event", `🔄 הוחלף מסמך: ${requirement.title}`);
    await config.dispatch(claim.id, [
      ...documentBlocks(docs),
      {
        type: "text",
        text: `<app_event type="document_replaced" requirement_id="${requirement.id}">The user replaced the document for "${requirement.title}" with the one above. Check it and attach it if it fits.</app_event>`,
      },
    ]);
    return c.json({ ok: true });
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
    await config.dispatch(claim.id, [
      ...documentBlocks(docs),
      {
        type: "text",
        text: `<app_event type="task_completed" task_id="${task.id}">The user completed the task "${task.title}".${
          docs.length ? " The attached documents are above." : ""
        }${note ? ` User note: ${note}` : ""}</app_event>`,
      },
    ]);
    return c.json({ ok: true });
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
    await config.dispatch(claim.id, [
      {
        type: "text",
        text: `<app_event type="signature_added" task_id="${task.id}" document_id="${doc.id}">The user signed. The linked requirement is now done.</app_event>`,
      },
    ]);
    return c.json({ ok: true });
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
    await config.dispatch(claim.id, [
      {
        type: "text",
        text: `<app_event type="email_sent" email_draft_id="${draft.id}" purpose="${draft.purpose}">The user sent the email "${draft.subject}".</app_event>`,
      },
    ]);
    return c.json({ ok: true });
  });

  // --- Admin (emails listed in ADMIN_EMAILS) ---

  const admin = new Hono<Env>();
  admin.use("*", async (c, next) => {
    if (!isAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  admin.get("/overview", async (c) => {
    const [allUsers, allClaims] = await Promise.all([list<User>(users), list<Claim>(claims)]);
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    const today = (await firestore.collection("usage").doc(`_all_${day}`).get()).data() ?? {};
    const byUser = new Map<string, Claim[]>();
    for (const cl of allClaims) byUser.set(cl.user_id, [...(byUser.get(cl.user_id) ?? []), cl]);
    const rows = allUsers
      .map((u) => {
        const theirs = (byUser.get(u.id) ?? []).filter((cl) => cl.engaged !== false);
        return {
          id: u.id,
          email: u.email,
          full_name: u.full_name,
          created_at: u.created_at,
          claim_limit: claimLimit(u),
          claims: theirs.length,
          submitted: theirs.filter((cl) => cl.status === "submitted").length,
          approved_total: theirs.reduce((s, cl) => s + (cl.outcome_amount ?? 0), 0),
          cost_usd: u.cost_usd ?? 0,
          last_activity: theirs.map((cl) => cl.updated_at).sort().at(-1) ?? null,
        };
      })
      .sort((a, b) => (b.last_activity ?? b.created_at).localeCompare(a.last_activity ?? a.created_at));
    const engaged = allClaims.filter((cl) => cl.engaged !== false);
    return c.json({
      totals: {
        users: allUsers.length,
        claims: engaged.length,
        submitted: engaged.filter((cl) => cl.status === "submitted").length,
        with_outcome: engaged.filter((cl) => cl.outcome).length,
        cost_usd: allUsers.reduce((s, u) => s + (u.cost_usd ?? 0), 0),
        avg_cost_per_claim: engaged.length ? engaged.reduce((s, cl) => s + (cl.cost_usd ?? 0), 0) / engaged.length : 0,
        today_messages: (today.messages as number | undefined) ?? 0,
        today_uploads: (today.uploads as number | undefined) ?? 0,
      },
      users: rows,
    });
  });

  admin.post("/users/:uid", async (c) => {
    const { claim_limit } = z.object({ claim_limit: z.number().int().min(0).max(1000) }).parse(await c.req.json());
    const ref = users.doc(c.req.param("uid"));
    if (!(await ref.get()).exists) throw new HTTPException(404, { message: "user not found" });
    await ref.update({ claim_limit });
    return c.json({ ok: true });
  });

  api.route("/admin", admin);

  const app = new Hono();
  app.route("/api", api);
  return app;
}

/**
 * How many claims a user may open. FREE_CLAIM_LIMIT applies to everyone; a `claim_limit` field on
 * the user's document (set from the admin screen, e.g. after a paid arrangement) overrides it.
 */
function claimLimit(user: User): number {
  return user.claim_limit ?? Number(process.env.FREE_CLAIM_LIMIT ?? 1);
}

/** Claims that count toward the limit: all of the user's claims except empty ones (engaged: false). */
async function engagedClaimCount(userId: string): Promise<number> {
  const [all, empty] = await Promise.all([
    claims.where("user_id", "==", userId).count().get(),
    claims.where("user_id", "==", userId).where("engaged", "==", false).count().get(),
  ]);
  return all.data().count - empty.data().count;
}

function isAdmin(user: User): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}

/** What the client gets for the signed-in user. */
function profileOf(user: User) {
  return { ...user, family: user.family ?? [], claim_limit: claimLimit(user), is_admin: isAdmin(user) };
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
