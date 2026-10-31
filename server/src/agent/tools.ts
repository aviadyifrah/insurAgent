import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { closeTask, createTask } from "../claims";
import { findTemplate, templateById, templates } from "../knowledge";
import {
  add,
  child,
  claimDocuments,
  documents,
  getClaim,
  getDoc,
  getUser,
  list,
  requirementsOf,
  updateClaim,
  users,
  now,
  israelDayPlus,
  israelMorning,
  type Reminder,
  type Claim,
  type DocumentRow,
  type EmailDraft,
  type Requirement,
  type Task,
  type User,
} from "../store";

export interface ToolContext {
  claim: Claim;
  user: User;
}

interface AgentTool<S extends z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => unknown | Promise<unknown>;
}

const tool = <S extends z.ZodObject>(t: AgentTool<S>) => t;

const ok = (extra: Record<string, unknown> = {}) => ({ ok: true, ...extra });

const id = z.string().min(1);

async function requirementOf(ctx: ToolContext, requirementId: string): Promise<Requirement> {
  const r = await getDoc<Requirement>(child(ctx.claim.id, "requirements").doc(requirementId));
  if (!r) throw new Error(`requirement ${requirementId} not found in this claim`);
  return r;
}

async function documentOf(ctx: ToolContext, documentId: string): Promise<DocumentRow> {
  const d = (await claimDocuments(ctx.claim)).find((doc) => doc.id === documentId);
  if (!d) throw new Error(`document ${documentId} is not available to this claim`);
  return d;
}

const tools = [
  tool({
    name: "update_claim_details",
    description:
      "Record or correct facts about the claim extracted from the conversation or documents. Only pass fields you actually know; never guess.",
    schema: z.object({
      title: z.string().optional().describe("Short Hebrew title for the claims list, e.g. 'טיפול שורש — הראל'"),
      treatment: z.string().optional(),
      provider: z.string().optional().describe("Clinic / doctor name"),
      provider_email: z.string().optional(),
      treatment_date: z.string().optional().describe("YYYY-MM-DD"),
      insurer: z.string().optional().describe("Insurer display name in Hebrew, e.g. 'הראל'"),
      insurer_key: z.string().optional().describe("Lowercase key: harel, migdal, clal, menora, phoenix, ayalon, clalit_mushlam, maccabi_sheli, meuhedet_adif, leumit_zahav"),
      policy_number: z.string().optional(),
      claim_type: z.string().optional().describe("dental | optics | paramedical | consultation | other"),
      amount: z.number().optional().describe("Amount paid in ILS"),
    }),
    run: async (input, ctx) => {
      await updateClaim(ctx.claim.id, input);
      return ok();
    },
  }),

  tool({
    name: "load_requirements_template",
    description:
      "Load the document checklist for this claim from the knowledge base by insurer_key + claim_type. Creates the requirement items. If no specific template exists, returns the available templates; then load template_id 'generic-health' and adapt it with add_requirement / update_requirement(not_needed).",
    schema: z.object({
      insurer_key: z.string().optional(),
      claim_type: z.string().optional(),
      template_id: z.string().optional().describe("Load a template by id instead, e.g. 'generic-health'"),
    }),
    run: async (input, ctx) => {
      if ((await requirementsOf(ctx.claim.id)).length > 0) return { ok: false, error: "requirements already loaded for this claim" };
      const tpl = input.template_id
        ? templateById(input.template_id)
        : input.insurer_key && input.claim_type
          ? findTemplate(input.insurer_key, input.claim_type)
          : undefined;
      if (!tpl) {
        return {
          ok: false,
          error: "no matching template",
          available: templates.map((t) => ({ id: t.id, insurer_key: t.insurer_key, claim_type: t.claim_type })),
        };
      }
      const batch = child(ctx.claim.id, "requirements").firestore.batch();
      tpl.requirements.forEach((r, i) =>
        batch.create(child(ctx.claim.id, "requirements").doc(), {
          user_id: ctx.claim.user_id,
          claim_id: ctx.claim.id,
          key: r.key,
          title: r.title,
          description: r.description,
          required: r.required !== false,
          needs_signature: !!r.needs_signature,
          status: "missing",
          document_id: null,
          note: null,
          sort: i,
        } satisfies Omit<Requirement, "id">),
      );
      await batch.commit();
      await updateClaim(ctx.claim.id, { template_id: tpl.id });
      return ok({
        template: tpl.id,
        verified: tpl.verified,
        submission: tpl.submission,
        requirements: (await requirementsOf(ctx.claim.id)).map(({ id, key, title, description, required, needs_signature }) => ({
          id,
          key,
          title,
          description,
          required,
          needs_signature,
        })),
      });
    },
  }),

  tool({
    name: "add_requirement",
    description: "Add a document requirement that the template does not cover.",
    schema: z.object({
      title: z.string(),
      description: z.string(),
      required: z.boolean().default(true),
      needs_signature: z.boolean().default(false),
    }),
    run: async (input, ctx) => {
      const r = await add<Requirement>(child(ctx.claim.id, "requirements"), {
        user_id: ctx.claim.user_id,
        claim_id: ctx.claim.id,
        key: null,
        title: input.title,
        description: input.description,
        required: input.required,
        needs_signature: input.needs_signature,
        status: "missing",
        document_id: null,
        note: null,
        sort: 100,
      });
      return ok({ requirement_id: r.id });
    },
  }),

  tool({
    name: "update_requirement",
    description:
      "Update a requirement's status. Attach a document when you have verified it satisfies the requirement (status 'done'). Use 'not_needed' for optional items that don't apply. Use 'pending_third_party' when waiting on the clinic.",
    schema: z.object({
      requirement_id: id,
      status: z.enum(["missing", "pending_user", "pending_third_party", "done", "not_needed"]),
      document_id: id.optional(),
      note: z.string().optional().describe("Short Hebrew note shown to the user, e.g. why it is not needed"),
    }),
    run: async (input, ctx) => {
      await requirementOf(ctx, input.requirement_id);
      if (input.document_id) await documentOf(ctx, input.document_id);
      await child(ctx.claim.id, "requirements").doc(input.requirement_id).update({
        status: input.status,
        document_id: input.document_id,
        note: input.note,
      });
      // A satisfied requirement no longer needs the user's open task.
      if (input.status === "done" || input.status === "not_needed") {
        const open = await list<Task>(
          child(ctx.claim.id, "tasks").where("requirement_id", "==", input.requirement_id).where("status", "==", "open"),
        );
        await Promise.all(open.map((t) => closeTask(ctx.claim.id, t.id, "done")));
      }
      await updateClaim(ctx.claim.id, {});
      return ok();
    },
  }),

  tool({
    name: "tag_document",
    description:
      "Classify a document after you have looked at it. Mark identity / bank documents reusable so future claims reuse them without asking again.",
    schema: z.object({
      document_id: id,
      kind: z.string().describe("receipt | treatment_details | id_copy | bank_confirmation | xray | medical_document | other"),
      reusable: z.boolean().default(false),
    }),
    run: async (input, ctx) => {
      await documentOf(ctx, input.document_id);
      await documents.doc(input.document_id).update({ kind: input.kind, reusable: input.reusable });
      return ok();
    },
  }),

  tool({
    name: "get_user_profile",
    description: "Read the user's saved personal details (needed for the claim form).",
    schema: z.object({}),
    run: async (_input, ctx) => {
      const u = (await getUser(ctx.user.id))!;
      return { full_name: u.full_name, id_number: u.id_number, phone: u.phone, email: u.email, bank_details: u.bank_details };
    },
  }),

  tool({
    name: "update_user_profile",
    description: "Save personal details the user told you, so they are reused in every claim.",
    schema: z.object({
      full_name: z.string().optional(),
      id_number: z.string().optional(),
      phone: z.string().optional(),
      bank_details: z.string().optional().describe("Bank, branch and account number as one string"),
    }),
    run: async (input, ctx) => {
      await users.doc(ctx.user.id).update(input);
      return ok();
    },
  }),

  tool({
    name: "create_task",
    description:
      "Create a task for the user when you cannot get something yourself. The app reminds the user until it is done. Keep instructions short, concrete, and in Hebrew. Do not create a task that duplicates an open one. For signatures use type 'sign' linked to the requirement that needs it. For sending an email use draft_email with create_send_task instead.",
    schema: z.object({
      type: z.enum(["upload", "sign", "action"]),
      title: z.string().describe("Short Hebrew title, e.g. 'צלם את תעודת הזהות'"),
      instructions: z.string().describe("1-3 short Hebrew sentences: exactly what to do"),
      requirement_id: id.optional(),
    }),
    run: async (input, ctx) => {
      if (input.requirement_id) await requirementOf(ctx, input.requirement_id);
      const task = await createTask(ctx.claim, {
        type: input.type,
        title: input.title,
        instructions: input.instructions,
        requirementId: input.requirement_id,
      });
      return ok({ task_id: task.id });
    },
  }),

  tool({
    name: "cancel_task",
    description: "Cancel an open task that is no longer relevant.",
    schema: z.object({ task_id: id, reason: z.string() }),
    run: async (input, ctx) => {
      const t = await getDoc<Task>(child(ctx.claim.id, "tasks").doc(input.task_id));
      if (!t) throw new Error(`task ${input.task_id} not found`);
      await closeTask(ctx.claim.id, t.id, "cancelled");
      return ok();
    },
  }),

  tool({
    name: "draft_email",
    description:
      "Prepare an email for the user to send from their own mailbox: a document request to the clinic, or the claim submission to the insurer. Write it in Hebrew, polite and short, signed with the user's name. Never invent an address; leave 'to' empty if unknown and say so in the task.",
    schema: z.object({
      purpose: z.enum(["request_documents", "submit_claim", "other"]),
      to: z.string().optional(),
      subject: z.string(),
      body: z.string(),
      attachment_document_ids: z.array(id).default([]),
      requirement_ids: z
        .array(id)
        .default([])
        .describe("Requirements this email will obtain; they are marked pending_third_party once the user sends it"),
      create_send_task: z.boolean().default(true),
    }),
    run: async (input, ctx) => {
      await Promise.all(input.attachment_document_ids.map((d) => documentOf(ctx, d)));
      await Promise.all(input.requirement_ids.map((r) => requirementOf(ctx, r)));
      const draft = await add<EmailDraft>(child(ctx.claim.id, "emails"), {
        user_id: ctx.claim.user_id,
        claim_id: ctx.claim.id,
        purpose: input.purpose,
        to_address: input.to ?? null,
        subject: input.subject,
        body: input.body,
        attachment_ids: input.attachment_document_ids,
        status: "draft",
        created_at: now(),
      });
      let taskId: string | undefined;
      if (input.create_send_task) {
        const title = input.purpose === "submit_claim" ? "שלח את התביעה" : `שלח מייל: ${input.subject}`;
        taskId = (
          await createTask(ctx.claim, {
            type: "send_email",
            title,
            instructions: "המייל מוכן. פתח אותו, בדוק ולחץ שלח מהמייל שלך.",
            emailDraftId: draft.id,
            requirementId: input.requirement_ids.length === 1 ? input.requirement_ids[0] : null,
          })
        ).id;
      }
      return ok({ email_draft_id: draft.id, task_id: taskId });
    },
  }),

  tool({
    name: "suggest_reminder",
    description:
      "Offer the user a reminder they can add to their own phone calendar with one tap (the app shows a card with calendar buttons; the app itself does not send reminders). It is set for 09:00 Israel time on the chosen day; the user can change the time in their calendar. Use when the user asks to be reminded, or at a natural follow-up moment (see the system prompt). Don't offer a reminder that duplicates a pending or dismissed one in claim_state.",
    schema: z.object({
      title: z.string().describe("Short Hebrew calendar title, e.g. 'לבדוק אם המרפאה שלחה פירוט טיפולים'"),
      details: z.string().optional().describe("One Hebrew sentence of context for the calendar entry"),
      days_from_now: z.number().int().min(1).max(180).optional(),
      date: z.string().optional().describe("YYYY-MM-DD; use instead of days_from_now for a specific day"),
    }),
    run: async (input, ctx) => {
      const day = input.date ?? (input.days_from_now ? israelDayPlus(input.days_from_now) : undefined);
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("give days_from_now or a YYYY-MM-DD date");
      const reminder = await add<Reminder>(child(ctx.claim.id, "reminders"), {
        user_id: ctx.claim.user_id,
        claim_id: ctx.claim.id,
        title: input.title,
        details: input.details ?? null,
        due_at: israelMorning(day),
        status: "suggested",
        created_at: now(),
      });
      return ok({ reminder_id: reminder.id, day, time: "09:00" });
    },
  }),

  tool({
    name: "prepare_submission_package",
    description:
      "Mark the claim ready once every required requirement is 'done' or 'not_needed'. The app then lets the user download the submission PDF (signed claim form + all attached documents), built on their device. Returns what is still missing otherwise.",
    schema: z.object({}),
    run: async (_input, ctx) => {
      const reqs = await requirementsOf(ctx.claim.id);
      if (reqs.length === 0) return { ok: false, error: "no requirements loaded" };
      const missing = reqs.filter((r) => r.required && r.status !== "done" && r.status !== "not_needed");
      if (missing.length > 0) return { ok: false, missing: missing.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
      await updateClaim(ctx.claim.id, { status: "ready" });
      const tpl = ctx.claim.template_id ? templateById(ctx.claim.template_id) : undefined;
      return ok({ submission: tpl?.submission ?? null });
    },
  }),
];

export const toolDefinitions: Anthropic.Beta.BetaTool[] = tools.map((t) => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
  };
});

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { content: `unknown tool ${name}`, isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { content: `invalid input: ${parsed.error.message}`, isError: true };
  try {
    // Each tool sees the claim as it is now, not as it was when the turn started.
    const claim = (await getClaim(ctx.claim.id))!;
    const result = await (t.run as (i: unknown, c: ToolContext) => unknown)(parsed.data, { ...ctx, claim });
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
