// Firestore data layer. Only the server writes; clients read their own documents (see firestore.rules).
//
//   users/{uid}
//   claims/{claimId}
//   claims/{claimId}/requirements|tasks|emails|chat/{id}   every doc carries user_id + claim_id
//   claims/{claimId}/turns/{seq}                           raw model turns, server-only
//   claims/{claimId}/inbox/{id}                            queued agent input (production), server-only
//   documents/{docId}                                      metadata only; files stay with the client
import type { DocumentData, Query } from "firebase-admin/firestore";
import { firestore } from "./firebase";

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  id_number: string | null;
  phone: string | null;
  bank_details: string | null;
  consent_version: string | null;
  consent_at: string | null;
  created_at: string;
}

export interface Claim {
  id: string;
  user_id: string;
  title: string | null;
  treatment: string | null;
  provider: string | null;
  provider_email: string | null;
  treatment_date: string | null;
  insurer: string | null;
  insurer_key: string | null;
  policy_number: string | null;
  claim_type: string | null;
  amount: number | null;
  template_id: string | null;
  status: "collecting" | "ready" | "submitted";
  /** Lets every open screen show that the agent is working, since its runs happen in the background. */
  agent_status: "idle" | "working";
  agent_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Requirement {
  id: string;
  user_id: string;
  claim_id: string;
  key: string | null;
  title: string;
  description: string | null;
  required: boolean;
  needs_signature: boolean;
  status: "missing" | "pending_user" | "pending_third_party" | "done" | "not_needed";
  document_id: string | null;
  note: string | null;
  sort: number;
}

export interface Task {
  id: string;
  user_id: string;
  claim_id: string;
  requirement_id: string | null;
  email_draft_id: string | null;
  type: "upload" | "sign" | "send_email" | "action";
  title: string;
  instructions: string;
  status: "open" | "done" | "cancelled";
  reminder_count: number;
  next_reminder_at: string | null;
  last_reminded_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface EmailDraft {
  id: string;
  user_id: string;
  claim_id: string;
  purpose: "request_documents" | "submit_claim" | "other";
  to_address: string | null;
  subject: string;
  body: string;
  attachment_ids: string[];
  status: "draft" | "sent";
  created_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  claim_id: string | null;
  kind: string | null;
  reusable: boolean;
  filename: string;
  mime: string;
  storage: "device" | "server";
  storage_ref: string;
  analysis: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  claim_id: string;
  role: "user" | "assistant" | "event";
  text: string;
  created_at: string;
}

export type ClaimChild = "requirements" | "tasks" | "emails" | "chat";

export const now = () => new Date().toISOString();

export const users = firestore.collection("users");
export const claims = firestore.collection("claims");
export const documents = firestore.collection("documents");
export const child = (claimId: string, name: ClaimChild | "turns" | "inbox") => claims.doc(claimId).collection(name);

function withId<T>(snap: FirebaseFirestore.DocumentSnapshot): T | undefined {
  return snap.exists ? ({ ...snap.data(), id: snap.id } as T) : undefined;
}

export async function getDoc<T>(ref: FirebaseFirestore.DocumentReference): Promise<T | undefined> {
  return withId<T>(await ref.get());
}

export async function list<T>(query: Query<DocumentData>): Promise<T[]> {
  return (await query.get()).docs.map((d) => ({ ...d.data(), id: d.id }) as T);
}

/** Adds a document and returns it with its generated id. `id` must not be in `data`. */
export async function add<T extends { id: string }>(
  collection: FirebaseFirestore.CollectionReference,
  data: Omit<T, "id">,
): Promise<T> {
  const ref = await collection.add(data);
  return { ...data, id: ref.id } as T;
}

export const getUser = (uid: string) => getDoc<User>(users.doc(uid));

export async function getClaim(claimId: string, userId?: string): Promise<Claim | undefined> {
  const claim = await getDoc<Claim>(claims.doc(claimId));
  return claim && (userId === undefined || claim.user_id === userId) ? claim : undefined;
}

export async function updateClaim(claimId: string, patch: Partial<Claim>) {
  await claims.doc(claimId).update({ ...patch, updated_at: now() });
}

export const requirementsOf = (claimId: string) => list<Requirement>(child(claimId, "requirements").orderBy("sort"));

export const tasksOf = (claimId: string) => list<Task>(child(claimId, "tasks").orderBy("created_at"));

export const emailsOf = (claimId: string) => list<EmailDraft>(child(claimId, "emails").orderBy("created_at"));

export const chatOf = (claimId: string) => list<ChatMessage>(child(claimId, "chat").orderBy("created_at"));

/** Documents visible to a claim: its own plus the user's reusable ones from other claims. */
export async function claimDocuments(claim: Claim): Promise<DocumentRow[]> {
  const [own, reusable] = await Promise.all([
    list<DocumentRow>(documents.where("claim_id", "==", claim.id).where("user_id", "==", claim.user_id)),
    list<DocumentRow>(documents.where("user_id", "==", claim.user_id).where("reusable", "==", true)),
  ]);
  const byId = new Map([...own, ...reusable].map((d) => [d.id, d]));
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
