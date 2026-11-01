import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { buildClaimPackage } from "../src/pdf";

const require = createRequire(import.meta.url);
const dir = path.join(path.dirname(require.resolve("@fontsource/noto-sans-hebrew/package.json")), "files");
const font = (n: string) => fs.readFileSync(path.join(dir, `noto-sans-hebrew-${n}-normal.woff`));
const fonts = { hebrew400: font("hebrew-400"), latin400: font("latin-400"), hebrew700: font("hebrew-700"), latin700: font("latin-700") };

test("the package is a PDF: cover page plus every attachment", async () => {
  const attachment = await PDFDocument.create();
  attachment.addPage();
  attachment.addPage();
  const bytes = await buildClaimPackage(
    {
      claim: { insurer: "הראל", policy_number: null, claim_type: "dental", treatment: "טיפול שורש", provider: "מרפאה", treatment_date: "2026-10-20", amount: 2450, patient_name: "נועה", patient_id_number: "000000018" },
      user: { full_name: "ישראל ישראלי", id_number: "000000018", phone: null, email: "a@b.c", bank_details: null },
      attachments: [{ title: "קבלה", mime: "application/pdf", bytes: await attachment.save() }],
    },
    fonts,
  );
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 3);
});
