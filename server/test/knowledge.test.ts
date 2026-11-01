import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

// knowledge.ts reads ./knowledge relative to the working directory (the server folder).
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const { templates, findTemplate, templateById } = await import("../src/knowledge");
const { SUPPORTED } = await import("@insuragent/shared/supported");

test("insurers with a dental list get it for dental claims", () => {
  for (const key of ["harel", "phoenix", "menora", "migdal", "clal"]) {
    assert.equal(findTemplate(key, "dental")?.claim_type, "dental", `${key} dental`);
  }
});

test("other claim types fall back to the insurer's general list", () => {
  assert.equal(findTemplate("menora", "optics")?.id, "menora-health");
  assert.equal(findTemplate("unknown-insurer", "dental"), undefined);
  assert.equal(findTemplate("maccabi_sheli", "dental"), undefined, "dental never uses a general list");
  assert.ok(templateById("generic-health"));
});

test("the landing page's supported list matches the knowledge files", () => {
  const listed = new Set(SUPPORTED.flatMap((g) => g.insurers.map((i) => `${i.key}/${g.claim_type}`)));
  const known = new Set(templates.filter((t) => t.insurer_key !== "*").map((t) => `${t.insurer_key}/${t.claim_type}`));
  assert.deepEqual([...listed].sort(), [...known].sort());
});

test("every template is well formed", () => {
  const ids = new Set<string>();
  for (const t of templates) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.submission?.instructions, `${t.id}: submission instructions`);
    assert.ok(t.requirements.some((r) => r.required !== false), `${t.id}: at least one required item`);
    for (const r of t.requirements) assert.ok(r.key && r.title && r.description, `${t.id}: requirement fields`);
    // The app's own cover page is never something insurers require.
    const cover = t.requirements.find((r) => r.key === "claim_form");
    if (cover) assert.equal(cover.required, false, `${t.id}: cover page must be optional`);
  }
});
