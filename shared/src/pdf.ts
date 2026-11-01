// Hebrew PDF rendering shared by the browser (submission package) and the server (sample documents).
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/** WOFF files from @fontsource/noto-sans-hebrew: its Hebrew and Latin subsets, regular and bold. */
export interface FontBytes {
  hebrew400: ArrayBuffer | Uint8Array;
  latin400: ArrayBuffer | Uint8Array;
  hebrew700: ArrayBuffer | Uint8Array;
  latin700: ArrayBuffer | Uint8Array;
}

export interface Fonts {
  he: PDFFont;
  latin: PDFFont;
}

// The fontsource Hebrew subset covers these ranges; everything else is drawn with the Latin subset.
const HEBREW_FONT_CHARS = /[֐-׿‌-‐₪◌יִ-ﭏ]/;
const LTR_RUN = /[A-Za-z0-9][A-Za-z0-9@._\-/+:,]*[A-Za-z0-9]|[A-Za-z0-9]/g;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<" };

export async function embedHebrewFonts(pdf: PDFDocument, bytes: FontBytes): Promise<{ regular: Fonts; bold: Fonts }> {
  pdf.registerFontkit(fontkit);
  return {
    regular: {
      he: await pdf.embedFont(bytes.hebrew400, { subset: true }),
      latin: await pdf.embedFont(bytes.latin400, { subset: true }),
    },
    bold: {
      he: await pdf.embedFont(bytes.hebrew700, { subset: true }),
      latin: await pdf.embedFont(bytes.latin700, { subset: true }),
    },
  };
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
  // fontkit lays out Hebrew runs right-to-left by itself, so hand it those runs in logical order.
  for (const s of segs) if (s.font === fonts.he) s.text = [...s.text].reverse().join("");
  return segs;
}

function textWidth(text: string, size: number, fonts: Fonts) {
  return segments(text, fonts).reduce((w, s) => w + s.font.widthOfTextAtSize(s.text, size), 0);
}

/** Draws one RTL line whose right edge is at `right`. */
export function drawRtl(page: PDFPage, text: string, right: number, y: number, size: number, fonts: Fonts) {
  const segs = segments(toVisual(text), fonts);
  let x = right - segs.reduce((w, s) => w + s.font.widthOfTextAtSize(s.text, size), 0);
  for (const s of segs) {
    page.drawText(s.text, { x, y, size, font: s.font, color: rgb(0.1, 0.1, 0.15) });
    x += s.font.widthOfTextAtSize(s.text, size);
  }
}

export function wrap(text: string, maxWidth: number, size: number, fonts: Fonts): string[] {
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

export interface PackageInput {
  claim: {
    patient_name?: string | null;
    patient_id_number?: string | null;
    insurer: string | null;
    policy_number: string | null;
    claim_type: string | null;
    treatment: string | null;
    provider: string | null;
    treatment_date: string | null;
    amount: number | null;
  };
  user: {
    full_name: string | null;
    id_number: string | null;
    phone: string | null;
    email: string;
    bank_details: string | null;
  };
  signature?: { png: Uint8Array; date: string };
  attachments: { title: string; mime: string; bytes: Uint8Array }[];
}

/** Cover page (claim details, declaration, signature, attachment list) followed by every attachment. */
export async function buildClaimPackage(input: PackageInput, fontBytes: FontBytes): Promise<Uint8Array> {
  const { claim, user, signature, attachments } = input;
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedHebrewFonts(pdf, fontBytes);

  const page = pdf.addPage([595, 842]); // A4
  const right = 545;
  const contentWidth = 495;
  let y = 790;

  // Not the insurer's own claim form: a signed summary that goes with it (or stands alone where accepted).
  drawRtl(page, "דף מקדים לתביעת החזר הוצאות", right, y, 18, bold);
  y -= 22;
  drawRtl(page, `הוכן בתאריך ${new Date().toLocaleDateString("he-IL")} על ידי המבוטח, בעזרת כלי העזר InsurAgent`, right, y, 9, regular);
  y -= 30;

  const rows: [string, string | number | null][] = [
    ["שם המבוטח", user.full_name],
    ...(claim.patient_name
      ? ([
          ["שם המטופל", claim.patient_name],
          ["ת\"ז המטופל", claim.patient_id_number ?? null],
        ] as [string, string | null][])
      : []),
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
    for (const line of wrap(value == null || value === "" ? "—" : String(value), contentWidth - 150, 11, regular)) {
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
    const img = await pdf.embedPng(signature.png);
    const scaled = img.scaleToFit(180, 70);
    page.drawImage(img, { x: right - 110 - scaled.width, y: y - scaled.height + 14, ...scaled });
    drawRtl(page, `תאריך: ${signature.date}`, 200, y, 10, regular);
  } else {
    drawRtl(page, "(טרם נחתם)", right - 110, y, 10, regular);
  }

  y -= 90;
  drawRtl(page, "מסמכים מצורפים", right, y, 12, bold);
  y -= 18;
  for (const a of attachments) {
    drawRtl(page, `• ${a.title}`, right, y, 10, regular);
    y -= 15;
  }

  for (const a of attachments) {
    if (a.mime === "application/pdf") {
      const src = await PDFDocument.load(a.bytes, { ignoreEncryption: true });
      const pages = await pdf.copyPages(src, src.getPageIndices());
      pages.forEach((p) => pdf.addPage(p));
    } else if (a.mime === "image/jpeg" || a.mime === "image/png") {
      const img = a.mime === "image/png" ? await pdf.embedPng(a.bytes) : await pdf.embedJpg(a.bytes);
      const p = pdf.addPage([595, 842]);
      const scaled = img.scaleToFit(535, 782);
      p.drawImage(img, { x: (595 - scaled.width) / 2, y: (842 - scaled.height) / 2, ...scaled });
    }
  }

  return pdf.save();
}
