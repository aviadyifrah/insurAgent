import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMime } from "../src/mime";

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));

test("a draft keeps Hebrew subject, body and attachment names intact", () => {
  const pdf = new Uint8Array(5000).map((_, i) => i % 256);
  const raw = buildMime({
    to: "clinic@example.com",
    subject: "בקשה לפירוט טיפולים",
    body: "שלום,\nאבקש פירוט טיפולים.",
    attachments: [{ filename: "קבלה.pdf", mime: "application/pdf", bytes: pdf }],
  });

  assert.match(raw, /^To: clinic@example\.com\r\n/);
  const subject = raw.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)![1];
  assert.equal(decode(subject), "בקשה לפירוט טיפולים");

  const boundary = raw.match(/boundary="(.+)"/)![1];
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  assert.equal(parts.length, 2);
  assert.equal(decode(parts[0].split("\r\n\r\n")[1]), "שלום,\nאבקש פירוט טיפולים.");

  const [head, body] = parts[1].split("\r\n\r\n");
  assert.equal(decode(head.match(/filename="=\?UTF-8\?B\?(.+)\?="/)![1]), "קבלה.pdf");
  assert.ok(body.split("\r\n").every((line) => line.length <= 76), "base64 lines are wrapped");
  const bytes = Uint8Array.from(atob(body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0));
  assert.deepEqual(bytes, pdf);
});

test("a draft without a recipient has no To header", () => {
  assert.doesNotMatch(buildMime({ to: null, subject: "x", body: "y", attachments: [] }), /^To:/m);
});
