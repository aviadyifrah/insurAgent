import {
  add,
  chatOf,
  child,
  claimDocuments,
  emailsOf,
  getUser,
  now,
  requirementsOf,
  tasksOf,
  type ChatMessage,
  type Claim,
  type Task,
} from "./store";

// Reminder escalation: 1, 3, 7 units after creation, then every 7. One unit is a day unless
// REMINDER_UNIT_MS is set (e.g. 60000 to watch the nagging happen in minutes during development).
const REMINDER_UNIT_MS = Number(process.env.REMINDER_UNIT_MS ?? 24 * 60 * 60 * 1000);
const REMINDER_STEPS = [1, 3, 7];

export function nextReminderAt(reminderCount: number, from = Date.now()): string {
  const step = REMINDER_STEPS[reminderCount] ?? REMINDER_STEPS[REMINDER_STEPS.length - 1];
  return new Date(from + step * REMINDER_UNIT_MS).toISOString();
}

export async function createTask(
  claim: Claim,
  t: {
    type: Task["type"];
    title: string;
    instructions: string;
    requirementId?: string | null;
    emailDraftId?: string | null;
  },
): Promise<Task> {
  const task = await add<Task>(child(claim.id, "tasks"), {
    user_id: claim.user_id,
    claim_id: claim.id,
    requirement_id: t.requirementId ?? null,
    email_draft_id: t.emailDraftId ?? null,
    type: t.type,
    title: t.title,
    instructions: t.instructions,
    status: "open",
    reminder_count: 0,
    next_reminder_at: nextReminderAt(0),
    last_reminded_at: null,
    created_at: now(),
    completed_at: null,
  });
  if (t.requirementId) await child(claim.id, "requirements").doc(t.requirementId).update({ status: "pending_user" });
  return task;
}

export async function closeTask(claimId: string, taskId: string, status: "done" | "cancelled") {
  await child(claimId, "tasks").doc(taskId).update({ status, completed_at: now(), next_reminder_at: null });
}

export async function addChat(claim: Claim, role: ChatMessage["role"], text: string) {
  await add<ChatMessage>(child(claim.id, "chat"), { user_id: claim.user_id, claim_id: claim.id, role, text, created_at: now() });
}

/** Full payload for the claim screen (the client also listens to Firestore for live updates). */
export async function claimView(claim: Claim) {
  const [requirements, tasks, emails, documents, chat] = await Promise.all([
    requirementsOf(claim.id),
    tasksOf(claim.id),
    emailsOf(claim.id),
    claimDocuments(claim),
    chatOf(claim.id),
  ]);
  return { claim, requirements, tasks, emails, documents, chat };
}

/** Compact state the agent sees at the start of every turn. */
export async function claimSnapshot(claim: Claim): Promise<string> {
  const [user, v] = await Promise.all([getUser(claim.user_id), claimView(claim)]);
  const state = {
    today: now().slice(0, 10),
    claim: {
      title: claim.title,
      treatment: claim.treatment,
      provider: claim.provider,
      provider_email: claim.provider_email,
      treatment_date: claim.treatment_date,
      insurer: claim.insurer,
      insurer_key: claim.insurer_key,
      policy_number: claim.policy_number,
      claim_type: claim.claim_type,
      amount: claim.amount,
      template_id: claim.template_id,
      status: claim.status,
    },
    profile_complete: {
      full_name: !!user?.full_name,
      id_number: !!user?.id_number,
      phone: !!user?.phone,
      bank_details: !!user?.bank_details,
    },
    requirements: v.requirements.map((r) => ({
      id: r.id,
      title: r.title,
      required: r.required,
      needs_signature: r.needs_signature,
      status: r.status,
      document_id: r.document_id,
      note: r.note,
    })),
    open_tasks: v.tasks
      .filter((t) => t.status === "open")
      .map((t) => ({ id: t.id, type: t.type, title: t.title, requirement_id: t.requirement_id, reminders_sent: t.reminder_count })),
    email_drafts: v.emails.map((e) => ({ id: e.id, purpose: e.purpose, to: e.to_address, subject: e.subject, status: e.status })),
    documents: v.documents.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, reusable: d.reusable, from_this_claim: d.claim_id === claim.id })),
  };
  return `<claim_state>\n${JSON.stringify(state, null, 1)}\n</claim_state>`;
}
