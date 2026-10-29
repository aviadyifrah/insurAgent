import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { all, get, run, update, type Claim, type DocumentRow, type Requirement, type Task, type User } from "../db";
import { claimDocuments, closeTask, createTask, touchClaim } from "../claims";
import { findTemplate, templateById, templates } from "../knowledge";
import { buildPackage } from "../pdf";

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

function requirementOf(ctx: ToolContext, id: number): Requirement {
  const r = get<Requirement>("SELECT * FROM requirements WHERE id = ? AND claim_id = ?", id, ctx.claim.id);
  if (!r) throw new Error(`requirement ${id} not found in this claim`);
  return r;
}

function documentOf(ctx: ToolContext, id: number): DocumentRow {
  const d = claimDocuments(ctx.claim).find((doc) => doc.id === id);
  if (!d) throw new Error(`document ${id} is not available to this claim`);
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
    run: (input, ctx) => {
      update("claims", ctx.claim.id, { ...input, updated_at: new Date().toISOString() });
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
    run: (input, ctx) => {
      const existing = all<Requirement>("SELECT * FROM requirements WHERE claim_id = ?", ctx.claim.id);
      if (existing.length > 0) return { ok: false, error: "requirements already loaded for this claim" };
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
      tpl.requirements.forEach((r, i) =>
        run(
          "INSERT INTO requirements (claim_id, key, title, description, required, needs_signature, sort) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ctx.claim.id,
          r.key,
          r.title,
          r.description,
          r.required === false ? 0 : 1,
          r.needs_signature ? 1 : 0,
          i,
        ),
      );
      update("claims", ctx.claim.id, { template_id: tpl.id });
      return ok({
        template: tpl.id,
        verified: tpl.verified,
        submission: tpl.submission,
        requirements: all<Requirement>("SELECT id, key, title, description, required, needs_signature FROM requirements WHERE claim_id = ?", ctx.claim.id),
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
    run: (input, ctx) => {
      const id = run(
        "INSERT INTO requirements (claim_id, title, description, required, needs_signature, sort) VALUES (?, ?, ?, ?, ?, 100)",
        ctx.claim.id,
        input.title,
        input.description,
        input.required ? 1 : 0,
        input.needs_signature ? 1 : 0,
      );
      return ok({ requirement_id: id });
    },
  }),

  tool({
    name: "update_requirement",
    description:
      "Update a requirement's status. Attach a document when you have verified it satisfies the requirement (status 'done'). Use 'not_needed' for optional items that don't apply. Use 'pending_third_party' when waiting on the clinic.",
    schema: z.object({
      requirement_id: z.number().int(),
      status: z.enum(["missing", "pending_user", "pending_third_party", "done", "not_needed"]),
      document_id: z.number().int().optional(),
      note: z.string().optional().describe("Short Hebrew note shown to the user, e.g. why it is not needed"),
    }),
    run: (input, ctx) => {
      requirementOf(ctx, input.requirement_id);
      if (input.document_id) documentOf(ctx, input.document_id);
      update("requirements", input.requirement_id, {
        status: input.status,
        document_id: input.document_id,
        note: input.note,
      });
      // A satisfied requirement no longer needs the user's open task.
      if (input.status === "done" || input.status === "not_needed") {
        for (const t of all<Task>("SELECT * FROM tasks WHERE requirement_id = ? AND status = 'open'", input.requirement_id)) {
          closeTask(t.id, "done");
        }
      }
      touchClaim(ctx.claim.id);
      return ok();
    },
  }),

  tool({
    name: "tag_document",
    description:
      "Classify a document after you have looked at it. Mark identity / bank documents reusable so future claims reuse them without asking again.",
    schema: z.object({
      document_id: z.number().int(),
      kind: z.string().describe("receipt | treatment_details | id_copy | bank_confirmation | xray | medical_document | other"),
      reusable: z.boolean().default(false),
    }),
    run: (input, ctx) => {
      documentOf(ctx, input.document_id);
      update("documents", input.document_id, { kind: input.kind, reusable: input.reusable ? 1 : 0 });
      return ok();
    },
  }),

  tool({
    name: "get_user_profile",
    description: "Read the user's saved personal details (needed for the claim form).",
    schema: z.object({}),
    run: (_input, ctx) => {
      const u = get<User>("SELECT * FROM users WHERE id = ?", ctx.user.id)!;
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
    run: (input, ctx) => {
      update("users", ctx.user.id, input);
      return ok();
    },
  }),

  tool({
    name: "search_email",
    description:
      "Search the user's mailbox for documents (e.g. a receipt emailed by the clinic). Returns matching messages with attachments.",
    schema: z.object({
      query: z.string().describe("Gmail-style query, e.g. 'from:smile receipt after:2026/09/01'"),
    }),
    // Mailbox integration (Gmail OAuth, read-only) is not wired up yet.
    run: () => ({
      connected: false,
      message: "The user's mailbox is not connected yet. Ask the user to upload the document or create a task.",
    }),
  }),

  tool({
    name: "create_task",
    description:
      "Create a task for the user when you cannot get something yourself. The app reminds the user until it is done. Keep instructions short, concrete, and in Hebrew. Do not create a task that duplicates an open one. For signatures use type 'sign' linked to the requirement that needs it. For sending an email use draft_email with create_send_task instead.",
    schema: z.object({
      type: z.enum(["upload", "sign", "action"]),
      title: z.string().describe("Short Hebrew title, e.g. 'צלם את תעודת הזהות'"),
      instructions: z.string().describe("1-3 short Hebrew sentences: exactly what to do"),
      requirement_id: z.number().int().optional(),
    }),
    run: (input, ctx) => {
      if (input.requirement_id) requirementOf(ctx, input.requirement_id);
      const task = createTask({
        claimId: ctx.claim.id,
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
    schema: z.object({ task_id: z.number().int(), reason: z.string() }),
    run: (input, ctx) => {
      const t = get<Task>("SELECT * FROM tasks WHERE id = ? AND claim_id = ?", input.task_id, ctx.claim.id);
      if (!t) throw new Error(`task ${input.task_id} not found`);
      closeTask(t.id, "cancelled");
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
      attachment_document_ids: z.array(z.number().int()).default([]),
      requirement_ids: z
        .array(z.number().int())
        .default([])
        .describe("Requirements this email will obtain; they are marked pending_third_party once the user sends it"),
      create_send_task: z.boolean().default(true),
    }),
    run: (input, ctx) => {
      input.attachment_document_ids.forEach((id) => documentOf(ctx, id));
      input.requirement_ids.forEach((id) => requirementOf(ctx, id));
      const draftId = run(
        "INSERT INTO email_drafts (claim_id, purpose, to_address, subject, body, attachment_ids) VALUES (?, ?, ?, ?, ?, ?)",
        ctx.claim.id,
        input.purpose,
        input.to ?? null,
        input.subject,
        input.body,
        JSON.stringify(input.attachment_document_ids),
      );
      let taskId: number | undefined;
      if (input.create_send_task) {
        const title = input.purpose === "submit_claim" ? "שלח את התביעה" : `שלח מייל: ${input.subject}`;
        taskId = createTask({
          claimId: ctx.claim.id,
          type: "send_email",
          title,
          instructions: "המייל מוכן. פתח אותו, בדוק ולחץ שלח מהמייל שלך.",
          emailDraftId: draftId,
          requirementId: input.requirement_ids.length === 1 ? input.requirement_ids[0] : null,
        }).id;
      }
      return ok({ email_draft_id: draftId, task_id: taskId });
    },
  }),

  tool({
    name: "prepare_submission_package",
    description:
      "Build the final submission PDF (signed claim form + all attached documents) once every required requirement is 'done' or 'not_needed'. Returns what is still missing otherwise.",
    schema: z.object({}),
    run: async (_input, ctx) => {
      const reqs = all<Requirement>("SELECT * FROM requirements WHERE claim_id = ?", ctx.claim.id);
      if (reqs.length === 0) return { ok: false, error: "no requirements loaded" };
      const missing = reqs.filter((r) => r.required && r.status !== "done" && r.status !== "not_needed");
      if (missing.length > 0) return { ok: false, missing: missing.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
      const claim = get<Claim>("SELECT * FROM claims WHERE id = ?", ctx.claim.id)!;
      const doc = await buildPackage(claim);
      const tpl = claim.template_id ? templateById(claim.template_id) : undefined;
      return ok({ package_document_id: doc.id, submission: tpl?.submission ?? null });
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
    const claim = get<Claim>("SELECT * FROM claims WHERE id = ?", ctx.claim.id)!;
    const result = await (t.run as (i: unknown, c: ToolContext) => unknown)(parsed.data, { ...ctx, claim });
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
