import { buildClaimPackage, type FontBytes } from "@insuragent/shared/pdf";
import hebrew400 from "@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-400-normal.woff?url";
import latin400 from "@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-latin-400-normal.woff?url";
import hebrew700 from "@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-700-normal.woff?url";
import latin700 from "@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-latin-700-normal.woff?url";
import { documentStore } from "./documentStore";
import type { ClaimView, User } from "./types";

async function loadFonts(): Promise<FontBytes> {
  const [h4, l4, h7, l7] = await Promise.all(
    [hebrew400, latin400, hebrew700, latin700].map((url) => fetch(url).then((r) => r.arrayBuffer())),
  );
  return { hebrew400: h4, latin400: l4, hebrew700: h7, latin700: l7 };
}

/**
 * Builds the submission PDF on this device from the locally stored files and downloads it.
 * Returns the titles of documents that aren't on this device (nothing is built in that case).
 */
export async function downloadClaimPackage(view: ClaimView, user: User): Promise<{ missing: string[] }> {
  const docs = new Map(view.documents.map((d) => [d.id, d]));
  const missing: string[] = [];
  const attachments: { title: string; mime: string; bytes: Uint8Array }[] = [];
  let signature: { png: Uint8Array; date: string } | undefined;

  for (const r of view.requirements) {
    if (r.status !== "done" || !r.document_id) continue;
    const doc = docs.get(r.document_id);
    const file = doc && (await documentStore.get(doc.storage_ref));
    if (!doc || !file) {
      missing.push(r.title);
      continue;
    }
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    if (doc.kind === "signature") signature = { png: bytes, date: doc.created_at.slice(0, 10) };
    else attachments.push({ title: r.title, mime: file.mime, bytes });
  }
  if (missing.length > 0) return { missing };

  const pdf = await buildClaimPackage({ claim: view.claim, user, signature, attachments }, await loadFonts());
  const url = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `תביעה-${view.claim.id}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { missing };
}
