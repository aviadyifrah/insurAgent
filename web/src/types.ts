export interface User {
  id: number;
  email: string;
  full_name: string | null;
  id_number: string | null;
  phone: string | null;
  bank_details: string | null;
}

export interface Claim {
  id: number;
  title: string | null;
  treatment: string | null;
  provider: string | null;
  treatment_date: string | null;
  insurer: string | null;
  policy_number: string | null;
  claim_type: string | null;
  amount: number | null;
  status: "collecting" | "ready" | "submitted";
  package_document_id: number | null;
  updated_at: string;
}

export interface ClaimSummary extends Claim {
  total: number;
  done: number;
  open_tasks: number;
}

export interface Requirement {
  id: number;
  title: string;
  description: string | null;
  required: number;
  needs_signature: number;
  status: "missing" | "pending_user" | "pending_third_party" | "done" | "not_needed";
  document_id: number | null;
  note: string | null;
}

export interface Task {
  id: number;
  claim_id: number;
  requirement_id: number | null;
  email_draft_id: number | null;
  type: "upload" | "sign" | "send_email" | "action";
  title: string;
  instructions: string;
  status: "open" | "done" | "cancelled";
  reminder_count: number;
  claim_title?: string | null;
}

export interface EmailDraft {
  id: number;
  purpose: "request_documents" | "submit_claim" | "other";
  to_address: string | null;
  subject: string;
  body: string;
  attachment_ids: number[];
  status: "draft" | "sent";
}

export interface DocumentRow {
  id: number;
  claim_id: number | null;
  kind: string | null;
  filename: string;
  mime: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "event";
  text: string;
  created_at: string;
}

export interface ClaimView {
  claim: Claim;
  requirements: Requirement[];
  tasks: Task[];
  emails: EmailDraft[];
  documents: DocumentRow[];
  chat: ChatMessage[];
}
