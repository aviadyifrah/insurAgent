import {
  add,
  chatOf,
  remindersOf,
  israelDayPlus,
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
    created_at: now(),
    completed_at: null,
  });
  if (t.requirementId) await child(claim.id, "requirements").doc(t.requirementId).update({ status: "pending_user" });
  return task;
}

export async function closeTask(claimId: string, taskId: string, status: "done" | "cancelled") {
  await child(claimId, "tasks").doc(taskId).update({ status, completed_at: now() });
}

export async function addChat(claim: Claim, role: ChatMessage["role"], text: string) {
  await add<ChatMessage>(child(claim.id, "chat"), { user_id: claim.user_id, claim_id: claim.id, role, text, created_at: now() });
}

/** Full payload for the claim screen (the client also listens to Firestore for live updates). */
export async function claimView(claim: Claim) {
  const [requirements, tasks, emails, documents, chat, reminders] = await Promise.all([
    requirementsOf(claim.id),
    tasksOf(claim.id),
    emailsOf(claim.id),
    claimDocuments(claim),
    chatOf(claim.id),
    remindersOf(claim.id),
  ]);
  return { claim, requirements, tasks, emails, documents, chat, reminders };
}

/** Compact state the agent sees at the start of every turn. */
export async function claimSnapshot(claim: Claim): Promise<string> {
  const [user, v] = await Promise.all([getUser(claim.user_id), claimView(claim)]);
  const state = {
    today: israelDayPlus(0), // Israel date; UTC is a day behind late at night
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
      patient: claim.patient_name ? { name: claim.patient_name, id_number: claim.patient_id_number ?? null, relation: claim.patient_relation ?? null } : "the account holder",
      status: claim.status,
      outcome: claim.outcome ?? null,
    },
    family_members: (user?.family ?? []).map((m) => ({ name: m.name, relation: m.relation, has_id_number: !!m.id_number })),
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
      .map((t) => ({ id: t.id, type: t.type, title: t.title, requirement_id: t.requirement_id })),
    email_drafts: v.emails.map((e) => ({ id: e.id, purpose: e.purpose, to: e.to_address, subject: e.subject, status: e.status })),
    reminders: v.reminders.map((r) => ({ title: r.title, day: r.due_at.slice(0, 10), status: r.status })),
    documents: v.documents.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, reusable: d.reusable, from_this_claim: d.claim_id === claim.id })),
  };
  // The reminder sits next to the English app events and tool results that otherwise pull replies into English.
  return `<claim_state>\n${JSON.stringify(state, null, 1)}\n</claim_state>\n(Reply to the user in Hebrew.)`;
}
