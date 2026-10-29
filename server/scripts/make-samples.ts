// Generates clearly-marked fake documents for demos: npm run samples -w server
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, degrees } from "pdf-lib";
import { drawRtl, embedHebrewFonts, wrap } from "@insuragent/shared/pdf";
import { loadFontBytes } from "../src/fonts";

const OUT_DIR = path.resolve("../samples");
fs.mkdirSync(OUT_DIR, { recursive: true });

const CLINIC = "מרפאת השן הלבנה (מרפאה בדויה לצורך הדגמה)";
const PATIENT = "ישראל ישראלי";

async function makeDoc(filename: string, title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedHebrewFonts(pdf, loadFontBytes());
  const page = pdf.addPage([595, 842]);
  const right = 545;
  let y = 790;

  drawRtl(page, CLINIC, right, y, 12, bold);
  y -= 16;
  drawRtl(page, "רחוב הדוגמה 1, עיר לדוגמה · טלפון 03-0000000", right, y, 9, regular);
  y -= 40;
  drawRtl(page, title, right, y, 18, bold);
  y -= 34;
  for (const line of lines) {
    for (const part of wrap(line, 495, 11, regular)) {
      drawRtl(page, part, right, y, 11, regular);
      y -= 18;
    }
    y -= 4;
  }

  // Diagonal watermark so the file can never pass as a real document.
  for (const wy of [250, 520]) {
    page.drawText("SAMPLE ONLY", { x: 120, y: wy, size: 64, font: bold.latin, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(30) });
  }
  drawRtl(page, "מסמך לדוגמה בלבד. אינו מסמך אמיתי ואין להשתמש בו להגשת תביעה.", right, 40, 10, bold);

  fs.writeFileSync(path.join(OUT_DIR, filename), await pdf.save());
  console.log(`wrote samples/${filename}`);
}

await makeDoc("receipt-sample.pdf", "חשבונית מס / קבלה מס' 10234", [
  `לכבוד: ${PATIENT}, ת"ז 000000018`,
  "תאריך: 20/10/2026",
  "טיפול שורש בשן 36 (3 תעלות): 2,100 ₪",
  "צילום רנטגן פריאפיקלי: 350 ₪",
  "סה\"כ ששולם: 2,450 ₪ (כולל מע\"מ)",
  "אמצעי תשלום: כרטיס אשראי",
]);

await makeDoc("treatment-details-sample.pdf", "פירוט טיפולים", [
  `שם המטופל: ${PATIENT}, ת"ז 000000018`,
  "רופא מטפל: ד\"ר דוגמה דוגמאי, מ.ר. 00000",
  "20/10/2026: טיפול שורש, שן 36, שלוש תעלות",
  "20/10/2026: צילום רנטגן פריאפיקלי, שן 36",
  "המלצה להמשך: כתר על שן 36 בתוך 3 חודשים",
]);

await makeDoc("id-sample.pdf", "צילום תעודת זהות (דוגמה)", [
  `שם: ${PATIENT}`,
  "מספר זהות: 000000018",
  "תאריך לידה: 01/01/1985",
]);

await makeDoc("bank-confirmation-sample.pdf", "אישור ניהול חשבון (דוגמה)", [
  `שם בעל החשבון: ${PATIENT}`,
  "בנק: בנק לדוגמה (99)",
  "סניף: 123",
  "מספר חשבון: 000000",
]);
