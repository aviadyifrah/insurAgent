import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { all, get, update, type Claim, type DocumentRow, type Requirement, type User } from "./db";
import { readDocument, saveDocument } from "./storage";

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("@fontsource/noto-sans-hebrew/package.json")), "files");
const fontFile = (subset: "hebrew" | "latin", weight: 400 | 700) =>
  fs.readFileSync(path.join(FONT_DIR, `noto-sans-hebrew-${subset}-${weight}-normal.woff`));

// The fontsource Hebrew subset covers these ranges; everything else is drawn with the Latin subset.
const HEBREW_FONT_CHARS = /[֐-׿‌-‐₪◌יִ-ﭏ]/;
const LTR_RUN = /[A-Za-z0-9][A-Za-z0-9@._\-/+:,]*[A-Za-z0-9]|[A-Za-z0-9]/g;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<" };

interface Fonts {
  he: PDFFont;
  latin: PDFFont;
}

/**
 * Minimal bidi for an RTL paragraph: Latin/digit runs keep their order, everything else
 * is RTL. pdf-lib draws glyphs left-to-right, so we produce the visual order.
 */
function toVisual(text: string): string {
  const runs: { ltr: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(LTR_RUN)) {
    if (m.index! > last) runs.push({ ltr: false, text: text.slice(last, m.index) });
    runs.push({ ltr: true, text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) runs.push({ ltr: false, text: text.slice(last) });
  return runs
    .reverse()
    .map((r) => (r.ltr ? r.text : [...r.text].reverse().map((c) => MIRROR[c] ?? c).join("")))
    .join("");
}

function segments(visual: string, fonts: Fonts) {
  const segs: { font: PDFFont; text: string }[] = [];
  for (const ch of visual) {
    const font = HEBREW_FONT_CHARS.test(ch) ? fonts.he : fonts.latin;
    const prev = segs[segs.length - 1];
    if (prev && prev.font === font) prev.text += ch;
    else segs.push({ font, text: ch });
  }
  return segs;
}

function textWidth(text: string, size: number, fonts: Fonts) {
  return segments(text, fonts).reduce((w, s) => w + s.font.widthOfTextAtSize(s.text, size), 0);
}

/** Draws one RTL line whose right edge is at `right`. */
function drawRtl(page: PDFPage, text: string, right: number, y: number, size: number, fonts: Fonts) {
  const segs = segments(toVisual(text), fonts);
  let x = right - segs.reduce((w, s) => w + s.font.widthOfTextAtSize(s.text, size), 0);
  for (const s of segs) {
    page.drawText(s.text, { x, y, size, font: s.font, color: rgb(0.1, 0.1, 0.15) });
    x += s.font.widthOfTextAtSize(s.text, size);
  }
}

function wrap(text: string, maxWidth: number, size: number, fonts: Fonts): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, size, fonts) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

const CLAIM_TYPE_LABELS: Record<string, string> = {
  dental: "טיפול שיניים",
  optics: "משקפיים / עדשות",
  paramedical: "טיפול פרא-רפואי",
  consultation: "התייעצות עם מומחה",
};

export async function buildPackage(claim: Claim): Promise<DocumentRow> {
  const user = get<User>("SELECT * FROM users WHERE id = ?", claim.user_id)!;
  const requirements = all<Requirement>("SELECT * FROM requirements WHERE claim_id = ? ORDER BY sort, id", claim.id);
  const signature = get<DocumentRow>(
    "SELECT * FROM documents WHERE claim_id = ? AND kind = 'signature' ORDER BY id DESC LIMIT 1",
    claim.id,
  );

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular: Fonts = {
    he: await pdf.embedFont(fontFile("hebrew", 400), { subset: true }),
    latin: await pdf.embedFont(fontFile("latin", 400), { subset: true }),
  };
  const bold: Fonts = {
    he: await pdf.embedFont(fontFile("hebrew", 700), { subset: true }),
    latin: await pdf.embedFont(fontFile("latin", 700), { subset: true }),
  };

  // --- Cover page: claim details form ---
  const page = pdf.addPage([595, 842]); // A4
  const right = 545;
  const contentWidth = 495;
  let y = 790;

  drawRtl(page, "טופס פרטי תביעה להחזר הוצאות", right, y, 18, bold);
  y -= 22;
  drawRtl(page, `הוכן בתאריך ${new Date().toLocaleDateString("he-IL")}`, right, y, 9, regular);
  y -= 30;

  const rows: [string, string | number | null][] = [
    ["שם המבוטח", user.full_name],
    ["מספר ת\"ז", user.id_number],
    ["טלפון", user.phone],
    ["אימייל", user.email],
    ["חברת ביטוח", claim.insurer],
    ["מספר פוליסה", claim.policy_number],
    ["סוג תביעה", claim.claim_type ? CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type : null],
    ["הטיפול", claim.treatment],
    ["הגורם המטפל", claim.provider],
    ["תאריך הטיפול", claim.treatment_date],
    ["סכום ששולם", claim.amount != null ? `${claim.amount} ₪` : null],
    ["פרטי חשבון בנק להחזר", user.bank_details],
  ];
  for (const [label, value] of rows) {
    drawRtl(page, `${label}:`, right, y, 11, bold);
    const lines = wrap(value == null || value === "" ? "—" : String(value), contentWidth - 150, 11, regular);
    for (const line of lines) {
      drawRtl(page, line, right - 150, y, 11, regular);
      y -= 16;
    }
    page.drawLine({ start: { x: 50, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.85) });
    y -= 6;
  }

  y -= 14;
  drawRtl(page, "הצהרה", right, y, 12, bold);
  y -= 18;
  const declaration =
    "אני מצהיר/ה כי הפרטים בטופס זה ובמסמכים המצורפים נכונים ומלאים, וכי ההוצאה שבגינה מוגשת התביעה שולמה על ידי. אני מבקש/ת להעביר את ההחזר לחשבון הבנק המפורט לעיל.";
  for (const line of wrap(declaration, contentWidth, 10, regular)) {
    drawRtl(page, line, right, y, 10, regular);
    y -= 15;
  }

  y -= 20;
  drawRtl(page, "חתימת המבוטח:", right, y, 11, bold);
  if (signature) {
    const img = await pdf.embedPng(readDocument(signature));
    const scaled = img.scaleToFit(180, 70);
    page.drawImage(img, { x: right - 110 - scaled.width, y: y - scaled.height + 14, ...scaled });
    drawRtl(page, `תאריך: ${signature.created_at.slice(0, 10)}`, 200, y, 10, regular);
  } else {
    drawRtl(page, "(טרם נחתם)", right - 110, y, 10, regular);
  }

  y -= 90;
  drawRtl(page, "מסמכים מצורפים", right, y, 12, bold);
  y -= 18;
  const attached = requirements.filter((r) => r.status === "done" && r.document_id);
  for (const r of attached) {
    drawRtl(page, `• ${r.title}`, right, y, 10, regular);
    y -= 15;
  }

  // --- Attached documents, in requirement order ---
  for (const r of attached) {
    const doc = get<DocumentRow>("SELECT * FROM documents WHERE id = ?", r.document_id);
    if (!doc || doc.kind === "signature") continue;
    const bytes = readDocument(doc);
    if (doc.mime === "application/pdf") {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await pdf.copyPages(src, src.getPageIndices());
      pages.forEach((p) => pdf.addPage(p));
    } else if (doc.mime === "image/jpeg" || doc.mime === "image/png") {
      const img = doc.mime === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const p = pdf.addPage([595, 842]);
      const scaled = img.scaleToFit(535, 782);
      p.drawImage(img, { x: (595 - scaled.width) / 2, y: (842 - scaled.height) / 2, ...scaled });
    }
  }

  const doc = saveDocument({
    userId: claim.user_id,
    claimId: claim.id,
    filename: `claim-${claim.id}-package.pdf`,
    mime: "application/pdf",
    data: Buffer.from(await pdf.save()),
    kind: "package",
  });
  update("claims", claim.id, { package_document_id: doc.id, status: "ready", updated_at: new Date().toISOString() });
  return doc;
}
