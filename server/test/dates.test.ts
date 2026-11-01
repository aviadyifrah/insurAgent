import { test } from "node:test";
import assert from "node:assert/strict";
import { israelDayPlus, israelMorning } from "../src/store";

test("09:00 Israel time is 07:00 UTC in winter and 06:00 UTC in summer", () => {
  assert.equal(israelMorning("2026-12-01"), "2026-12-01T07:00:00.000Z");
  assert.equal(israelMorning("2026-07-01"), "2026-07-01T06:00:00.000Z");
});

test("israelDayPlus counts calendar days in Israel", () => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  assert.equal(israelDayPlus(0), today);
  const [y, m, d] = today.split("-").map(Number);
  assert.equal(israelDayPlus(1), new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10));
});
