import { test } from "node:test";
import assert from "node:assert/strict";
import { israeliMobile } from "../src/whatsapp";

test("Israeli mobile numbers become WhatsApp's international form", () => {
  for (const n of ["055-660-2851", "0556602851", "+972 55 660 2851", "972556602851", "(055) 6602851"]) {
    assert.equal(israeliMobile(n), "972556602851", n);
  }
});

test("landlines and malformed numbers are rejected", () => {
  for (const n of ["03-1234567", "055-660-285", "12345", "", "0556602851999"]) assert.equal(israeliMobile(n), null, n);
});
