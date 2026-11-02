import type Anthropic from "@anthropic-ai/sdk";

type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

/**
 * Server-run tool steps: the call and every kind of result. Web search with dynamic filtering also
 * ran code execution, so its results come as code_execution_tool_result and similar.
 */
const isServerToolBlock = (type: string) => type === "server_tool_use" || (type.endsWith("_tool_result") && type !== "tool_result");

/**
 * The agent once had web search; older claims' history still holds those steps, which the API rejects
 * without the tool. Thinking in a turn that loses them has to go too: the API refuses a turn whose
 * thinking blocks no longer match the response they came from.
 */
export function withoutWebSearch(content: string | ContentBlockParam[]): string | ContentBlockParam[] {
  if (typeof content === "string" || !content.some((b) => isServerToolBlock(b.type))) return content;
  return content
    .filter((b) => !isServerToolBlock(b.type) && b.type !== "thinking" && b.type !== "redacted_thinking")
    .map((b) => (b.type === "text" && b.citations ? { ...b, citations: null } : b));
}
