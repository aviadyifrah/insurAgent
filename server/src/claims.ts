import {
  all,
  get,
  run,
  update,
  type ChatMessage,
  type Claim,
  type DocumentRow,
  type EmailDraft,
  type Requirement,
  type Task,
  type User,
} from "./db";

// Reminder escalation: 1, 3, 7 units after creation, then every 7. One unit is a day unless
// REMINDER_UNIT_MS is set (e.g. 60000 to watch the nagging happen in minutes during development).
const REMINDER_UNIT_MS = Number(process.env.REMINDER_UNIT_MS ?? 24 * 60 * 60 * 1000);
const REMINDER_STEPS = [1, 3, 7];

export function nextReminderAt(reminderCount: number, from = Date.now()): string {
  const step = REMINDER_STEPS[reminderCount] ?? REMINDER_STEPS[REMINDER_STEPS.length - 1];
  return new Date(from + step * REMINDER_UNIT_MS).toISOString();
}

export function createTask(t: {
  claimId: number;
  type: Task["type"];
  title: string;
  instructions: string;
  requirementId?: number | null;
  emailDraftId?: number | null;
}): Task {
  const id = run(
    `INSERT INTO tasks (claim_id, requirement_id, email_draft_id, type, title, instructions, next_reminder_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    t.claimId,
    t.requirementId ?? null,
    t.emailDraftId ?? null,
    t.type,
    t.title,
    t.instructions,
    nextReminderAt(0),
  );
  if (t.requirementId) update("requirements", t.requirementId, { status: "pending_user" });
  return get<Task>("SELECT * FROM tasks WHERE id = ?", id)!;
}

export function closeTask(taskId: number, status: "done" | "cancelled") {
  update("tasks", taskId, { status, completed_at: new Date().toISOString(), next_reminder_at: null });
}

export function addChat(claimId: number, role: ChatMessage["role"], text: string) {
  run("INSERT INTO chat_messages (claim_id, role, text) VALUES (?, ?, ?)", claimId, role, text);
}

export function touchClaim(claimId: number) {
  update("claims", claimId, { updated_at: new Date().toISOString() });
}

export function getClaim(claimId: number, userId: number): Claim | undefined {
  return get<Claim>("SELECT * FROM claims WHERE id = ? AND user_id = ?", claimId, userId);
}

/** Documents visible to a claim: its own plus the user's reusable ones from other claims. */
export function claimDocuments(claim: Claim): DocumentRow[] {
  return all<DocumentRow>(
    "SELECT * FROM documents WHERE claim_id = ? OR (user_id = ? AND reusable = 1) ORDER BY id",
    claim.id,
    claim.user_id,
  );
}

/** Full payload for the claim screen. */
export function claimView(claim: Claim) {
  return {
    claim,
    requirements: all<Requirement>("SELECT * FROM requirements WHERE claim_id = ? ORDER BY sort, id", claim.id),
    tasks: all<Task>("SELECT * FROM tasks WHERE claim_id = ? ORDER BY status = 'open' DESC, id", claim.id),
    emails: all<EmailDraft>("SELECT * FROM email_drafts WHERE claim_id = ? ORDER BY id", claim.id).map((e) => ({
      ...e,
      attachment_ids: JSON.parse(e.attachment_ids) as number[],
    })),
    documents: claimDocuments(claim).map((d) => ({ ...d, analysis: d.analysis ? JSON.parse(d.analysis) : null })),
    chat: all<ChatMessage>("SELECT * FROM chat_messages WHERE claim_id = ? ORDER BY id", claim.id),
  };
}

/** Compact state the agent sees at the start of every turn. */
export function claimSnapshot(claim: Claim): string {
  const user = get<User>("SELECT * FROM users WHERE id = ?", claim.user_id)!;
  const v = claimView(claim);
  const state = {
    today: new Date().toISOString().slice(0, 10),
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
      full_name: !!user.full_name,
      id_number: !!user.id_number,
      phone: !!user.phone,
      bank_details: !!user.bank_details,
    },
    requirements: v.requirements.map((r) => ({
      id: r.id,
      title: r.title,
      required: !!r.required,
      needs_signature: !!r.needs_signature,
      status: r.status,
      document_id: r.document_id,
      note: r.note,
    })),
    open_tasks: v.tasks
      .filter((t) => t.status === "open")
      .map((t) => ({ id: t.id, type: t.type, title: t.title, requirement_id: t.requirement_id, reminders_sent: t.reminder_count })),
    email_drafts: v.emails.map((e) => ({ id: e.id, purpose: e.purpose, to: e.to_address, subject: e.subject, status: e.status })),
    documents: v.documents.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, reusable: !!d.reusable, from_this_claim: d.claim_id === claim.id })),
  };
  return `<claim_state>\n${JSON.stringify(state, null, 1)}\n</claim_state>`;
}
