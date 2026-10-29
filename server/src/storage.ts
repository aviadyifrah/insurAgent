import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, get, run, type DocumentRow } from "./db";

const FILES_DIR = path.join(DATA_DIR, "files");
fs.mkdirSync(FILES_DIR, { recursive: true });

export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export function saveDocument(opts: {
  userId: number;
  claimId: number | null;
  filename: string;
  mime: string;
  data: Buffer;
  kind?: string;
}): DocumentRow {
  const ext = path.extname(opts.filename).toLowerCase().replace(/[^.a-z0-9]/g, "") || "";
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(FILES_DIR, stored), opts.data);
  const id = run(
    "INSERT INTO documents (user_id, claim_id, kind, filename, mime, path) VALUES (?, ?, ?, ?, ?, ?)",
    opts.userId,
    opts.claimId,
    opts.kind ?? null,
    path.basename(opts.filename),
    opts.mime,
    stored,
  );
  return get<DocumentRow>("SELECT * FROM documents WHERE id = ?", id)!;
}

export function readDocument(doc: DocumentRow): Buffer {
  return fs.readFileSync(path.join(FILES_DIR, doc.path));
}
