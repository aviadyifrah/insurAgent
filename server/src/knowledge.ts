import fs from "node:fs";
import path from "node:path";

export interface RequirementTemplate {
  key: string;
  title: string;
  description: string;
  needs_signature?: boolean;
  required?: boolean;
}

export interface ClaimTemplate {
  id: string;
  insurer: string | null;
  insurer_key: string;
  claim_type: string;
  title: string;
  verified: boolean;
  verification_note: string;
  submission: { email: string | null; instructions: string };
  requirements: RequirementTemplate[];
}

const KNOWLEDGE_DIR = path.resolve("knowledge");

export const templates: ClaimTemplate[] = fs
  .readdirSync(KNOWLEDGE_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, f), "utf8")) as ClaimTemplate);

export function findTemplate(insurerKey: string, claimType: string): ClaimTemplate | undefined {
  return templates.find((t) => t.insurer_key === insurerKey && t.claim_type === claimType);
}

export function templateById(id: string): ClaimTemplate | undefined {
  return templates.find((t) => t.id === id);
}
