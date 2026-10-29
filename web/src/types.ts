export interface User {
  id: string;
  email: string;
  full_name: string | null;
  id_number: string | null;
  phone: string | null;
  bank_details: string | null;
}

export interface Claim {
  id: string;
  user_id: string;
  title: string | null;
  treatment: string | null;
  provider: string | null;
  treatment_date: string | null;
  insurer: string | null;
  policy_number: string | null;
  claim_type: string | null;
  amount: number | null;
  status: "collecting" | "ready" | "submitted";
  updated_at: string;
}

export interface ClaimSummary extends Claim {
  total: number;
  done: number;
  open_tasks: number;
  open_task_list: Task[];
}

export interface Requirement {
  id: string;
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
  claim_id: string;
  requirement_id: string | null;
  email_draft_id: string | null;
  type: "upload" | "sign" | "send_email" | "action";
  title: string;
  instructions: string;
  status: "open" | "done" | "cancelled";
  reminder_count: number;
  created_at: string;
}

export interface EmailDraft {
  id: string;
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
  claim_id: string | null;
  kind: string | null;
  reusable: boolean;
  filename: string;
  mime: string;
  storage: "device";
  storage_ref: string;
  analysis: { summary_he?: string; warnings?: string[] } | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
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
