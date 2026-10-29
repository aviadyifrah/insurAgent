import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "insuragent.db"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  id_number TEXT,
  phone TEXT,
  bank_details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,
  treatment TEXT,
  provider TEXT,
  provider_email TEXT,
  treatment_date TEXT,
  insurer TEXT,
  insurer_key TEXT,
  policy_number TEXT,
  claim_type TEXT,
  amount REAL,
  template_id TEXT,
  status TEXT NOT NULL DEFAULT 'collecting', -- collecting | ready | submitted
  package_document_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  claim_id INTEGER REFERENCES claims(id),
  kind TEXT,                       -- receipt | treatment_details | id_copy | bank_confirmation | signature | package | ...
  reusable INTEGER NOT NULL DEFAULT 0, -- 1 = may be reused across claims (ID copy, bank confirmation)
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  key TEXT,
  title TEXT NOT NULL,
  description TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  needs_signature INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'missing', -- missing | pending_user | pending_third_party | done | not_needed
  document_id INTEGER REFERENCES documents(id),
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS email_drafts (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  purpose TEXT NOT NULL,           -- request_documents | submit_claim | other
  to_address TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | sent
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  requirement_id INTEGER REFERENCES requirements(id),
  email_draft_id INTEGER REFERENCES email_drafts(id),
  type TEXT NOT NULL,              -- upload | sign | send_email | action
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | done | cancelled
  reminder_count INTEGER NOT NULL DEFAULT 0,
  next_reminder_at TEXT,
  last_reminded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Raw Messages API turns, replayed verbatim to the model (append-only).
CREATE TABLE IF NOT EXISTS agent_turns (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the user sees in the chat.
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  role TEXT NOT NULL,              -- user | assistant | event
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/** Builds `SET a = ?, b = ?` from the defined keys of a patch object. */
export function update(table: string, id: number, patch: Record<string, SQLInputValue | undefined>) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [string, SQLInputValue][];
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => v), id);
}

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
  user_id: number;
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
  package_document_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: number;
  user_id: number;
  claim_id: number | null;
  kind: string | null;
  reusable: number;
  filename: string;
  mime: string;
  path: string;
  created_at: string;
}

export interface Requirement {
  id: number;
  claim_id: number;
  key: string | null;
  title: string;
  description: string | null;
  required: number;
  needs_signature: number;
  status: "missing" | "pending_user" | "pending_third_party" | "done" | "not_needed";
  document_id: number | null;
  note: string | null;
  sort: number;
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
  next_reminder_at: string | null;
  last_reminded_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface EmailDraft {
  id: number;
  claim_id: number;
  purpose: "request_documents" | "submit_claim" | "other";
  to_address: string | null;
  subject: string;
  body: string;
  attachment_ids: string;
  status: "draft" | "sent";
  created_at: string;
}

export interface ChatMessage {
  id: number;
  claim_id: number;
  role: "user" | "assistant" | "event";
  text: string;
  created_at: string;
}
