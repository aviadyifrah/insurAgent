import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutWebSearch } from "../src/agent/history";

test("old web-search steps, including their code execution, are dropped from history", () => {
  // The shape of a stored assistant turn from when the agent had web search with dynamic filtering.
  const turn = [
    { type: "text", text: "בודק באתר", citations: [{ type: "web_search_result_location", url: "https://x", title: "x", encrypted_index: "e", cited_text: "c" }] },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
    { type: "server_tool_use", id: "srvtoolu_2", name: "code_execution", input: { code: "print(1)" } },
    { type: "code_execution_tool_result", tool_use_id: "srvtoolu_2", content: { type: "code_execution_result", stdout: "1", stderr: "", return_code: 0, content: [] } },
    { type: "bash_code_execution_tool_result", tool_use_id: "srvtoolu_3", content: {} },
    { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_4", content: {} },
    { type: "tool_use", id: "toolu_1", name: "update_claim_details", input: {} },
  ] as never;
  const kept = withoutWebSearch(turn) as { type: string; citations?: unknown }[];
  assert.deepEqual(
    kept.map((b) => b.type),
    ["text", "tool_use"],
  );
  assert.equal(kept[0].citations, null, "citations pointed at the dropped search results");
});

test("the app's own tool results and plain text stay", () => {
  const turn = [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }, { type: "text", text: "שלום" }] as never;
  assert.deepEqual(withoutWebSearch(turn), turn);
  assert.equal(withoutWebSearch("טקסט"), "טקסט");
});
