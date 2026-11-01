import { test } from "node:test";
import assert from "node:assert/strict";
import { costOf } from "../src/costs";

test("cost uses per-model prices, with cache writes at 1.25x and reads at 0.1x input", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
  assert.equal(costOf("claude-opus-5-5", usage).toFixed(2), (4 + 20 + 5 + 0.4).toFixed(2));
  assert.equal(costOf("claude-haiku-5-5", usage).toFixed(4), (0.1 + 0.5 + 0.125 + 0.01).toFixed(4));
});

test("an unknown model is priced like Opus rather than as free", () => {
  assert.ok(costOf("some-future-model", { input_tokens: 1000, output_tokens: 0 }) > 0);
});
