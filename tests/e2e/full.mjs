// End-to-end pass against the local emulators and the real agent (needs `npm run dev` running and
// ANTHROPIC_API_KEY in server/.env; one run costs roughly a dollar or two of model usage):
// cross-user isolation, a brand-new user's whole claim, PDF, submission, outcome, reminder, claim
// limit, layout, and finally account deletion (which also cleans up the test user).
//
//   npm run test:e2e                       CHROME_PATH=... to point at Chrome
//   OTHER_CLAIM_ID=<id> npm run test:e2e   also check this user can't reach someone else's claim
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(process.argv[2] ?? "tests/e2e/.output");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..").replaceAll("\\", "/");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:5173";
const EMAIL = `qa${Date.now()}@example.com`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
let n = 0;
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`) });
const agentIdle = () => page.waitForFunction(() => !document.querySelector(".bubble.typing"), { timeout: 300000 });
const lastAgent = () => page.$$eval(".bubble.assistant:not(.typing)", (els) => els.at(-1)?.textContent ?? "");
const apiAs = (method, url, body) =>
  page.evaluate(async (method, url, body) => {
    const { auth } = await import("/src/firebase.ts");
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return r.status;
  }, method, url, body);

// --- New user: sign up through the auth emulator, consent ---
await page.goto(BASE, { waitUntil: "networkidle0" });
const popupTarget = new Promise((r) => browser.once("targetcreated", (t) => r(t)));
await page.click("button.google");
const popup = await (await popupTarget).page();
await popup.waitForNetworkIdle().catch(() => {});
const add = await popup.waitForFunction(() => [...document.querySelectorAll("button, li, div")].reverse().find((e) => e.textContent.includes("Add new account") && e.children.length < 4));
await add.asElement().click();
await popup.waitForSelector("input#email-input");
await popup.type("input#email-input", EMAIL);
await popup.type("input#display-name-input", "QA Tester").catch(() => {});
const signIn = await popup.waitForFunction(() => [...document.querySelectorAll("button")].find((e) => e.textContent.includes("Sign in with Google.com")));
await signIn.asElement().click();
await page.waitForSelector("label.consent", { timeout: 20000 });
check("new user lands on consent screen", true);
await page.click("form button.primary");
await sleep(300);
check("consent is required", (await page.$eval(".error", (e) => e.textContent).catch(() => "")).includes("לאשר"));
await page.click("label.consent input");
await page.click("form button.primary");
await page.waitForSelector(".new-claim", { timeout: 20000 });
check("after consent: new-claim box", true);

// --- Isolation: this user must not reach the demo user's claim ---
const otherClaimId = process.env.OTHER_CLAIM_ID;
if (otherClaimId) {
  check("API: other user's claim → 404", (await apiAs("GET", `/api/claims/${otherClaimId}`)) === 404);
  check("API: message to other user's claim → 404", (await apiAs("POST", `/api/claims/${otherClaimId}/messages`, { text: "x" })) === 404);
  // Straight to the Firestore emulator's REST API with this user's token, so the security rules decide.
  const fsRead = await page.evaluate(async (id) => {
    const { auth } = await import("/src/firebase.ts");
    const token = await auth.currentUser.getIdToken();
    const base = `http://${location.hostname}:8080/v1/projects/demo-insuragent/databases/(default)/documents`;
    const get = async (p) => (await fetch(`${base}/${p}`, { headers: { Authorization: `Bearer ${token}` } })).status;
    return { claim: await get(`claims/${id}`), chat: await get(`claims/${id}/chat`), turns: await get(`claims/${id}/turns`), usage: await get("usage") };
  }, otherClaimId);
  check("Firestore: other user's claim/chat/turns, and usage, denied", Object.values(fsRead).every((v) => v === 403), JSON.stringify(fsRead));
}

// --- Start a claim with a document from the home screen (auto-send) ---
await shot("home-new-user");
await page.type(".new-claim textarea", "היה לי טיפול שורש, יש לי ביטוח שיניים בהראל. זו הדגמה עם מסמכי דוגמה.");
await (await page.$$(".new-claim input[type=file]"))[1].uploadFile(`${REPO}/samples/receipt-sample.pdf`);
await page.waitForSelector(".claim-page", { timeout: 60000 });
check("file pick creates the claim and sends (no send tap)", true);
await sleep(1500);
await agentIdle();
const firstReply = await lastAgent();
check("agent replies in Hebrew", /[\u0590-\u05FF]{3}/.test(firstReply), firstReply.slice(0, 80));
await shot("first-reply");

// --- Work through whatever the agent asks until the claim is ready ---
const SAMPLE = [[/זהות|ת"ז/, "id-sample.pdf"], [/בנק|חשבון/, "bank-confirmation-sample.pdf"], [/פירוט|מרפאה/, "treatment-details-sample.pdf"], [/קבלה|חשבונית/, "receipt-sample.pdf"]];
const say = async (text) => {
  await page.type(".composer-dock textarea", text);
  await page.click(".composer-dock .wa-round");
  await sleep(1200);
  await agentIdle();
};
let profileSent = false;
for (let round = 0; round < 14 && !(await page.$(".package")); round++) {
  const task = await page.$(".task");
  if (!task) {
    if (profileSent) { await say("מה עוד חסר? אפשר להמשיך עם מסמכי הדוגמה."); continue; }
    profileSent = true;
    await say("הפרטים שלי: QA Tester, ת\"ז 000000018, טלפון 050-0000000, בנק לדוגמה (99) סניף 123 חשבון 000000.");
    continue;
  }
  const title = await task.$eval("strong", (e) => e.textContent);
  const kind = await task.$eval("button.primary", (e) => e.textContent);
  console.log(`  task: ${title} [${kind}]`);
  if (kind.includes("צילום")) {
    const file = SAMPLE.find(([re]) => re.test(title))?.[1] ?? "receipt-sample.pdf";
    await (await task.$$("input[type=file]"))[1].uploadFile(`${REPO}/samples/${file}`);
  } else if (kind.includes("חתום")) {
    await task.$eval("button.primary", (b) => b.click());
    await page.waitForSelector(".sigpad canvas");
    await page.waitForSelector(".modal dl.summary"); // details loaded; signing is enabled after this
    const box = await (await page.$(".sigpad canvas")).boundingBox();
    await page.mouse.move(box.x + 40, box.y + 100); await page.mouse.down();
    for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + 40 + i * 12, box.y + 100 - Math.sin(i / 2) * 40);
    await page.mouse.up();
    await page.click(".modal button.primary");
  } else if (kind.includes("מייל")) {
    await task.$eval("button.primary", (b) => b.click());
    await page.waitForSelector(".modal");
    await page.click(".modal button.success");
  } else {
    await task.$eval("button.primary", (b) => b.click());
  }
  await sleep(1500);
  await agentIdle();
  const card = await page.$(".chat .card.reminder");
  if (card) { await card.$eval("button.link", (b) => b.click()); console.log("  dismissed a reminder suggestion"); }
}
const ready = !!(await page.$(".package"));
check("claim reaches 'ready' with the real agent", ready);
await shot("ready");

// --- PDF built on this device ---
if (ready) {
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT.replaceAll("/", "\\") });
  await page.click(".package button.primary");
  let pdf;
  for (let i = 0; i < 40 && !(pdf = fs.readdirSync(OUT).find((f) => f.endsWith(".pdf"))); i++) await sleep(250);
  const warn = await page.$eval(".package .warn", (e) => e.textContent).catch(() => "");
  check("package PDF downloads (all files on this device)", !!pdf, pdf ?? warn);
  if (pdf) check("PDF has cover + attachments", fs.statSync(path.join(OUT, pdf)).size > 20000, `${fs.statSync(path.join(OUT, pdf)).size} bytes`);

  // --- Submitted → status-check reminder suggestion ---
  await page.$$eval(".package button", (bs) => bs.find((b) => b.textContent.includes("הגשתי")).click());
  await page.waitForSelector(".chat .card.reminder", { timeout: 15000 }).catch(() => {});
  const rem = await page.$eval(".chat .card.reminder strong", (e) => e.textContent).catch(() => "");
  check("after submission: status-check reminder offered", rem.includes("סטטוס"), rem);
  const gcal = await page.$eval(".chat .card.reminder a", (a) => new URL(a.href).searchParams.get("dates")).catch(() => "");
  check("reminder is at 07:00Z (09:00 Israel) in 21 days", /T070000Z\//.test(gcal), gcal);
  await shot("submitted");

  // --- Record the insurer's answer ---
  await page.waitForSelector(".card.outcome .outcome-choices", { timeout: 15000 });
  await sleep(800); // let the live view settle before clicking
  await page.$$eval(".outcome-choices button", (bs) => bs.find((b) => b.textContent.includes("אושרה") && !b.textContent.includes("חלקית")).click());
  await page.type(".card.outcome input", "1800");
  await page.click(".card.outcome button.primary.wide");
  await page.waitForFunction(() => document.querySelector(".card.outcome strong")?.textContent.includes("אושרה") && !document.querySelector(".outcome-choices"), { timeout: 15000 });
  check("outcome recorded (approved 1,800)", (await page.$eval(".card.outcome", (e) => e.textContent)).includes("1,800"));
}

// --- Claim limit ---
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.waitForSelector(".limit-card, .new-claim", { timeout: 30000 });
check("home shows the limit card after one claim", !!(await page.$(".limit-card")));
check("server refuses a second claim", (await apiAs("POST", "/api/claims")) === 403);

// --- Layout: 320px wide and dark mode ---
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await page.goto(BASE, { waitUntil: "networkidle0" });
await sleep(800);
check("no horizontal scroll at 320px (home)", (await page.evaluate(() => document.documentElement.scrollWidth)) <= 320);
await shot("home-320-dark");
await page.evaluate(() => document.querySelector(".list .card.row")?.click());
await page.waitForSelector(".claim-page", { timeout: 15000 });
await sleep(800);
check("no horizontal scroll at 320px (claim)", (await page.evaluate(() => document.documentElement.scrollWidth)) <= 320);
await shot("claim-320-dark");

// --- Delete the account (cleans up the test user) ---
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.removeAllListeners("dialog");
page.on("dialog", (d) => d.accept());
await page.goto(`${BASE}/#/profile`, { waitUntil: "networkidle0" });
await page.waitForSelector(".danger-zone button");
await page.click(".danger-zone button");
await page.waitForSelector("button.google", { timeout: 30000 });
check("account deletion signs out to the landing page", true);

check("no page errors / alerts", errors.length === 0, errors.join(" | "));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
